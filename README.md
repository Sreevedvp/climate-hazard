# Climate Hazard Trend Analyzer

A React + FastAPI application for point-based historical heatwave screening. Select a city or coordinates and complete years, then explore frequency, duration, coverage and descriptive trends. Heatwaves are the only hazard implemented; the interface is intentionally minimal and separated from the analytical system for a later visual redesign.

## Stack

- React + TypeScript + Vite; **TanStack Query** for server state, **Zustand** for UI preferences, **React Hook Form** for forms.
- FastAPI with Swagger at `/docs` and OpenAPI JSON at `/openapi.json`.
- MongoDB for normalized weather years, durable analysis jobs and computed results.
- Optional Redis for 60-second response caching and distributed rate limiting. MongoDB is always authoritative.
- Chart.js, lazy-loaded; annual CSV export; paginated episodes.

## Run with Docker

```sh
docker compose up --build
```

Open http://localhost:5173. Swagger is http://localhost:8000/docs. MongoDB and Redis are internal to the Compose network; persistent weather/results use the `mongo_data` volume. The API runs one embedded worker for this initial deployment. Do not delete the volume if you want to retain the cache.

## Run locally without Docker

Requires Node 24+, Python 3.13 and MongoDB 8. Redis is optional. No weather API key is needed for permitted non-commercial use of the public Open-Meteo service.

Start MongoDB yourself, or use the optional local launcher (downloads an official MongoDB binary on its first run and persists data under `.data/mongo`):

```sh
npm ci
npm run db
```

In a second terminal:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a third terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Copy `.env.example` to `.env` at the root to customize settings, then start the backend with `--env-file ../.env`. Without that flag, export environment variables explicitly; `.env` is not silently loaded by application code.

| Setting | Default |
| --- | --- |
| `MONGO_URL` | `mongodb://127.0.0.1:27017` |
| `MONGO_DB` | `climate_hazards` |
| `REDIS_URL` | unset; Redis disabled |
| `CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` |
| `EMBEDDED_WORKER` | `true` |

For independent workers, run the API with `EMBEDDED_WORKER=false`, and run `python -m app.worker` from `backend` with the same MongoDB configuration. Workers claim jobs atomically using renewable leases. Run only as many workers as your upstream quota allows.

## Climate method and assumptions

1. Use Open-Meteo's Historical Weather API, explicitly selecting **ERA5** for consistency across decades. This is gridded reanalysis, not a weather station record. The UI shows requested and returned grid coordinates.
2. Cache daily maximum 2 m temperatures by canonical coordinate (rounded to 0.001°), year, dataset, and methodology version. Fetch missing years in contiguous blocks of at most ten years. Daily periods use GMT/UTC, consistently for baseline and analysis.
3. Normalize Celsius/Fahrenheit, sort by date, fill absent dates with missing markers, reject non-finite values and physically implausible values outside −90…60 °C. Duplicate dates are excluded, not silently selected. Broad plausibility bounds deliberately preserve genuine heat extremes; there is no arbitrary z-score trimming or gap interpolation.
4. Compute a linearly interpolated **95th percentile over all valid daily maxima in 1981–2010**. This fixed baseline does not change when the requested analysis period changes. At least 90% of the baseline days must be valid.
5. A heatwave is **3 or more consecutive calendar days strictly above** that threshold. Equality does not qualify; gaps break runs. Detect runs before splitting into years, using a previous-year context and a following complete year when available. Episodes touching the outer data boundary are flagged as potentially truncated.
6. Annual frequency counts episodes **starting** in that year; heatwave days and longest duration are allocated/clipped to each year. A December episode extending into January is one episode with days in both years. Annual peak temperature is shown separately from episode peak and mean excess temperature.
7. Years below 90% valid coverage are excluded from rolling averages and regression and displayed as chart gaps. Observed counts remain available in the quality table and may underestimate true occurrence. No claim is made that 90% coverage guarantees unbiased sampling.
8. Show a five-year trailing mean only for five consecutive eligible years. Ordinary least squares reports heatwave-day slope per decade only with at least ten eligible years. It is descriptive: no significance claims, causal attribution or correction for autocorrelation.
9. Compare the first and last five-year mean heatwave-day counts only with at least ten total years and complete eligibility for both windows. If the first mean is zero, percentage change is omitted and absolute change remains visible.

This annual-percentile definition emphasizes the warm season. It is a transparent assignment-scale screening definition, not an official local warning standard or seasonally varying ETCCDI index. City selection represents a grid point, not an administrative polygon or spatial average. Years are limited to 1950 onward, complete calendar years, and at most 41 years per request. No forecast data or synthetic fallback is used in the application.

## How requests work

`POST /api/analyses` validates the request and returns 202 with a deterministic job ID. Identical requests share the same job/result, even across API processes. A worker loads missing weather into MongoDB, reads it back, computes the analysis, and persists the result. `GET /api/analyses/{id}` returns progress or the compact annual result. The browser polls only while a job is queued/processing. Reopening the URL resumes viewing the persisted job.

