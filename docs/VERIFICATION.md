# Verification — 11 October 2026

- 19 backend tests passed, including real MongoDB integration with temporary test databases.
- 4 frontend query/API tests passed; TypeScript checking and production Vite build passed.
- Frontend dependency audit reported zero known advisories after updating Vitest; npm lockfiles are included. Python direct requirements and a tested constraints lock are included.
- Browser verification: submitted New Delhi 1990–2020 through React Hook Form; viewed the completed result and lazy chart; opened episode details and moved to the next page; city search returned Bengaluru, Karnataka, India.
- Real weather, not fixture output: New Delhi at requested coordinate 28.614, 77.209, ERA5 returned grid 28.5, 77.25. Fixed-baseline threshold 41.50 °C; 425 heatwave days; 71 event starts; 100% baseline coverage. These are indicators under this implementation's documented definition, not independently validated climate findings.
- An overlapping 1990–2019 request reused 40 weather years and fetched zero. Three warm completed-result POST requests measured 3.1, 1.9 and 1.7 ms on localhost with Redis disabled. This is a functional cache reuse check, not a production latency or capacity benchmark.
- Swagger, OpenAPI JSON and CSV endpoints returned HTTP 200 in the live check.
- MongoDB 8.0.12 was run locally using the optional launcher; persisted data survives normal restart. Docker is unavailable on the development machine, so Compose was reviewed but not executed.
- Redis failure behavior has an automated fake-client test. An actual Redis instance and distributed rate limits across multiple API processes have not been exercised locally.
- No WAN/load/long-duration memory benchmark, independently reviewed climate validation, or deployed public URL is claimed. No confidential assignment brief is included.

## Navigation update

- Nine frontend tests now pass, including city selection, submission-to-results navigation, browser Back/Forward, draft restoration, metric and episode-page persistence across remount/rehydration, custom-coordinate labeling, bounded local history, aborted requests, and polling shutdown on navigation.
- Production build and Prettier checks pass. The running browser displayed the saved Hyderabad city name on the analysis route and its separate episode-details route.
