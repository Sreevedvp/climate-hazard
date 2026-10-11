import json
import os
import time
from collections import OrderedDict
import logging
from redis.asyncio import Redis

class Cache:
    def __init__(self):
        self.redis = Redis.from_url(os.environ['REDIS_URL'], socket_connect_timeout=.5, socket_timeout=.5) if os.getenv('REDIS_URL') else None
        self.local = OrderedDict()

    async def get(self, key):
        if self.redis:
            try:
                raw = await self.redis.get(key)
                return json.loads(raw) if raw else None
            except Exception:
                logging.warning('Redis read unavailable')
        return None

    async def put(self, key, value):
        if self.redis:
            try:
                await self.redis.set(key, json.dumps(value), ex=60)
            except Exception:
                logging.warning('Redis cache write unavailable')

    async def allowed(self, identity, limit):
        key = f'limit:{identity}:{int(time.time()//60)}'
        if self.redis:
            try:
                count = await self.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, key)
                return count <= limit
            except Exception:
                logging.warning('Redis limiter unavailable; using process-local fallback')
        count = self.local.pop(key, 0)+1
        self.local[key] = count
        while len(self.local) > 10000:
            self.local.popitem(last=False)
        return count <= limit
