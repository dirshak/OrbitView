import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe } from "./components/Globe";
import { CategoryFilter } from "./components/CategoryFilter";
import { SatelliteList } from "./components/SatelliteList";
import { SatelliteDetailPanel } from "./components/SatelliteDetailPanel";
import { MissionExplorer } from "./components/MissionExplorer";
import { AssistantPanel } from "./components/AssistantPanel";
import { ReentryWatch } from "./components/ReentryWatch";
import { HealthDashboard } from "./components/HealthDashboard";
import { loadCatalog } from "./lib/api";
import { useUiStore } from "./store/satellites";
import type { SatelliteRecord } from "./types/satellite";

export default function App() {
  const { data: satellites = [], isLoading, error } = useQuery<SatelliteRecord[]>({
    queryKey: ["catalog"],
    queryFn: loadCatalog,
  });

  const query = useUiStore((s) => s.query);
  const setQuery = useUiStore((s) => s.setQuery);
  const activeCategories = useUiStore((s) => s.activeCategories);
  const favorites = useUiStore((s) => s.favorites);
  const selectedNoradId = useUiStore((s) => s.selectedNoradId);
  const select = useUiStore((s) => s.selectSatellite);
  const showOrbitTrail = useUiStore((s) => s.showOrbitTrail);
  const setShowOrbitTrail = useUiStore((s) => s.setShowOrbitTrail);

  // Left-side overlays share one slot.
  const [overlay, setOverlay] = useState<"missions" | "assistant" | "reentry" | "health" | null>(null);
  const toggleOverlay = (o: NonNullable<typeof overlay>) => setOverlay((cur) => (cur === o ? null : o));
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of satellites) c[s.category] = (c[s.category] ?? 0) + 1;
    return c;
  }, [satellites]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return satellites.filter((s) => {
      if (showFavoritesOnly && !favorites.has(s.noradId)) return false;
      if (
        !activeCategories.has("all") &&
        !activeCategories.has(s.category)
      )
        return false;
      if (q) {
        const hay = `${s.name} ${s.noradId} ${s.operator ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [satellites, query, activeCategories, favorites, showFavoritesOnly]);

  const selected = useMemo(
    () => satellites.find((s) => s.noradId === selectedNoradId),
    [satellites, selectedNoradId]
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Globe satellites={satellites} visibleSatellites={filtered} />

      {/* Top brand strip */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <Logo />
          <div>
            <div className="text-sm font-semibold tracking-wide text-white">
              OrbitView
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/70">
              3D Satellite & Mission Tracker
            </div>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <HeaderButton active={overlay === "assistant"} onClick={() => toggleOverlay("assistant")} accent>
            ✦ Ask OrbitView
          </HeaderButton>
          <HeaderButton active={overlay === "reentry"} onClick={() => toggleOverlay("reentry")}>
            Re-entry Watch
          </HeaderButton>
          <HeaderButton active={overlay === "health"} onClick={() => toggleOverlay("health")}>
            Spacecraft Health
          </HeaderButton>
          <HeaderButton active={overlay === "missions"} onClick={() => toggleOverlay("missions")}>
            NASA Missions
          </HeaderButton>
          <a
            href="https://celestrak.org"
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-white/10 bg-space-900/70 px-3 py-1.5 text-xs text-slate-100 hover:border-cyan-300/40 hover:text-cyan-100"
          >
            Data: CelesTrak
          </a>
        </div>
      </header>

      {/* Left search/filter panel */}
      <aside className="panel pointer-events-auto absolute left-3 top-20 z-10 w-[320px] max-w-[calc(100vw-1.5rem)] flex flex-col max-h-[calc(100vh-7.5rem)]">
        <div className="border-b border-white/5 px-4 py-3 space-y-2">
          <input
            type="search"
            placeholder="Search by name, NORAD ID, or operator…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-space-950/80 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
          />
          <CategoryFilter counts={counts} />
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                className="accent-cyan-300"
                checked={showFavoritesOnly}
                onChange={(e) => setShowFavoritesOnly(e.target.checked)}
              />
              Favorites only ({favorites.size})
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                className="accent-cyan-300"
                checked={showOrbitTrail}
                onChange={(e) => setShowOrbitTrail(e.target.checked)}
              />
              Orbit trail
            </label>
          </div>
        </div>

        <div className="px-3 py-2 flex-1 min-h-0 flex flex-col">
          {isLoading && (
            <div className="text-xs text-slate-400 px-2 py-3">
              Loading satellite catalog…
            </div>
          )}
          {error && (
            <div className="text-xs text-amber-300 px-2 py-3">
              Failed to load catalog. Showing fallback data.
            </div>
          )}
          <SatelliteList satellites={filtered} />
        </div>

        <footer className="border-t border-white/5 px-4 py-2 text-[10px] text-slate-500">
          {satellites.length} objects · {filtered.length} matching
        </footer>
      </aside>

      {/* Detail panel — mounted only when a satellite is selected */}
      <SatelliteDetailPanel satellite={selected} onClose={() => select(null)} />

      {/* Left overlays — toggled from the header */}
      {overlay === "missions" && <MissionExplorer onClose={() => setOverlay(null)} />}
      {overlay === "assistant" && <AssistantPanel onClose={() => setOverlay(null)} />}
      {overlay === "reentry" && <ReentryWatch onClose={() => setOverlay(null)} />}
      {overlay === "health" && <HealthDashboard onClose={() => setOverlay(null)} />}

      <GlobeControls />

      {/* Footer note */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-4 py-2 text-[10px] text-slate-500">
        <span>
          Drag to rotate (or move, in Move mode) · Scroll to zoom · Click a marker to view satellite details
        </span>
        <span>TLE via CelesTrak · SGP4 propagation in browser</span>
      </footer>
    </div>
  );
}

function HeaderButton({
  active,
  accent = false,
  onClick,
  children,
}: {
  active: boolean;
  accent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tone = active
    ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
    : accent
      ? "border-cyan-300/30 bg-space-900/70 text-cyan-100 hover:border-cyan-300/60"
      : "border-white/10 bg-space-900/70 text-slate-100 hover:border-cyan-300/40 hover:text-cyan-100";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs ${tone}`}
    >
      {children}
    </button>
  );
}

