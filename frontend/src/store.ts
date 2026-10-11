import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Region, AnalysisRequest } from "./types";
type Draft = { [K in keyof AnalysisRequest]: number | null };
type Metric = "heatwave_days" | "events" | "longest_duration";
interface AnalysisView {
  region: Region | null;
  request: AnalysisRequest;
  metric: Metric;
  page: number;
  expanded: boolean;
}
interface Preferences {
  region: Region | null;
  draft: Draft;
  search: string;
  analyses: Record<string, AnalysisView>;
  setRegion: (region: Region) => void;
  setDraft: (draft: Partial<AnalysisRequest>) => void;
  setSearch: (search: string) => void;
  rememberAnalysis: (
    id: string,
    region: Region | null,
    request: AnalysisRequest,
  ) => void;
  setAnalysisView: (
    id: string,
    view: Partial<Pick<AnalysisView, "metric" | "page" | "expanded">>,
  ) => void;
}
const initialRegion: Region = {
  id: "delhi",
  name: "New Delhi, India",
  latitude: 28.6139,
  longitude: 77.209,
};
const initialDraft: Draft = {
  latitude: initialRegion.latitude,
  longitude: initialRegion.longitude,
  start_year: 1990,
  end_year: 2020,
};
// Persist only small user selections. Query owns remote results; MongoDB restores them after reload.
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      region: initialRegion,
      draft: initialDraft,
      search: initialRegion.name,
      analyses: {},
      setRegion: (region) =>
        set((s) => ({
          region,
          search: region.name,
          draft: {
            ...s.draft,
            latitude: region.latitude,
            longitude: region.longitude,
          },
        })),
      setDraft: (values) =>
        set((s) => {
          const draft = { ...s.draft };
          for (const key of Object.keys(draft) as (keyof Draft)[]) {
            if (key in values)
              draft[key] = Number.isFinite(values[key]) ? values[key]! : null;
          }
          const region =
            s.region &&
            draft.latitude === s.region.latitude &&
            draft.longitude === s.region.longitude
              ? s.region
              : null;
          return { draft, region };
        }),
      setSearch: (search) =>
        set((s) => ({
          search,
          region: s.region?.name === search ? s.region : null,
        })),
      rememberAnalysis: (id, region, request) =>
        set((s) => {
          const entries = Object.entries(s.analyses)
            .filter(([key]) => key !== id)
            .slice(-19);
          return {
            analyses: {
              ...Object.fromEntries(entries),
              [id]: {
                ...(s.analyses[id] ?? {
                  metric: "heatwave_days",
                  page: 0,
                  expanded: false,
                }),
                region,
                request,
              },
            },
          };
        }),
      setAnalysisView: (id, view) =>
        set((s) => {
          const current = s.analyses[id];
          if (!current) return s;
          return { analyses: { ...s.analyses, [id]: { ...current, ...view } } };
        }),
    }),
    {
      name: "climate-preferences-v1",
      version: 3,
      migrate: (old) => {
        const prior = old as Partial<Preferences>;
        const region =
          prior.region === undefined ? initialRegion : prior.region;
        return {
          region,
          draft: prior.draft ?? {
            ...initialDraft,
            latitude: region?.latitude ?? null,
            longitude: region?.longitude ?? null,
          },
          search: prior.search || region?.name || "",
          analyses: prior.analyses ?? {},
        };
      },
      partialize: ({ region, draft, search, analyses }) => ({
        region,
        draft,
        search,
        analyses,
      }),
    },
  ),
);
