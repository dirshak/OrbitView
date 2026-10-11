import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { fetchMlHealth, sendChat, type ChatTurn } from "../lib/ml";
import { useUiStore } from "../store/satellites";

const SUGGESTIONS = [
  "When can I see the ISS from Mumbai this week?",
  "Which satellites are expected to re-enter in the next 30 days?",
  "Where is Hubble right now?",
  "Find Indian Earth-observation satellites like Cartosat",
];

// Conversation survives closing and reopening the panel.
const useChatStore = create<{
  turns: ChatTurn[];
  pending: boolean;
  push: (t: ChatTurn) => void;
  setPending: (v: boolean) => void;
  clear: () => void;
}>((set) => ({
  turns: [],
  pending: false,
  push: (t) => set((s) => ({ turns: [...s.turns, t] })),
  setPending: (v) => set({ pending: v }),
  clear: () => set({ turns: [] }),
}));

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { turns, pending, push, setPending, clear } = useChatStore();
  const userLocation = useUiStore((s) => s.userLocation);
  const selectedNoradId = useUiStore((s) => s.selectedNoradId);
  const select = useUiStore((s) => s.selectSatellite);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { data: health } = useQuery({ queryKey: ["ml-health"], queryFn: fetchMlHealth, retry: false });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, pending]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setDraft("");
    const userTurn: ChatTurn = { role: "user", content: question };
    push(userTurn);
    setPending(true);
    try {
      const res = await sendChat([...useChatStore.getState().turns], {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: userLocation,
        selectedNoradId,
      });
      push({ role: "assistant", content: res.reply, satellites: res.satellites, toolsUsed: res.toolsUsed });
    } catch (err) {
      push({ role: "assistant", content: (err as Error).message, error: true });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="panel pointer-events-auto absolute left-3 top-3 z-30 flex h-[min(680px,calc(100vh-1.5rem))] w-[440px] max-w-[calc(100vw-1.5rem)] flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Ask OrbitView</h2>
          <p className="truncate text-[11px] text-slate-400">
            AI assistant · Groq{health?.assistantModel ? ` · ${health.assistantModel}` : ""} · uses live data
          </p>
        </div>
        <div className="flex items-center gap-3">
          {turns.length > 0 && (
            <button type="button" onClick={clear} className="text-[11px] text-slate-400 hover:text-white">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-lg leading-none text-slate-500 hover:text-white"
          >
            ×
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {health && !health.assistantConfigured && (
          <div className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            The assistant isn't connected yet. Add your key to <code>GROQ_API_KEY</code> in{" "}
            <code>.env</code>, then run <code>docker compose up -d ml-service</code>.
          </div>
        )}

        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Ask about passes over your city, where a satellite is, or what's about to re-enter. Answers come from
              OrbitView's live catalogue and its re-entry models.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-left text-xs text-slate-200 hover:border-cyan-300/40 hover:text-cyan-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-8 rounded-lg bg-cyan-300/10 px-3 py-2 text-xs text-cyan-50">
              {t.content}
            </div>
          ) : (
            <div
              key={i}
              className={`mr-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                t.error ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : "border-white/5 bg-white/[0.03] text-slate-200"
              }`}
            >
              <RichText text={t.content} />
              {t.satellites && t.satellites.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.satellites.map((s) => (
                    <button
                      key={s.noradId}
                      type="button"
                      onClick={() => select(s.noradId)}
                      className="rounded-full border border-cyan-300/30 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-300/10"
                      title="Show on globe"
                    >
                      ◎ {s.name}
                    </button>
                  ))}
                </div>
              )}
              {t.toolsUsed && t.toolsUsed.length > 0 && (
                <div className="mt-1.5 text-[10px] text-slate-500">
                  used: {[...new Set(t.toolsUsed)].join(", ")}
                </div>
              )}
            </div>
          )
        )}

        {pending && <div className="text-xs text-slate-400 animate-pulse">Thinking…</div>}
      </div>

      <form
        className="flex gap-2 border-t border-white/5 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about satellites, passes, re-entries…"
          maxLength={1000}
          className="flex-1 rounded-md border border-white/10 bg-space-950/80 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

/** Minimal markdown: paragraphs, "-"/"*"/"1." lists and **bold**. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="my-1 list-disc space-y-0.5 pl-4">
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      list.push(item[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={blocks.length} className="my-1">{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}
