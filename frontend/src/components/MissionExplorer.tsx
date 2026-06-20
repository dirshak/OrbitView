import { useQuery } from "@tanstack/react-query";
import { loadMissions, type MissionRecord } from "../lib/api";
import { useUiStore } from "../store/satellites";

interface MissionExplorerProps {
  onClose: () => void;
}

export function MissionExplorer({ onClose }: MissionExplorerProps) {
  const select = useUiStore((s) => s.selectSatellite);
  const { data: missions = [], isLoading } = useQuery<MissionRecord[]>({
    queryKey: ["missions"],
    queryFn: loadMissions,
  });

  return (
    <div className="panel pointer-events-auto absolute left-3 top-3 z-30 w-[480px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-1.5rem)] flex flex-col">
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">NASA Mission Explorer</h2>
          <p className="text-[11px] text-slate-400">
            Curated mission profiles with imagery and links to NASA resources.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-slate-500 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </header>

      <div className="scrollbar-thin overflow-y-auto p-3 space-y-3">
        {isLoading && (
          <div className="text-xs text-slate-400">Loading missions…</div>
        )}
        {missions.map((m) => (
          <article
            key={m.id}
            className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden"
          >
            {m.imageUrl && (
              <div className="aspect-[16/9] bg-black">
                <img
                  src={m.imageUrl}
                  alt={m.name}
                  className="h-full w-full object-cover opacity-90"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
            <div className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-white">{m.name}</h3>
                <span className="pill bg-white/5 text-slate-300">{m.agency}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{m.description}</p>
              <div className="flex items-center gap-3 pt-1">
                <a
                  href={m.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-cyan-300 hover:text-cyan-200"
                >
                  Mission page ↗
                </a>
                {m.noradId != null && (
                  <button
                    type="button"
                    className="text-xs text-cyan-300 hover:text-cyan-200"
                    onClick={() => {
                      select(m.noradId!);
                      onClose();
                    }}
                  >
                    Track on globe →
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
