import { useUiStore } from "../store/satellites";
import type { PassWindow, SatelliteRecord } from "../types/satellite";

interface PassProps {
  satellite: SatelliteRecord;
  passes: PassWindow[] | null;
  loading: boolean;
}

export function PassPrediction({ satellite, passes, loading }: PassProps) {
  const userLocation = useUiStore((s) => s.userLocation);
  const setUserLocation = useUiStore((s) => s.setUserLocation);

  if (!userLocation) {
    return <LocationPrompt onSet={setUserLocation} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>
          From <span className="text-slate-200">{userLocation.label}</span>
        </span>
        <button
          type="button"
          className="text-cyan-300 hover:text-cyan-200"
          onClick={() => setUserLocation(null)}
        >
          change
        </button>
      </div>

      {loading && (
        <div className="text-xs text-slate-400">Calculating passes…</div>
      )}

      {!loading && passes && passes.length === 0 && (
        <div className="text-xs text-slate-400">
          No passes above the horizon in the next 72 hours.
        </div>
      )}

      {!loading && passes && passes.length > 0 && (
        <ul className="space-y-1.5">
          {passes.map((p) => (
            <li
              key={p.startTime}
              className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-100 font-medium">
                  {formatDate(p.startTime)}
                </span>
                <span className="text-cyan-200 tabular-nums">
                  max {p.maxElevationDeg.toFixed(0)}°
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                <span>
                  {formatTime(p.startTime)} → {formatTime(p.endTime)} (
                  {durationMin(p.startTime, p.endTime)} min)
                </span>
                <VisibilityBar score={p.visibilityScore} />
              </div>
              <div className="mt-1.5">
                <button
                  type="button"
                  className="text-[11px] text-cyan-300 hover:text-cyan-200"
                  onClick={() => downloadIcs(satellite, p)}
                >
                  + Add to calendar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocationPrompt({
  onSet,
}: {
  onSet: (l: { latitudeDeg: number; longitudeDeg: number; label: string }) => void;
}) {
  const useGeolocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onSet({
          latitudeDeg: pos.coords.latitude,
          longitudeDeg: pos.coords.longitude,
          label: `My location (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`,
        });
      },
      () => {
        // ignore — user can use one of the presets.
      }
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Set a location to predict visible passes for this satellite.
      </p>
      <button
        type="button"
        onClick={useGeolocation}
        className="w-full rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-300/15"
      >
        Use my location
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onSet(p)}
            className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-200 hover:border-white/30"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const PRESETS = [
  { label: "New York", latitudeDeg: 40.7128, longitudeDeg: -74.006 },
  { label: "London", latitudeDeg: 51.5074, longitudeDeg: -0.1278 },
  { label: "Tokyo", latitudeDeg: 35.6762, longitudeDeg: 139.6503 },
  { label: "Sydney", latitudeDeg: -33.8688, longitudeDeg: 151.2093 },
];

function VisibilityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct > 70 ? "bg-emerald-300" : pct > 40 ? "bg-cyan-300" : "bg-slate-500";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1 w-12 rounded-full bg-white/10 overflow-hidden">
        <span className={`block h-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-7 text-right text-slate-400">{pct}</span>
    </span>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function durationMin(a: number, b: number): number {
  return Math.max(1, Math.round((b - a) / 60_000));
}

function downloadIcs(sat: SatelliteRecord, p: PassWindow): void {
  const dt = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      d.getUTCFullYear().toString() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      "Z"
    );
  };
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTrack//Pass//EN",
    "BEGIN:VEVENT",
    `UID:${sat.noradId}-${p.startTime}@astrotrack`,
    `DTSTAMP:${dt(Date.now())}`,
    `DTSTART:${dt(p.startTime)}`,
    `DTEND:${dt(p.endTime)}`,
    `SUMMARY:${sat.name} pass (max ${p.maxElevationDeg.toFixed(0)}°)`,
    `DESCRIPTION:Visible satellite pass for ${sat.name}. Peak ${dt(p.peakTime)}, max elevation ${p.maxElevationDeg.toFixed(1)}°.`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sat.name.replace(/[^A-Za-z0-9]+/g, "_")}_pass.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