- `GET /api/regions?q=Delhi`: city search.
- `POST /api/analyses`: coordinates, start year, end year.
- `GET /api/analyses/{id}`: status and annual summary.
- `GET /api/analyses/{id}/events?offset=0&limit=20`: bounded episode pagination.
- `GET /api/analyses/{id}/export.csv`: annual data export.
- `GET /health`: database readiness.

Example:

```sh
curl -X POST http://localhost:8000/api/analyses \
  -H 'Content-Type: application/json' \
  -d '{"latitude":28.6139,"longitude":77.209,"start_year":1990,"end_year":2020}'
```

See [docs/SYSTEM-DESIGN.md](docs/SYSTEM-DESIGN.md) for component boundaries, schemas, caching, failures and scaling tradeoffs.

## Performance and safeguards

Raw weather expires after 30 days; computed analyses expire after 7 days; optional Redis result responses expire after 60 seconds. Frontend query freshness is 5 minutes (city searches: 1 hour). Requests with new year ranges reuse cached weather. Data ingestion is asynchronous; analytical CPU work runs off the event loop. Compact annual JSON is gzipped; daily source arrays are not sent to the browser. Charts are code-split, animations are disabled, and event details are loaded only on demand in 20-item pages. City input is debounced and stale requests are cancelled.

Coordinate/year/page bounds, strict input schemas, a 16 KiB JSON body limit, fixed upstream hostnames, disabled redirects, a 4 MB upstream response limit, timeouts, bounded retries and per-process upstream concurrency protect the API. Submission rate is 6/minute per peer; city search 30/minute; reads 120/minute; CSV 10/minute. Rate-limited responses include Retry-After. Redis makes limits shared; without it, limits are process-local. The queue admission count is a best-effort 100-active-job guard, not a transactional global quota.

MongoDB startup failure fails readiness rather than silently using memory. Redis failure falls back to database reads and bounded process-local rate limiting. Provider failures become explicit failed jobs with a retry action. This is a public-data demo with no accounts; query IDs are not secrets. For public deployment, add gateway quotas/bot controls, configure trusted proxy IPs carefully, use TLS and authenticated private MongoDB/Redis, and monitor upstream quotas. Do not trust arbitrary forwarded IP headers.

## Tests

```sh
cd frontend
npm run format:check
npm test
npm run build

cd ../backend
python -m pytest -q
# Include persistence/API tests against a real local MongoDB:
MONGO_TEST=1 python -m pytest -q
```

Integration tests create and remove uniquely named `test_climate_*` databases; use a development MongoDB instance. Weather fixture tests are labeled fixtures and never substitute for real data in the app. Tests cover threshold boundaries, durations, missing dates, leap days, cross-year accounting, units, outliers, duplicate dates, coverage, zero baselines, request limits, persisted jobs/cache reuse, pagination, exports, upstream bounds, Redis failure, query keys and cancellation. CI runs the tests with MongoDB.

## Data attribution and service use

Weather: [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), ECMWF ERA5; geocoding: [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api), GeoNames. Include Open-Meteo/ECMWF attribution when sharing results. Open-Meteo data is offered under CC BY 4.0; its free hosted API has separate usage limits and non-commercial terms. Check [current terms](https://open-meteo.com/en/terms) and arrange a commercial plan or self-hosting before commercial operation. The code does not attempt to bypass quotas.

## Deployment

The Docker files provide one deployable stack. Frontend Nginx proxies API and Swagger requests to FastAPI, so browser credentials/configuration need not contain a backend URL. For split hosting, configure an equivalent `/api` proxy and the API's CORS allowlist. Persist MongoDB or use a managed MongoDB service. If the API host sleeps, an embedded worker cannot make progress while asleep; use an always-on worker service for reliable jobs. Do not deploy the local MongoDB launcher to production.

No repository has been published and no external deployment has been performed automatically. Deployment requires your hosting account/project choices. The confidential assignment brief is not included in this repository.

## AI assistance

OpenAI Codex was used for architecture, implementation, tests, documentation, and local verification. It helped design the cache/job boundaries and exercise edge cases. The methodology and its limitations are explicitly documented; automated tests and live external-data checks provide evidence beyond generated code. Review the implementation before presenting it, and be prepared to explain or change the threshold, coverage rule, and cache keys live.

## With more time

Seasonally varying percentile thresholds with independent scientific validation; block-bootstrap/Mann–Kendall analysis with autocorrelation treatment; polygon sampling with area weights; per-account quotas and global provider budgeting; cancellable jobs, tracing and operational dashboards; Redis outage integration tests and load tests; accessibility automation; a full UI design; and further hazards only after validating the heatwave core.

## Page state and navigation

Select a city and dates on `/`, then Analyze opens `/analyses/:id` with a loader while the server works. Episode details have their own `/analyses/:id/episodes` page. Back/Forward and refresh retain the form draft, selected city, chart metric, expanded annual table and episode page. Zustand persists small selections for up to 20 analyses; TanStack Query caches server data, and MongoDB restores results after refresh. See the page-state section in `docs/SYSTEM-DESIGN.md` for cleanup and persistence details.
# climate-hazard
