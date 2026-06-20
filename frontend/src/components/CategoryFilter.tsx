import { useUiStore } from "../store/satellites";
import type { SatelliteCategory } from "../types/satellite";

interface CategoryFilterProps {
  counts: Record<string, number>;
}

const CATEGORIES: {
  key: SatelliteCategory | "all";
  label: string;
  swatch: string;
}[] = [
  { key: "all", label: "All", swatch: "bg-white" },
  { key: "iss", label: "ISS / Stations", swatch: "bg-amber-300" },
  { key: "earth-observation", label: "Earth obs.", swatch: "bg-cyan-300" },
  { key: "weather", label: "Weather", swatch: "bg-emerald-300" },
  { key: "communication", label: "Comms", swatch: "bg-pink-300" },
  { key: "science", label: "Science", swatch: "bg-violet-300" },
  { key: "navigation", label: "Navigation", swatch: "bg-yellow-300" },
  { key: "cubesat", label: "CubeSats / Student", swatch: "bg-lime-300" },
  { key: "other", label: "Other", swatch: "bg-slate-300" },
];

export function CategoryFilter({ counts }: CategoryFilterProps) {
  const active = useUiStore((s) => s.activeCategories);
  const toggle = useUiStore((s) => s.toggleCategory);

  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((c) => {
        const isActive = active.has(c.key);
        const count = c.key === "all"
          ? Object.values(counts).reduce((a, b) => a + b, 0)
          : counts[c.key] ?? 0;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            className={`pill border transition ${
              isActive
                ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 text-slate-300 hover:border-white/30"
            }`}
          >
            <span className={`mr-1.5 inline-block size-2 rounded-full ${c.swatch}`} />
            {c.label}
            <span className="ml-1.5 text-[9px] opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
