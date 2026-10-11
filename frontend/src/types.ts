export interface Region {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}
export interface AnalysisRequest {
  latitude: number;
  longitude: number;
  start_year: number;
  end_year: number;
}
export interface Annual {
  year: number;
  coverage: number;
  valid_days: number;
  excluded_days: number;
  eligible: boolean;
  events: number;
  heatwave_days: number;
  longest_duration: number;
  peak_c: number | null;
  rolling_days: number | null;
}
export interface Result {
  threshold_c: number;
  baseline: string;
  baseline_coverage: number;
  annual: Annual[];
  computed_at: string;
  methodology_version: string;
  source: {
    latitude: number;
    longitude: number;
    elevation: number;
    model: string;
    url: string;
  };
  weather_cache: { reused_years: number; fetched_years: number };
  quality: Record<string, number>;
  warnings: string[];
  summary: {
    events_starting_in_range: number;
    heatwave_days: number;
    eligible_years: number;
    slope_days_per_decade: number | null;
    comparison: null | {
      early_mean_days: number;
      late_mean_days: number;
      absolute_change_days: number;
      percent_change: number | null;
      early_period: string;
      late_period: string;
    };
  };
}
export interface Job {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: string;
  request: AnalysisRequest;
  result: Result | null;
  error: string | null;
}
export interface Episode {
  boundary_censored: boolean;
  start: string;
  end: string;
  duration: number;
  peak_c: number;
  mean_excess_c: number;
}
export interface EventPage {
  items: Episode[];
  total: number;
  offset: number;
  limit: number;
}
