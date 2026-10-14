import asyncio
import csv
import io
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from pymongo.errors import PyMongoError
from .models import AnalysisRequest, JobView
from .storage import Repository, Worker
from .provider import WeatherProvider, ProviderError
from .cache import Cache
from .middleware import BodyLimitMiddleware
from .database_diagnostics import log_database_failure

IS_SERVERLESS = bool(os.getenv('VERCEL') or os.getenv('AWS_LAMBDA_FUNCTION_NAME'))
INLINE_PROCESSING = os.getenv('INLINE_PROCESSING', 'false').lower() == 'true' or IS_SERVERLESS

@asynccontextmanager
async def lifespan(app):
    try:
        repository = Repository()
    except Exception as exc:
        log_database_failure('configuration', exc)
        raise
    provider, cache = WeatherProvider(), Cache()
    try:
        await repository.start()
    except Exception as exc:
        # Database requests can reconnect later; report why startup failed.
        log_database_failure('startup_ping_or_indexes', exc)
    app.state.repository, app.state.provider, app.state.cache = repository, provider, cache
    start_worker = os.getenv('EMBEDDED_WORKER', 'true') == 'true' and not IS_SERVERLESS
    task = asyncio.create_task(Worker(repository, provider).run()) if start_worker else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await repository.client.close()
        await provider.client.aclose()
        if cache.redis:
            await cache.redis.aclose()

app = FastAPI(title='Climate Hazard Trend Analyzer', version='1.0.0', description='Point-based ERA5 heatwave screening with a fixed 1981–2010 baseline. All results are descriptive.', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(','), allow_methods=['GET', 'POST'], allow_headers=['Content-Type'], expose_headers=['Retry-After', 'X-Cache'])
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(BodyLimitMiddleware)

@app.exception_handler(PyMongoError)
async def database_error(_request, _exc):
    log_database_failure('request', _exc)
    from fastapi.responses import JSONResponse
    return JSONResponse({'detail': 'Database temporarily unavailable'}, status_code=503)

@app.exception_handler(ProviderError)
async def provider_error(_request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse({'detail': str(exc)}, status_code=502)

async def rate_limit(request, scope, maximum):
    # Do not trust caller-supplied forwarding headers. Configure trusted proxy IPs in Uvicorn.
    identity = request.client.host if request.client else 'unknown'
    if not await request.app.state.cache.allowed(f'{scope}:{identity}', maximum):
        raise HTTPException(429, 'Too many requests. Retry in one minute.', headers={'Retry-After': '60'})

@app.get('/health', tags=['Operations'])
async def health(request: Request):
    await request.app.state.repository.client.admin.command('ping')
    return {'status': 'ok', 'database': 'mongodb', 'redis_configured': bool(request.app.state.cache.redis)}

@app.get('/api/regions', tags=['Regions'])
async def regions(request: Request, q: str = Query(min_length=2, max_length=80)):
    await rate_limit(request, 'regions', 30)
    key = f'regions:{q.strip().casefold()}'
    cached = await request.app.state.cache.get(key)
    if cached is not None:
        return cached
    result = await request.app.state.provider.cities(q.strip())
    await request.app.state.cache.put(key, result)
    return result


def view(job):
    return JobView(id=job['_id'], status=job['status'], progress=job['progress'], request=job['request'], result=job.get('result'), error=job.get('error'))

@app.post('/api/analyses', response_model=JobView, status_code=202, tags=['Analyses'])
async def create_analysis(body: AnalysisRequest, request: Request):
    await rate_limit(request, 'submit', 6)
    repository = request.app.state.repository
    if not await repository.get(body.key) and await repository.db.analyses.count_documents({'status': {'$in': ['queued', 'processing']}}) >= 100:
        raise HTTPException(503, 'Analysis queue is full; please retry later', headers={'Retry-After': '60'})
    job = await repository.submit(body)
    # In serverless mode, process inline since there is no background worker.
    if INLINE_PROCESSING and job['status'] == 'queued':
        claimed = await repository.claim_specific(body.key)
        if claimed:
            worker = Worker(repository, request.app.state.provider)
            await worker.process(claimed)
            job = await repository.get(body.key)
    return view(job)

async def find_job(request, analysis_id):
    import re
    if not re.fullmatch('[a-f0-9]{64}', analysis_id):
        raise HTTPException(422, 'Invalid analysis ID')
    job = await request.app.state.repository.get(analysis_id)
    if not job:
        raise HTTPException(404, 'Analysis not found or expired')
    return job

@app.get('/api/analyses/{analysis_id}', response_model=JobView, tags=['Analyses'])
async def get_analysis(analysis_id: str, request: Request, response: Response):
    await rate_limit(request, 'read', 120)
    cached = await request.app.state.cache.get(f'analysis:{analysis_id}')
    if cached:
        response.headers['X-Cache'] = 'redis'
        return cached
    job = view(await find_job(request, analysis_id))
    response.headers['X-Cache'] = 'mongodb'
    if job.status == 'completed':
        await request.app.state.cache.put(f'analysis:{analysis_id}', job.model_dump(mode='json'))
    return job

@app.get('/api/analyses/{analysis_id}/events', tags=['Analyses'])
async def events(analysis_id: str, request: Request, offset: int = Query(0, ge=0, le=20000), limit: int = Query(20, ge=1, le=100)):
    await rate_limit(request, 'read', 120)
    job = await find_job(request, analysis_id)
    if job['status'] != 'completed':
        raise HTTPException(409, 'Analysis is not complete')
    doc = await request.app.state.repository.db.analyses.find_one({'_id': analysis_id}, {'events': {'$slice': [offset, limit]}, 'event_count': 1})
    return {'items': doc['events'], 'total': doc['event_count'], 'offset': offset, 'limit': limit}

@app.get('/api/analyses/{analysis_id}/export.csv', tags=['Exports'])
async def export(analysis_id: str, request: Request):
    await rate_limit(request, 'export', 10)
    job = await find_job(request, analysis_id)
    if job['status'] != 'completed':
        raise HTTPException(409, 'Analysis is not complete')
    rows = job['result']['annual']
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
    writer.writeheader(); writer.writerows(rows)
    return Response(output.getvalue(), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename="heatwaves-{analysis_id[:8]}.csv"'})
