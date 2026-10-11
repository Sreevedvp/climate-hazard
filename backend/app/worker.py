"""Optional separate worker process: python -m app.worker."""
import asyncio
from .storage import Repository, Worker
from .provider import WeatherProvider

async def main():
    repository, provider = Repository(), WeatherProvider()
    await repository.start()
    try:
        await Worker(repository, provider).run()
    finally:
        await repository.client.close()
        await provider.client.aclose()

if __name__ == '__main__':
    asyncio.run(main())
