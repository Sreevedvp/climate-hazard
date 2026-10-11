import CityPicker from "./CityPicker";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAnalysis, eventsQuery, jobQuery } from "./api";
import { usePreferences } from "./store";
import type { AnalysisRequest, Job, Result, Region } from "./types";
const TrendChart = lazy(() => import("./Chart"));
const lastYear = new Date().getFullYear() - 1;

function Events({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const remembered = usePreferences((s) => s.analyses[id]?.page ?? 0);
  const raw = params.get("page");
  const parsed = Number(raw);
  const page =
    raw !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 1001
      ? parsed - 1
      : remembered;
  const setPage = (value: number) => {
    usePreferences.getState().setAnalysisView(id, { page: value });
    setParams({ page: String(value + 1) });
  };
  useEffect(() => {
    usePreferences.getState().setAnalysisView(id, { page });
  }, [id, page]);
  const query = useQuery(eventsQuery(id, page));
  return (
    <section>
      <h2>Detected episodes</h2>
      <p>
        Episodes crossing a year boundary are detected once. Annual days are
        split between calendar years.
      </p>
      {query.isPending ? (
        <Loader message="Loading episodes…" />
      ) : query.isError ? (
        <p role="alert">
          {query.error.message}{" "}
          <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Days</th>
                  <th>Peak °C</th>
                  <th>Mean excess °C</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((e) => (
                  <tr key={e.start}>
                    <td>{e.start}</td>
                    <td>{e.end}</td>
                    <td>
                      {e.duration}
                      {e.boundary_censored ? " (boundary-censored)" : ""}
                    </td>
                    <td>{e.peak_c}</td>
                    <td>{e.mean_excess_c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!query.data.total && <p>No qualifying episodes detected.</p>}
          <div className="actions">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>
              Page {page + 1} · {query.data.total} episodes
            </span>
            <button
              disabled={(page + 1) * 20 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
function Results({ job, result }: { job: Job; result: Result }) {
  const metric = usePreferences(
    (s) => s.analyses[job.id]?.metric ?? "heatwave_days",
  );
  const expanded = usePreferences((s) => s.analyses[job.id]?.expanded ?? false);
  const setMetric = (metric: "heatwave_days" | "events" | "longest_duration") =>
    usePreferences.getState().setAnalysisView(job.id, { metric });
  const summary = result.summary,
    c = summary.comparison;
  return (
    <>
      <section>
        <h2>
          Analysis: {job.request.start_year}–{job.request.end_year}
        </h2>
        <p>
          Requested point: {job.request.latitude}, {job.request.longitude}. ERA5
          grid point: {result.source.latitude}, {result.source.longitude}.
        </p>
        <div className="stats">
          <article>
            <strong>{result.threshold_c.toFixed(2)} °C</strong>
            <span>95th-percentile threshold</span>
          </article>
          <article>
            <strong>{summary.heatwave_days}</strong>
            <span>Observed heatwave days</span>
          </article>
          <article>
            <strong>{summary.events_starting_in_range}</strong>
            <span>Episodes starting in range</span>
          </article>
          <article>
            <strong>
              {summary.slope_days_per_decade === null
                ? "Insufficient years"
                : `${summary.slope_days_per_decade > 0 ? "+" : ""}${summary.slope_days_per_decade}`}
            </strong>
            <span>Days per decade · descriptive regression</span>
          </article>
        </div>
        {c ? (
          <p className="insight">
            The mean changed from{" "}
            <strong>{c.early_mean_days.toFixed(1)}</strong> heatwave days/year
            in {c.early_period} to{" "}
            <strong>{c.late_mean_days.toFixed(1)}</strong> in {c.late_period}:{" "}
            {c.absolute_change_days > 0 ? "+" : ""}
            {c.absolute_change_days} days/year.{" "}
            {c.percent_change === null
              ? "A percentage change is undefined because the starting mean is zero."
              : `That is a ${c.percent_change}% change.`}
          </p>
        ) : (
          <p>
            Window comparison requires at least ten years and ≥90% coverage in
            every year of both five-year endpoint windows.
          </p>
        )}
        <label>
          Chart metric
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
          >
            <option value="heatwave_days">Heatwave days</option>
            <option value="events">Event frequency</option>
            <option value="longest_duration">Longest duration</option>
          </select>
        </label>
        <Suspense fallback={<p role="status">Loading chart…</p>}>
          <TrendChart annual={result.annual} metric={metric} />
        </Suspense>
        <p>
          Hover or tap chart points for values. Years below 90% coverage are
          gaps, not zeros.
        </p>
        <a href={`/api/analyses/${job.id}/export.csv`}>Download annual CSV</a>
      </section>
      <section>
        <h2>Quality and interpretation</h2>
        <p>
          Baseline coverage: {(result.baseline_coverage * 100).toFixed(1)}%.
          Eligible analysis years: {summary.eligible_years}/
          {result.annual.length}. Excluded values:{" "}
          {Object.entries(result.quality)
            .map(([key, value]) => `${value} ${key}`)
            .join(", ")}
          .
        </p>
        <ul>
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <details
          open={expanded}
          onToggle={(e) => {
            if (e.currentTarget.open !== expanded)
              usePreferences
                .getState()
                .setAnalysisView(job.id, { expanded: e.currentTarget.open });
          }}
        >
          <summary>Annual data and coverage</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Coverage</th>
                  <th>Events</th>
                  <th>Days</th>
                  <th>Longest</th>
                  <th>Annual peak °C</th>
                </tr>
              </thead>
              <tbody>
                {result.annual.map((r) => (
                  <tr key={r.year}>
                    <td>{r.year}</td>
                    <td>
                      {(r.coverage * 100).toFixed(1)}%{" "}
                      {!r.eligible && "— excluded from trend"}
                    </td>
                    <td>{r.events}</td>
                    <td>{r.heatwave_days}</td>
                    <td>{r.longest_duration}</td>
                    <td>{r.peak_c?.toFixed(1) ?? "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p>
          Computed {new Date(result.computed_at).toLocaleString()}. Weather
          cache: {result.weather_cache.reused_years} years reused,{" "}
          {result.weather_cache.fetched_years} fetched.
        </p>
        <p>
          Data:{" "}
          <a href={result.source.url} target="_blank" rel="noreferrer">
            Open-Meteo / ECMWF ERA5
          </a>{" "}
          · CC BY 4.0 attribution. {result.methodology_version}
        </p>
      </section>
      <section>
        <Link to={`/analyses/${job.id}/episodes`}>View episode details →</Link>
      </section>
    </>
  );
}
function JobResults({
  id,
  episodes = false,
}: {
  id: string;
  episodes?: boolean;
}) {
  const query = useQuery(jobQuery(id));
  useEffect(() => {
    if (query.data && !usePreferences.getState().analyses[id]) {
      const region = usePreferences.getState().region;
      const request = query.data.request;
      const matches =
        region &&
        Math.abs(region.latitude - request.latitude) < 0.00051 &&
        Math.abs(region.longitude - request.longitude) < 0.00051;
      usePreferences
        .getState()
        .rememberAnalysis(id, matches ? region : null, request);
    }
  }, [id, query.data]);
  if (query.isPending) return <Loader message="Loading analysis status…" />;
  if (query.isError)
    return (
      <p role="alert">
        {query.error.message}{" "}
        <button onClick={() => void query.refetch()}>Retry status</button>
      </p>
    );
  const job = query.data;
  if (job.status === "failed")
    return <p role="alert">{job.error} Submit the same selection to retry.</p>;
  if (!job.result)
    return (
      <section>
        <LocationTitle job={job} />
        <h2>
          {job.status === "queued"
            ? "Analysis queued"
            : "Preparing your analysis"}
        </h2>
        <Loader message={job.progress || "Loading weather data…"} />
        <p>
          A first request may take a minute or more to fetch decades of weather.
          You can leave this page and reopen its URL; the job continues on the
          server.
        </p>
      </section>
    );
  return (
    <>
      <LocationTitle job={job} />
      {episodes ? (
        <Events key={id} id={id} />
      ) : (
        <Results key={id} job={job} result={job.result} />
      )}
    </>
  );
}
function SelectionPage() {
  const region = usePreferences((s) => s.region),
    setRegion = usePreferences((s) => s.setRegion);
  const client = useQueryClient();
  const navigate = useNavigate();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { errors },
  } = useForm<AnalysisRequest>({
    defaultValues: Object.fromEntries(
      Object.entries(usePreferences.getState().draft).map(([key, value]) => [
        key,
        value ?? NaN,
      ]),
    ),
  });
  useEffect(() => {
    const subscription = watch((values) =>
      usePreferences.getState().setDraft(values),
    );
    return () => subscription.unsubscribe();
  }, [watch]);
  const start = watch("start_year");
  const mutation = useMutation({
    mutationFn: ({
      request,
    }: {
      request: AnalysisRequest;
      region: Region | null;
    }) => {
      controller.current?.abort();
      controller.current = new AbortController();
      return createAnalysis(request, controller.current.signal);
    },
    onSuccess: (job, selection) => {
      if (controller.current?.signal.aborted) return;
      client.setQueryData(["analysis", job.id], job);
      usePreferences
        .getState()
        .rememberAnalysis(job.id, selection.region, job.request);
      navigate(`/analyses/${job.id}`);
    },
  });
  return (
    <>
      <section>
        <h2>Choose a location and time range</h2>
        <CityPicker
          onSelect={(city) => {
            reset({
              ...getValues(),
              latitude: city.latitude,
              longitude: city.longitude,
            });
            setRegion(city);
          }}
          onClear={() => {
            reset({ ...getValues(), latitude: NaN, longitude: NaN });
            usePreferences.getState().setSearch("");
          }}
        />
        <p>
          Selected location: {region?.name ?? "Custom coordinates"}. You can
          override its coordinates; this analyzes a point, not an entire city
          boundary.
        </p>
        <form
          onSubmit={handleSubmit((values) =>
            mutation.mutate({ request: values, region }),
          )}
        >
          <div className="form-grid">
            <label>
              Latitude
              <input
                type="number"
                step="any"
                aria-invalid={!!errors.latitude}
                {...register("latitude", {
                  valueAsNumber: true,
                  required: "Latitude is required",
                  min: { value: -90, message: "Minimum −90" },
                  max: { value: 90, message: "Maximum 90" },
                  validate: (v) =>
                    Number.isFinite(v) || "Enter a finite coordinate",
                })}
              />
              <span className="error">{errors.latitude?.message}</span>
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                aria-invalid={!!errors.longitude}
                {...register("longitude", {
                  valueAsNumber: true,
                  required: "Longitude is required",
                  min: { value: -180, message: "Minimum −180" },
                  max: { value: 180, message: "Maximum 180" },
                  validate: (v) =>
                    Number.isFinite(v) || "Enter a finite coordinate",
                })}
              />
              <span className="error">{errors.longitude?.message}</span>
            </label>
            <label>
              Start year
              <input
                type="number"
                {...register("start_year", {
                  valueAsNumber: true,
                  required: "Required",
                  min: { value: 1950, message: "1950 or later" },
                  max: { value: lastYear, message: "Use a complete year" },
                  validate: Number.isInteger,
                })}
              />
              <span className="error">{errors.start_year?.message}</span>
            </label>
            <label>
              End year
              <input
                type="number"
                {...register("end_year", {
                  valueAsNumber: true,
                  required: "Required",
                  max: { value: lastYear, message: "Use a complete year" },
                  validate: (v) =>
                    (Number.isInteger(v) && v >= start && v - start <= 40) ||
                    "Choose an ordered range of at most 41 years",
                })}
              />
              <span className="error">{errors.end_year?.message}</span>
            </label>
            <label>
              Hazard
              <select aria-label="Hazard" defaultValue="heatwave">
                <option value="heatwave">Heatwave</option>
              </select>
            </label>
          </div>
          <p>
            Definition: at least 3 consecutive days strictly above the fixed
            1981–2010 annual 95th-percentile daily maximum temperature. Daily
            periods use UTC.
          </p>
          <button
            className="primary"
            disabled={mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? "Submitting…" : "Analyze heatwaves"}
          </button>
          {mutation.isError && <p role="alert">{mutation.error.message}</p>}
        </form>
      </section>
    </>
  );
}

function Loader({ message }: { message: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {message}
    </div>
  );
}
function LocationTitle({ job }: { job: Job }) {
  const saved = usePreferences((s) => s.analyses[job.id]);
  const matches =
    saved?.request.latitude === job.request.latitude &&
    saved?.request.longitude === job.request.longitude;
  return (
    <h2>
      {matches && saved.region
        ? saved.region.name
        : `Point ${job.request.latitude}, ${job.request.longitude}`}{" "}
      · {job.request.start_year}–{job.request.end_year}
    </h2>
  );
}
function AnalysisPage({ episodes = false }: { episodes?: boolean }) {
  const { id = "" } = useParams();
  if (!/^[a-f0-9]{64}$/.test(id))
    return (
      <p role="alert">
        Invalid analysis link. <Link to="/">Choose a location</Link>
      </p>
    );
  return (
    <>
      <nav className="actions">
        <Link to="/">← Location and dates</Link>
        {episodes && <Link to={`/analyses/${id}`}>← Analysis overview</Link>}
      </nav>
      <JobResults key={id} id={id} episodes={episodes} />
    </>
  );
}
function Home() {
  const [params] = useSearchParams();
  const legacy = params.get("analysis");
  return legacy && /^[a-f0-9]{64}$/.test(legacy) ? (
    <Navigate replace to={`/analyses/${legacy}`} />
  ) : (
    <SelectionPage />
  );
}
export default function App() {
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">HISTORICAL CLIMATE · HEATWAVES</p>
          <h1>Climate Hazard Trend Analyzer</h1>
          <p>
            Explore heatwave frequency, duration, and temperature at a selected
            location.
          </p>
        </div>
        <a href="/docs" target="_blank" rel="noreferrer">
          API documentation ↗
        </a>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/analyses/:id" element={<AnalysisPage />} />
        <Route
          path="/analyses/:id/episodes"
          element={<AnalysisPage episodes />}
        />
        <Route
          path="*"
          element={
            <p>
              Page not found. <Link to="/">Choose a location</Link>
            </p>
          }
        />
      </Routes>
      <footer>
        Descriptive climate indicators, not a forecast or a health advisory.
      </footer>
    </main>
  );
}