function GlobeControls() {
  const autoRotate = useUiStore((s) => s.autoRotate);
  const setAutoRotate = useUiStore((s) => s.setAutoRotate);
  const panMode = useUiStore((s) => s.panMode);
  const setPanMode = useUiStore((s) => s.setPanMode);
  const resetView = useUiStore((s) => s.resetView);

  const base =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs transition-colors";
  const idle =
    "border-white/10 bg-space-900/80 text-slate-100 hover:border-cyan-300/40 hover:text-cyan-100";
  const active = "border-cyan-300/60 bg-cyan-300/15 text-cyan-100";

  return (
    <div className="pointer-events-auto absolute bottom-9 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/5 bg-space-950/60 p-1.5 backdrop-blur-md">
      <button
        type="button"
        aria-pressed={!autoRotate}
        onClick={() => setAutoRotate(!autoRotate)}
        className={`${base} ${autoRotate ? idle : active}`}
        title={autoRotate ? "Stop the globe from spinning" : "Resume spinning"}
      >
        <span aria-hidden="true">{autoRotate ? "❚❚" : "▶"}</span>
        <span className="hidden sm:inline">{autoRotate ? "Stop rotation" : "Start rotation"}</span>
      </button>
      <button
        type="button"
        aria-pressed={panMode}
        onClick={() => setPanMode(!panMode)}
        className={`${base} ${panMode ? active : idle}`}
        title="When on, dragging moves the globe around the screen instead of rotating it"
      >
        <span aria-hidden="true">✥</span>
        <span className="hidden sm:inline">{panMode ? "Move: on" : "Move globe"}</span>
      </button>
      <button
        type="button"
        onClick={resetView}
        className={`${base} ${idle}`}
        title="Re-centre, reset zoom and face Mumbai"
      >
        <span aria-hidden="true">⟲</span>
        <span className="hidden sm:inline">Reset view</span>
      </button>
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="lg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#5ce1ff" />
          <stop offset="60%" stopColor="#1f3b8c" />
          <stop offset="100%" stopColor="#05060a" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#lg)" />
      <ellipse
        cx="32"
        cy="32"
        rx="30"
        ry="10"
        fill="none"
        stroke="#5ce1ff"
        strokeWidth="1.5"
        opacity="0.7"
        transform="rotate(-25 32 32)"
      />
      <circle cx="58" cy="20" r="2.5" fill="#ffb547" />
    </svg>
  );
}
