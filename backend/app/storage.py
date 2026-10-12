import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError
from .models import AnalysisRequest
from .climate import analyze
from .provider import WeatherProvider, ProviderError


def now():
    return datetime.now(timezone.utc)

class Repository:
    def __init__(self):
        self.client = AsyncMongoClient(os.getenv('MONGO_URL', 'mongodb://127.0.0.1:27017'), serverSelectionTimeoutMS=3000, tz_aware=True)
        self.db = self.client[os.getenv('MONGO_DB', 'climate_hazards')]

    async def start(self):
        await self.client.admin.command('ping')
        for collection in [self.db.weather, self.db.analyses]:
            await collection.create_index('expires_at', expireAfterSeconds=0)
        await self.db.analyses.create_index([('status', 1), ('lease_until', 1), ('created_at', 1)])

    async def submit(self, request):
        key = request.key
        try:
            await self.db.analyses.update_one({'_id': key}, {'$setOnInsert': {'request': request.model_dump(), 'status': 'queued', 'progress': 'Waiting for worker', 'created_at': now(), 'expires_at': now() + timedelta(days=7), 'attempts': 0}}, upsert=True)
        except DuplicateKeyError:
            pass  # Another request inserted this canonical job concurrently.
        # Expired TTL documents can still exist until Mongo's sweeper runs.
        await self.db.analyses.update_one({'_id': key, '$or': [{'status': 'failed'}, {'expires_at': {'$lte': now()}}]}, {'$set': {'status': 'queued', 'progress': 'Waiting for worker', 'error': None, 'attempts': 0, 'expires_at': now()+timedelta(days=7)}, '$unset': {'result': '', 'events': ''}})
        return await self.get(key)

    async def get(self, key):
        return await self.db.analyses.find_one({'_id': key}, {'events': 0})

    async def claim(self):
        token = uuid.uuid4().hex
        job = await self.db.analyses.find_one_and_update({'$or': [{'status': 'queued'}, {'status': 'processing', 'lease_until': {'$lt': now()}}]}, {'$set': {'status': 'processing', 'lease_token': token, 'lease_until': now()+timedelta(seconds=90)}, '$inc': {'attempts': 1}}, sort=[('created_at', 1)], return_document=ReturnDocument.AFTER)
        return job

    async def claim_specific(self, key):
        """Claim a specific job by key — used for inline serverless processing."""
        token = uuid.uuid4().hex
        return await self.db.analyses.find_one_and_update(
            {'_id': key, 'status': 'queued'},
            {'$set': {'status': 'processing', 'lease_token': token, 'lease_until': now()+timedelta(seconds=300)}, '$inc': {'attempts': 1}},
            return_document=ReturnDocument.AFTER
        )

class Worker:
    def __init__(self, repository: Repository, provider: WeatherProvider):
        self.repository, self.provider = repository, provider

    async def run(self):
        while True:
            try:
                job = await self.repository.claim()
                if job:
                    await self.process(job)
                else:
                    await asyncio.sleep(.5)
            except asyncio.CancelledError:
                raise
            except Exception:
                import logging
                logging.exception('Worker polling failed')
                await asyncio.sleep(2)

    async def process(self, job):
        db = self.repository.db
        owner = {'_id': job['_id'], 'lease_token': job['lease_token'], 'status': 'processing'}
        async def heartbeat():
            while True:
                await asyncio.sleep(20)
                await db.analyses.update_one(owner, {'$set': {'lease_until': now()+timedelta(seconds=90)}})
        pulse = asyncio.create_task(heartbeat())
        try:
            if job['attempts'] > 3:
                raise ProviderError('Worker repeatedly interrupted. Submit again to retry.')
            request = AnalysisRequest(**job['request'])
            last_complete = now().year-1
            years = sorted(set(range(1981, 2011)) | set(range(request.start_year-1, min(request.end_year+1, last_complete)+1)))
            ids = [f'{request.location_key}:{year}' for year in years]
            cached = {doc['year']: doc async for doc in db.weather.find({'_id': {'$in': ids}, 'expires_at': {'$gt': now()}})}
            missing = [y for y in years if y not in cached]
            groups = []
            for year in missing:
                if groups and year == groups[-1][-1]+1 and len(groups[-1]) < 10:
                    groups[-1].append(year)
                else:
                    groups.append([year])
            for i, group in enumerate(groups):
                await db.analyses.update_one(owner, {'$set': {'progress': f'Loading weather block {i+1}/{len(groups)} ({group[0]}–{group[-1]})'}})
                rows, source = await self.provider.weather(request, group[0], group[-1])
                for year in group:
                    document = {'_id': f'{request.location_key}:{year}', 'year': year, 'rows': [r for r in rows if r['date'].startswith(str(year))], 'source': source, 'fetched_at': now(), 'expires_at': now()+timedelta(days=30)}
                    await db.weather.replace_one({'_id': document['_id']}, document, upsert=True)
            # Always compute from persisted documents, including freshly ingested data.
            documents = [doc async for doc in db.weather.find({'_id': {'$in': ids}})]
            await db.analyses.update_one(owner, {'$set': {'progress': 'Computing threshold, episodes, and annual trends'}})
            rows = sorted([r for doc in documents for r in doc['rows']], key=lambda r: r['date'])
            result = await asyncio.to_thread(analyze, request, rows)
            events = result.pop('events')
            result['source'] = documents[0]['source']
            result['computed_at'] = now().isoformat()
            result['weather_cache'] = {'reused_years': len(cached), 'fetched_years': len(missing)}
            await db.analyses.update_one(owner, {'$set': {'status': 'completed', 'progress': 'Ready', 'result': result, 'events': events, 'event_count': len(events), 'expires_at': now()+timedelta(days=7)}, '$unset': {'lease_token': '', 'lease_until': ''}})
        except asyncio.CancelledError:
            # Release the lease for a graceful restart; crashes recover after 90 seconds.
            await db.analyses.update_one(owner, {'$set': {'status': 'queued'}, '$unset': {'lease_token': '', 'lease_until': ''}})
            raise
        except Exception as exc:
            import logging
            logging.exception('Analysis failed: %s', job['_id'])
            message = str(exc) if isinstance(exc, (ProviderError, ValueError)) else 'Analysis temporarily unavailable. Please retry.'
            await db.analyses.update_one(owner, {'$set': {'status': 'failed', 'progress': 'Failed', 'error': message}, '$unset': {'lease_token': '', 'lease_until': ''}})
        finally:
            pulse.cancel()
            await asyncio.gather(pulse, return_exceptions=True)
