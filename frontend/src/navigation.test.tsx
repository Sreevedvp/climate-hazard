// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import App from "./App";
import { usePreferences } from "./store";
import type { Job } from "./types";
vi.mock("./Chart", () => ({ default: () => <div>Trend chart</div> }));
const id = "a".repeat(64);
const region = {
  id: "pune",
  name: "Pune, Maharashtra, India",
  latitude: 18.52,
  longitude: 73.85,
};
const request = {
  latitude: 18.52,
  longitude: 73.85,
  start_year: 1995,
  end_year: 2020,
};
const job: Job = {
  id,
  request,
  status: "completed",
  progress: "Done",
  error: null,
  result: {
    threshold_c: 35,
    baseline: "1981–2010",
    baseline_coverage: 1,
    annual: [],
    computed_at: "2026-10-01",
    methodology_version: "test",
    source: {
      latitude: 18.5,
      longitude: 73.8,
      elevation: 500,
      model: "ERA5",
      url: "https://open-meteo.com",
    },
    weather_cache: { reused_years: 30, fetched_years: 0 },
    quality: {},
    warnings: [],
    summary: {
      events_starting_in_range: 22,
      heatwave_days: 88,
      eligible_years: 26,
      slope_days_per_decade: 0,
      comparison: null,
    },
  },
};
const clients: QueryClient[] = [];
function Controls() {
  const nav = useNavigate();
  const location = useLocation();
  return (
    <>
      <output data-testid="path">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => nav(-1)}>Browser back</button>
      <button onClick={() => nav(1)}>Browser forward</button>
    </>
  );
}
function mount(
  path = "/",
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Controls />
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  localStorage.clear();
  usePreferences.setState({ region, draft: request, search: "", analyses: {} });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.unstubAllGlobals();
});
it("selects a city, navigates to a queued result, and restores the form on Back", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        Response.json(
          url.includes("regions")
            ? [region]
            : {
                ...job,
                status: "queued",
                result: null,
                progress: "Fetching weather",
              },
        ),
      ),
    ),
  );
  mount();
  fireEvent.change(screen.getByLabelText("Find a city"), {
    target: { value: "Pune" },
  });
  fireEvent.click(await screen.findByRole("option", { name: region.name }));
  fireEvent.change(screen.getByLabelText("Start year"), {
    target: { value: "1996" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Analyze heatwaves" }));
  await screen.findByText("Analysis queued");
  expect(screen.queryByLabelText("Start year")).toBeNull();
  expect(screen.getByText("Fetching weather")).toBeTruthy();
  expect(usePreferences.getState().analyses[id].region?.name).toBe(region.name);
  fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
  expect(
    ((await screen.findByLabelText("Start year")) as HTMLInputElement).value,
  ).toBe("1996");
  expect(screen.getByText(/Selected location: Pune/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Browser forward" }));
  await screen.findByText("Analysis queued");
});
it("preserves metric and episode page across navigation and a fresh query cache", async () => {
  usePreferences.getState().rememberAnalysis(id, region, request);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          Response.json(
            url.includes("/events")
              ? { items: [], total: 42, offset: 20, limit: 20 }
              : job,
          ),
        ),
      ),
  );
  const view = mount(`/analyses/${id}`);
  fireEvent.change(await screen.findByLabelText("Chart metric"), {
    target: { value: "events" },
  });
  fireEvent.click(screen.getByText("View episode details →"));
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await screen.findByText("Page 2 · 42 episodes");
  fireEvent.click(screen.getByText("← Analysis overview"));
  expect(
    ((await screen.findByLabelText("Chart metric")) as HTMLSelectElement).value,
  ).toBe("events");
  fireEvent.click(screen.getByText("View episode details →"));
  await screen.findByText("Page 2 · 42 episodes");
  view.unmount();
  await usePreferences.persist.rehydrate();
  mount(`/analyses/${id}/episodes`);
  await screen.findByText("Page 2 · 42 episodes");
});
it("aborts an in-flight status request when leaving the analysis page", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    }),
  );
  mount(`/analyses/${id}`);
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByText("← Location and dates"));
  await screen.findByLabelText("Start year");
  expect(signal!.aborted).toBe(true);
});
it("clears stale city labels for custom coordinates and bounds persisted history", () => {
  usePreferences.getState().setDraft({ latitude: 10 });
  expect(usePreferences.getState().region).toBeNull();
  for (let i = 0; i < 25; i++)
    usePreferences.getState().rememberAnalysis(String(i), region, request);
  expect(Object.keys(usePreferences.getState().analyses)).toHaveLength(20);
  const saved = JSON.parse(localStorage.getItem("climate-preferences-v1")!);
  expect(saved.state.analyses["24"].request).toEqual(request);
  expect(saved.state.analyses["24"].result).toBeUndefined();
});

it("stops queued-job polling after navigating away", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        ...job,
        status: "queued",
        result: null,
        progress: "Fetching weather",
      }),
    );
    // Each poll needs a fresh response body.
    fetch.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          ...job,
          status: "queued",
          result: null,
          progress: "Fetching weather",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    mount(`/analyses/${id}`);
    await screen.findByText("Analysis queued");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText("← Location and dates"));
    const calls = fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetch.mock.calls.length).toBe(calls);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the keyboard-selected city in the input, restores it, and clears it", async () => {
  const second = {
    ...region,
    id: "second",
    name: "Pune District, India",
    latitude: 18.6,
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json([region, second])),
      ),
  );
  const view = mount();
  const input = screen.getByRole("combobox", {
    name: "Find a city",
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Pune" } });
  await screen.findByRole("option", { name: second.name });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(
    screen
      .getByRole("option", { name: region.name })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe(region.name);
  expect(screen.queryByRole("listbox")).toBeNull();
  view.unmount();
  await usePreferences.persist.rehydrate();
  mount();
  expect((screen.getByLabelText("Find a city") as HTMLInputElement).value).toBe(
    region.name,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear selected city" }));
  expect((screen.getByLabelText("Find a city") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe(
    "",
  );
  expect(usePreferences.getState().region).toBeNull();
  fireEvent.change(screen.getByLabelText("Find a city"), {
    target: { value: "Pune" },
  });
  await screen.findByRole("option", { name: region.name });
  fireEvent.keyDown(screen.getByLabelText("Find a city"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});
