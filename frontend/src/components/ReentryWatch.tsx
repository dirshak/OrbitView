import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchModelCard, fetchUpcomingReentries, type ModelCard } from "../lib/ml";
import { useUiStore } from "../store/satellites";

const HORIZONS = [7, 30, 90, 365] as const;

export function ReentryWatch({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"upcoming" | "model">("upcoming");
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30);
  const select = useUiStore((s) => s.selectSatellite);

  const upcoming = useQuery({
    queryKey: ["reentry-upcoming", horizon],
    queryFn: () => fetchUpcomingReentries(horizon, 200),
    refetchInterval: 10 * 60_000,
  });
  const card = useQuery({ queryKey: ["reentry-model-card"], queryFn: fetchModelCard, enabled: tab === "model" });
  const items = upcoming.data?.items ?? [];

  return (
    <div className="panel pointer-events-auto absolute left-3 top-3 z-30 flex max-h-[calc(100vh-1.5rem)] w-[440px] max-w-[calc(100vw-1.5rem)] flex-col">
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Re-entry Watch</h2>
          <p className="text-[11px] text-slate-400">
            Machine-learning forecasts of objects falling back to Earth.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-slate-500 hover:text-white">
          ×
        </button>
      </header>

      <div className="flex gap-1 border-b border-white/5 px-3 pt-2">
        {(["upcoming", "model"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t-md px-3 py-1.5 text-xs ${
              tab === t ? "bg-white/5 text-cyan-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t === "upcoming" ? "Upcoming" : "Model card"}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin overflow-y-auto p-3">
        {tab === "upcoming" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              Within
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizon(h)}
                  className={`rounded-full border px-2 py-0.5 ${
                    horizon === h ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {h === 365 ? "1 year" : `${h} days`}
                </button>
              ))}
            </div>
            {upcoming.isLoading && <p className="text-xs text-slate-400">Loading forecasts…</p>}
            {upcoming.error && (
              <p className="text-xs text-amber-300">
                ML service unavailable: {(upcoming.error as Error).message}
              </p>
            )}
            {upcoming.data && (
              <p className="text-[11px] text-slate-500">
                {items.length} object{items.length === 1 ? "" : "s"} predicted
                {upcoming.data.scoredAt && ` · scored ${new Date(upcoming.data.scoredAt).toLocaleString()}`}
                {upcoming.data.stationKeptExcluded > 0 &&
                  ` · ${upcoming.data.stationKeptExcluded.toLocaleString()} actively station-kept satellites (e.g. operational Starlinks) hidden — they use thrusters to hold altitude`}
              </p>
            )}
            <ul className="space-y-1.5">
              {items.map((f) => (
                <li key={f.noradId}>
                  <button
                    type="button"
                    onClick={() => select(f.noradId)}
                    className="w-full rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-left hover:border-cyan-300/30"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-slate-100">{f.name}</span>
                      <span className="shrink-0 tabular-nums text-amber-200">{formatDays(f.daysP50)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                      <span>
                        #{f.noradId} · perigee {f.perigeeKm?.toFixed(0)} km
                      </span>
                      <span>
                        {f.windowStart} → {f.windowEnd}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ModelCardView card={card.data} loading={card.isLoading} />
        )}
      </div>
    </div>
  );
}

function ModelCardView({ card, loading }: { card: ModelCard | undefined; loading: boolean }) {
  if (loading || !card) return <p className="text-xs text-slate-400">Loading model card…</p>;
  const c = card.classifier;
  const buckets = Object.entries(card.regression);
  return (
    <div className="space-y-4 text-xs text-slate-300">
      <section className="space-y-1">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Data</h3>
        <p>
          {card.data.rows.toLocaleString()} daily orbit snapshots of {card.data.objects.toLocaleString()} low-orbit objects (
          {card.data.history_from} → {card.data.history_to}); {card.data.reentered_objects.toLocaleString()} of them
          re-entered. {card.data.source}.
        </p>
        <p className="text-slate-500">Test set: {card.data.split}. Trained {new Date(card.trained_at).toLocaleDateString()}.</p>
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">
          Model 1 · Will it re-enter within a year? (gradient-boosted classifier)
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <Metric label="ROC AUC" value={c.roc_auc.toFixed(3)} />
          <Metric label="Avg precision" value={c.average_precision.toFixed(3)} />
          <Metric label="F1" value={c.f1.toFixed(3)} sub={`physics ${c.baseline_physics.f1.toFixed(3)}`} />
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">
          Models 2–4 · Days until re-entry (quantile regressors, 10th/50th/90th percentile)
        </h3>
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-left font-normal">Actual horizon</th>
              <th className="text-right font-normal">ML median err</th>
              <th className="text-right font-normal">Physics</th>
              <th className="text-right font-normal">80% window hit</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map(([name, b]) => (
              <tr key={name} className="border-t border-white/5">
                <td className="py-1">{name === "overall" ? "All ≤ 365 d" : name.replace("d", " days")}</td>
                <td className="text-right text-cyan-100">{b.median_abs_error_days.toFixed(1)} d</td>
                <td className="text-right text-slate-400">{b.baseline_median_abs_error_days.toFixed(1)} d</td>
                <td className="text-right">{(b.interval_coverage * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-slate-500">
          Physics baseline = exponential-atmosphere (scale-height) lifetime from today's decay rate.
          {card.interval &&
            ` 80% window calibrated with conformal prediction: ${(card.interval.coverage_before_calibration * 100).toFixed(0)}% → ${(card.interval.coverage_after_calibration * 100).toFixed(0)}% of test re-entries fall inside.`}
        </p>
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500">What drives the forecast</h3>
        {card.feature_importance.slice(0, 6).map((f) => {
          const max = card.feature_importance[0].importance || 1;
          return (
            <div key={f.feature} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-[11px] text-slate-400">{FEATURE_LABELS[f.feature] ?? f.feature}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                <span className="block h-full bg-cyan-300/70" style={{ width: `${Math.max(2, (f.importance / max) * 100)}%` }} />
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm tabular-nums text-white">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  perigee_km: "Perigee altitude",
  apogee_km: "Apogee altitude",
  eccentricity: "Eccentricity",
  inclination: "Inclination",
  mean_motion: "Orbits per day",
  ndot: "Decay rate (ṅ)",
  bstar: "Drag term (B*)",
  ndot_over_n: "Relative decay",
  physics_days: "Physics estimate",
  object_type: "Object type",
  rcs_m2: "Radar size",
  age_days: "Age in orbit",
  is_starlink: "Starlink",
  f107_obs: "Solar flux today",
  f107_last81: "Solar flux (81 d)",
};

export function formatDays(days: number | undefined): string {
  if (days == null) return "—";
  if (days < 1) return `~${Math.max(1, Math.round(days * 24))} h`;
  if (days < 60) return Math.round(days) === 1 ? "~1 day" : `~${Math.round(days)} days`;
  return `~${(days / 30.4).toFixed(1)} months`;
}
