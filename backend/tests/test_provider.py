import httpx
import pytest
from app.provider import WeatherProvider, ProviderError
from app.cache import Cache

@pytest.mark.asyncio
async def test_provider_rejects_oversized_body_and_redirects():
    provider=WeatherProvider()
    await provider.client.aclose()
    provider.client=httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(200,content=b'x'*4_000_001)))
    with pytest.raises(ProviderError,match='size limit'):await provider.get('https://archive-api.open-meteo.com/v1/archive',{})
    await provider.client.aclose()
    provider.client=httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(302,headers={'location':'http://127.0.0.1/private'})),follow_redirects=False)
    with pytest.raises(ProviderError):await provider.get('https://archive-api.open-meteo.com/v1/archive',{})
    await provider.client.aclose()

@pytest.mark.asyncio
async def test_redis_failure_falls_back_to_bounded_local_rate_limit(monkeypatch):
    monkeypatch.delenv('REDIS_URL',raising=False)
    cache=Cache()
    class Broken:
        async def eval(self,*args):raise ConnectionError()
        async def get(self,*args):raise ConnectionError()
    cache.redis=Broken()
    assert await cache.get('key') is None
    assert await cache.allowed('user',1)
    assert not await cache.allowed('user',1)
