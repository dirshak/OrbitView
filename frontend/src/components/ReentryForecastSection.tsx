import { useQuery } from "@tanstack/react-query";
import { fetchReentryForecast } from "../lib/ml";
import { formatDays } from "./ReentryWatch";

/** Per-satellite ML re-entry forecast shown in the detail panel. */
export function ReentryForecastSection({ noradId }: { noradId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reentry", noradId],
    queryFn: () => fetchReentryForecast(noradId),
    retry: false,
    staleTime: 10 * 60_000,
  });

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        Re-entry forecast <span className="pill bg-cyan-300/10 text-cyan-200">ML</span>
      </h3>
      {isLoading && <p className="text-xs text-slate-400">Scoring…</p>}
      {error && <p className="text-xs text-slate-500">{(error as Error).message}</p>}
      {data && !data.eligible && <p className="text-xs text-slate-400">{data.reason}</p>}
      {data?.eligible && (
        <div className="space-y-1.5 text-xs">
          <ProbabilityBar p={data.probabilityWithinYear ?? 0} />
          {data.stationKept && (
            <p className="rounded-md border border-cyan-300/20 bg-cyan-300/5 px-2 py-1 text-[11px] text-cyan-100">
              This satellite actively holds its orbit with thrusters. The forecast below is what passive decay would
              do if it stopped manoeuvring.
            </p>
          )}
          {data.likelyWithinYear ? (
            <p className="text-slate-200">
              Expected to re-enter in <span className="font-semibold text-amber-200">{formatDays(data.daysP50)}</span>{" "}
              (around {data.predictedDate}). 80% window: {data.windowStart} → {data.windowEnd}.
            </p>
          ) : (
            <p className="text-slate-300">Not expected to re-enter within the next 12 months.</p>
          )}
          <p className="text-[10px] text-slate-500">
            Perigee {data.perigeeKm?.toFixed(0)} km · statistical estimate from orbit decay history; ignores
            manoeuvres and controlled de-orbits.
          </p>
        </div>
      )}
    </section>
  );
}

function ProbabilityBar({ p }: { p: number }) {
  const pct = Math.round(p * 100);
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>Chance of re-entry within 1 year</span>
        <span className="tabular-nums text-slate-100">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full ${pct >= 50 ? "bg-amber-300" : "bg-cyan-300/70"}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}
