const ML_BASE = "/ml";

export interface ReentryForecast {
  noradId: number;
  name?: string;
  eligible: boolean;
  reason?: string;
  perigeeKm?: number;
  apogeeKm?: number;
  probabilityWithinYear?: number;
  likelyWithinYear?: boolean;
  stationKept?: boolean;
  tleEpoch?: string;
  daysP10?: number;
  daysP50?: number;
  daysP90?: number;
  predictedDate?: string;
  windowStart?: string;
  windowEnd?: string;
}

export interface BucketMetrics {
  rows: number;
  objects: number;
  mae_days: number;
  median_abs_error_days: number;
  baseline_mae_days: number;
  baseline_median_abs_error_days: number;
  interval_coverage: number;
}

export interface ModelCard {
  trained_at: string;
  data: {
    source: string;
    history_from: string;
    history_to: string;
    rows: number;
    objects: number;
    reentered_objects: number;
    split: string;
  };
  classifier: {
    roc_auc: number;
    average_precision: number;
    precision: number;
    recall: number;
    f1: number;
    baseline_physics: { precision: number; recall: number; f1: number };
  };
  regression: Record<string, BucketMetrics>;
  interval?: { nominal: number; coverage_before_calibration: number; coverage_after_calibration: number };
  feature_importance: { feature: string; importance: number }[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  satellites?: { noradId: number; name: string }[];
  toolsUsed?: string[];
  error?: boolean;
}

export interface ChatContext {
  timezone: string;
  location: { latitudeDeg: number; longitudeDeg: number; label: string } | null;
  selectedNoradId: number | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${ML_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as T;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (body.detail) return body.detail;
  } catch {
    // not JSON
  }
  return `ML service error (${res.status})`;
}

export const fetchReentryForecast = (noradId: number) =>
  getJson<ReentryForecast>(`/reentry/${noradId}`);

export const fetchUpcomingReentries = (withinDays = 365, limit = 100, includeStationKept = false) =>
  getJson<{ scoredAt: string | null; stationKeptExcluded: number; items: ReentryForecast[] }>(
    `/reentry?within_days=${withinDays}&limit=${limit}&include_station_kept=${includeStationKept}`
  );

export const fetchModelCard = () => getJson<ModelCard>("/reentry/model-card");

export const fetchMlHealth = () =>
  getJson<{ assistantConfigured: boolean; assistantModel: string; scoredObjects: number }>("/health");

export async function sendChat(
  history: ChatTurn[],
  context: ChatContext
): Promise<{ reply: string; satellites: { noradId: number; name: string }[]; toolsUsed: string[] }> {
  const res = await fetch(`${ML_BASE}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history.filter((t) => !t.error).map(({ role, content }) => ({ role, content })),
      context,
    }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

// ---- Spacecraft Health (NASA SMAP/MSL telemetry anomaly detection) ----

export interface DetectionStats {
  anomalies: number;
  detected: number;
  missed: number;
  false_alarms: number;
  precision: number;
  recall: number;
  f1: number;
  median_detection_delay_steps: number | null;
}

type BySpacecraft<T> = { SMAP: T; MSL: T; total: T };

export interface TelemetryChannelSummary {
  key: string;
  id: string;
  spacecraft: "SMAP" | "MSL";
  length: number;
  detected: number;
  missed: number;
  falseAlarms: number;
  baselineDetected: number;
  baselineFalseAlarms: number;
  labelled: number;
  alerts: number;
}

export interface TelemetrySummary {
  metrics: {
    dataset: { name: string; channels: number; anomalies: number; test_values: number };
    method: Record<string, string | number>;
    results: {
      model: BySpacecraft<DetectionStats>;
      out_of_limits: BySpacecraft<DetectionStats>;
      telemanom_published: BySpacecraft<{ precision: number; recall: number }>;
    };
  };
  channels: TelemetryChannelSummary[];
}

export interface Interval {
  start: number;
  end: number;
}

export interface TelemetryChannel {
  key: string;
  id: string;
  spacecraft: "SMAP" | "MSL";
  length: number;
  threshold: number | null;
  labelled: (Interval & { class: string })[];
  alerts: (Interval & { peak_error: number })[];
  outOfLimits: Interval[];
  detected: number;
  missed: number;
  falseAlarms: number;
  value: { x: number[]; y: number[] };
  predicted: { x: number[]; y: (number | null)[] };
  error: { x: number[]; y: number[] };
}

export const fetchTelemetrySummary = () => getJson<TelemetrySummary>("/telemetry/summary");

export const fetchTelemetryChannel = (key: string) =>
  getJson<TelemetryChannel>(`/telemetry/channels/${encodeURIComponent(key)}?points=1200`);
