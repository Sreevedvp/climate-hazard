import { queryOptions } from "@tanstack/react-query";
import type { Job, Region, EventPage, AnalysisRequest } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const BASE = import.meta.env.VITE_API_URL || '';
  const response = await fetch(`${BASE}/api${path}`, {
    ...init,
    signal,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      typeof body.detail === "string"
        ? body.detail
        : `Request failed (${response.status}). Check your input or retry later.`,
    );
  }
  return response.json();
}
export const createAnalysis = (
  request: AnalysisRequest,
  signal?: AbortSignal,
) =>
  api<Job>(
    "/analyses",
    { method: "POST", body: JSON.stringify(request) },
    signal,
  );
export const jobQuery = (id: string) =>
  queryOptions({
    queryKey: ["analysis", id],
    queryFn: ({ signal }) => api<Job>(`/analyses/${id}`, {}, signal),
    staleTime: 300000,
    retry: (count, error) =>
      count < 2 && (!(error instanceof ApiError) || error.status >= 500),
    refetchInterval: (query) =>
      !query.state.error &&
      ["queued", "processing"].includes(query.state.data?.status ?? "queued")
        ? 1500
        : false,
  });
export const regionQuery = (search: string) =>
  queryOptions({
    queryKey: ["regions", search],
    queryFn: ({ signal }) =>
      api<Region[]>(`/regions?q=${encodeURIComponent(search)}`, {}, signal),
    enabled: search.length >= 2,
    staleTime: 3600000,
  });
export const eventsQuery = (id: string, page: number) =>
  queryOptions({
    queryKey: ["events", id, page],
    queryFn: ({ signal }) =>
      api<EventPage>(
        `/analyses/${id}/events?offset=${page * 20}&limit=20`,
        {},
        signal,
      ),
    staleTime: 300000,
  });
