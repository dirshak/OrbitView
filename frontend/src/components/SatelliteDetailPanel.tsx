import { useEffect, useMemo, useState } from "react";
import { propagatePosition, predictPasses } from "../lib/propagation";
import type { PassWindow, SatelliteRecord } from "../types/satellite";
import { useUiStore } from "../store/satellites";
import { PassPrediction } from "./PassPrediction";

interface DetailProps {
  satellite: SatelliteRecord | undefined;
  onClose: () => void;
}

export function SatelliteDetailPanel({ satellite, onClose }: DetailProps) {
  const favorites = useUiStore((s) => s.favorites);
  const toggleFavorite = useUiStore((s) => s.toggleFavorite);
  const userLocation = useUiStore((s) => s.userLocation);
  const [tick, setTick] = useState(0);
  const [passes, setPasses] = useState<PassWindow[] | null>(null);
  const [loadingPasses, setLoadingPasses] = useState(false);

  useEffect(() => {
    if (!satellite) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [satellite]);

  useEffect(() => {
    if (!satellite || !userLocation) {
      setPasses(null);
      return;
    }
    setLoadingPasses(true);
    const handle = setTimeout(() => {
      const result = predictPasses(satellite, userLocation, {
        hours: 72,
        stepSeconds: 30,
        maxPasses: 5,
      });
      setPasses(result);
      setLoadingPasses(false);
    }, 0);
    return () => clearTimeout(handle);
  }, [satellite, userLocation]);

  const position = useMemo(() => {
    if (!satellite) return null;
    return propagatePosition(satellite, new Date());
    // tick is intentionally a dependency to force re-eval each second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satellite, tick]);

  if (!satellite) return null;

  const isFav = favorites.has(satellite.noradId);

  return (
    <aside className="panel pointer-events-auto absolute right-3 top-3 z-20 w-[360px] max-w-[calc(100vw-1.5rem)] flex flex-col max-h-[calc(100vh-1.5rem)]">
      <header className="flex items-start gap-2 border-b border-white/5 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="pill bg-white/5 text-cyan-200">
              {prettyCategory(satellite.category)}
            </span>
            {satellite.orbitType && (
              <span className="pill bg-white/5 text-slate-300">
                {satellite.orbitType}
              </span>
            )}
          </div>
          <h2 className="mt-1 text-sm font-semibold text-white truncate">
            {satellite.name}
          </h2>
          <p className="text-[11px] text-slate-400">NORAD #{satellite.noradId}</p>
        </div>
        <button
          type="button"
          onClick={() => toggleFavorite(satellite.noradId)}
          aria-label={isFav ? "Remove favorite" : "Add favorite"}
          className={`text-lg leading-none ${
            isFav ? "text-amber-300" : "text-slate-500 hover:text-amber-300"
          }`}
        >
          {isFav ? "★" : "☆"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="text-slate-500 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </header>

      <div className="scrollbar-thin overflow-y-auto px-4 py-3 space-y-4">
        {satellite.missionDescription && (
          <p className="text-xs text-slate-300 leading-relaxed">
            {satellite.missionDescription}
          </p>
        )}

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            Live position
          </h3>
          {position ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <Stat label="Latitude" value={`${position.latitudeDeg.toFixed(2)}°`} />
              <Stat label="Longitude" value={`${position.longitudeDeg.toFixed(2)}°`} />
              <Stat
                label="Altitude"
                value={`${position.altitudeKm.toFixed(0)} km`}
              />
              <Stat
                label="Speed"
                value={`${position.velocityKmS.toFixed(2)} km/s`}
              />
            </dl>
          ) : (
            <p className="text-xs text-amber-300">
              Propagation failed for this TLE — orbit data may be stale.
            </p>
          )}
        </section>

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            Mission
          </h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {satellite.operator && (
              <Stat label="Operator" value={satellite.operator} colSpan={2} />
            )}
            {satellite.country && (
              <Stat label="Country" value={satellite.country} />
            )}
            {satellite.launchDate && (
              <Stat label="Launched" value={satellite.launchDate} />
            )}
            <Stat label="Source" value={satellite.dataSource} colSpan={2} />
          </dl>
        </section>

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
            Upcoming passes
          </h3>
          <PassPrediction
            satellite={satellite}
            passes={passes}
            loading={loadingPasses}
          />
        </section>
      </div>
    </aside>
  );
}

function Stat({
  label,
  value,
  colSpan = 1,
}: {
  label: string;
  value: string;
  colSpan?: 1 | 2;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="text-slate-100 tabular-nums truncate">{value}</dd>
    </div>
  );
}

function prettyCategory(c: string): string {
  switch (c) {
    case "iss":
      return "ISS / Station";
    case "earth-observation":
      return "Earth obs.";
    case "weather":
      return "Weather";
    case "communication":
      return "Comms";
    case "science":
      return "Science";
    case "navigation":
      return "Navigation";
    case "cubesat":
      return "CubeSat / Student";
    default:
      return "Other";
  }
}
