import asyncio
from datetime import date
import httpx
from .climate import normalize

class ProviderError(Exception):
    pass

class WeatherProvider:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), limits=httpx.Limits(max_connections=4), follow_redirects=False)
        self.slots = asyncio.Semaphore(2)

    async def get(self, url, params):
        # URLs are constants, never accepted from callers (SSRF protection).
        async with self.slots:
            for attempt in range(3):
                try:
                    async with self.client.stream('GET', url, params=params) as response:
                        if response.status_code == 429 or response.status_code in (502, 503, 504):
                            if attempt < 2:
                                await asyncio.sleep(2 ** attempt)
                                continue
                        response.raise_for_status()
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > 4_000_000:
                                raise ProviderError('Weather provider response exceeded the size limit')
                        import json
                        return json.loads(data)
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    if attempt == 2:
                        raise ProviderError('Weather provider is temporarily unavailable; retry later') from exc
                    await asyncio.sleep(2 ** attempt)
                except (httpx.HTTPStatusError, ValueError) as exc:
                    raise ProviderError('Weather provider returned an invalid or unsuccessful response') from exc
        raise ProviderError('Weather provider is busy; retry later')

    async def weather(self, request, first, last):
        raw = await self.get('https://archive-api.open-meteo.com/v1/archive', {'latitude': request.latitude, 'longitude': request.longitude, 'start_date': f'{first}-01-01', 'end_date': f'{last}-12-31', 'daily': 'temperature_2m_max', 'temperature_unit': 'celsius', 'timezone': 'GMT', 'models': 'era5'})
        try:
            rows = normalize(raw, date(first, 1, 1), date(last, 12, 31))
        except (ValueError, TypeError, KeyError) as exc:
            raise ProviderError('Weather provider returned malformed daily data') from exc
        return rows, {'latitude': raw.get('latitude'), 'longitude': raw.get('longitude'), 'elevation': raw.get('elevation'), 'timezone': 'GMT', 'model': 'ERA5', 'source': 'Open-Meteo Historical Weather API', 'url': 'https://open-meteo.com/en/docs/historical-weather-api'}

    async def cities(self, name):
        data = await self.get('https://geocoding-api.open-meteo.com/v1/search', {'name': name, 'count': 8, 'language': 'en', 'format': 'json'})
        return [{'id': str(r['id']), 'name': ', '.join(filter(None, [r['name'], r.get('admin1'), r.get('country')])), 'latitude': r['latitude'], 'longitude': r['longitude']} for r in data.get('results', [])]
