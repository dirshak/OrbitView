import { useUiStore } from "../store/satellites";
import type { SatelliteRecord } from "../types/satellite";

interface SatelliteListProps {
  satellites: SatelliteRecord[];
}

const CATEGORY_DOT: Record<string, string> = {
  iss: "bg-amber-300",
  "earth-observation": "bg-cyan-300",
  weather: "bg-emerald-300",
  communication: "bg-pink-300",
  science: "bg-violet-300",
  navigation: "bg-yellow-300",
  cubesat: "bg-lime-300",
  other: "bg-slate-300",
};

export function SatelliteList({ satellites }: SatelliteListProps) {
  const selected = useUiStore((s) => s.selectedNoradId);
  const select = useUiStore((s) => s.selectSatellite);
  const favorites = useUiStore((s) => s.favorites);
  const toggleFavorite = useUiStore((s) => s.toggleFavorite);

  if (satellites.length === 0) {
    return (
      <div className="text-xs text-slate-400 px-2 py-3">
        No satellites match your filters.
      </div>
    );
  }

  return (
    <ul className="scrollbar-thin overflow-y-auto pr-1 space-y-0.5">
      {satellites.slice(0, 250).map((s) => {
        const isSelected = s.noradId === selected;
        const isFav = favorites.has(s.noradId);
        return (
          <li key={s.noradId}>
            <button
              type="button"
              onClick={() => select(s.noradId)}
              className={`group w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                isSelected
                  ? "bg-cyan-300/10 ring-1 ring-cyan-300/40 text-cyan-50"
                  : "hover:bg-white/5 text-slate-200"
              }`}
            >
              <span
                className={`inline-block size-2 rounded-full ${
                  CATEGORY_DOT[s.category] ?? CATEGORY_DOT.other
                }`}
              />
              <span className="truncate flex-1">{s.name}</span>
              <span className="text-[10px] tabular-nums text-slate-500">
                #{s.noradId}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(s.noradId);
                }}
                aria-label={isFav ? "Remove favorite" : "Add favorite"}
                className={`text-base leading-none transition ${
                  isFav ? "text-amber-300" : "text-slate-600 hover:text-amber-300"
                }`}
              >
                {isFav ? "★" : "☆"}
              </button>
            </button>
          </li>
        );
      })}
      {satellites.length > 250 && (
        <li className="px-2 py-2 text-[10px] text-slate-500">
          {satellites.length - 250} more — refine your search.
        </li>
      )}
    </ul>
  );
}
