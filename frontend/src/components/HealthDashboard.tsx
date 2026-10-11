import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTelemetryChannel,
  fetchTelemetrySummary,
  type Interval,
  type TelemetryChannel,
  type TelemetryChannelSummary,
  type TelemetrySummary,
} from "../lib/ml";
import { BAND_STYLE, TelemetryChart, valueAt, type ChartBand } from "./TelemetryChart";

const MEASURED = "#3987e5";
const PREDICTED = "#d95926";
const SPEEDS = [1, 5, 20] as const; // x 100 steps per second
type Filter = "all" | "SMAP" | "MSL" | "missed" | "false";

const overlaps = (a: Interval, b: Interval) => a.start <= b.end && b.start <= a.end;

/** Replay of real NASA spacecraft telemetry with the ML anomaly detector's alerts. */
export function HealthDashboard({ onClose }: { onClose: () => void }) {
  const summary = useQuery({ queryKey: ["telemetry-summary"], queryFn: fetchTelemetrySummary });
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const channels = summary.data?.channels ?? [];
  useEffect(() => {
    // Open on a channel where the model caught an anomaly.
    if (!selected && channels.length) setSelected((channels.find((c) => c.detected > 0) ?? channels[0]).key);
  }, [channels, selected]);

  const shown = channels.filter((c) =>
    filter === "all" ? true
      : filter === "missed" ? c.missed > 0
      : filter === "false" ? c.falseAlarms > 0
      : c.spacecraft === filter
  );

  return (
    <div className="panel pointer-events-auto absolute inset-3 z-40 flex flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Spacecraft Health Monitor</h2>
          <p className="text-[11px] text-slate-400">
            Replay of real telemetry from NASA's SMAP satellite and the Curiosity rover (MSL), with alerts from
            OrbitView's anomaly-detection model. Values are normalised and channel names anonymised by NASA.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-slate-500 hover:text-white">
          ×
        </button>
      </header>

      {summary.isLoading && <p className="p-4 text-xs text-slate-400">Loading telemetry…</p>}
      {summary.error && (
        <p className="p-4 text-xs text-amber-300">ML service unavailable: {(summary.error as Error).message}</p>
      )}
      {summary.data && <Scorecard data={summary.data.metrics.results} />}

      {summary.data && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[230px_1fr] lg:overflow-hidden">
          <ChannelList channels={shown} filter={filter} setFilter={setFilter} selected={selected} onSelect={setSelected} />
          {selected && <ChannelView key={selected} channelKey={selected} />}
        </div>
      )}
    </div>
  );
}

function Scorecard({ data }: { data: TelemetrySummary["metrics"]["results"] }) {
  const m = data.model.total;
  const o = data.out_of_limits.total;
  const nasa = data.telemanom_published.total;
  return (
    <section className="border-b border-white/5 px-4 py-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Anomalies caught" value={`${m.detected} / ${m.anomalies}`} sub={`${pct(m.recall)} recall`} />
        <Tile label="Alert precision" value={pct(m.precision)} sub={`${m.false_alarms} false alarms`} />
        <Tile
          label="Baseline: out-of-limits checks"
          value={`${pct(o.recall)} caught`}
          sub={`${pct(o.precision)} precision · ${o.false_alarms} false alarms`}
          muted
        />
        <Tile
          label="NASA/JPL Telemanom (published)"
          value={`${pct(nasa.recall)} caught`}
          sub={`${pct(nasa.precision)} precision · performs better`}
          muted
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        Our gradient-boosting detector raises far fewer false alarms than simple limit checks, but catches only about a
        third of the 105 labelled anomalies. NASA/JPL's LSTM-based detector (Telemanom, Hundman et al., KDD 2018)
        performs better on this benchmark: {pct(nasa.recall)} caught at {pct(nasa.precision)} precision.
      </p>
    </section>
  );
}

function Tile({ label, value, sub, muted = false }: { label: string; value: string; sub: string; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-lg ${muted ? "text-slate-300" : "text-white"}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}

function ChannelList({
  channels,
  filter,
  setFilter,
  selected,
  onSelect,
}: {
  channels: TelemetryChannelSummary[];
  filter: Filter;
  setFilter: (f: Filter) => void;
  selected: string | null;
  onSelect: (k: string) => void;
}) {
  const filters: [Filter, string][] = [["all", "All"], ["SMAP", "SMAP"], ["MSL", "MSL"], ["missed", "Missed"], ["false", "False alarms"]];
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-white/5 bg-white/[0.02] max-lg:max-h-72">
      <div className="flex flex-wrap gap-1 border-b border-white/5 p-2">
        {filters.map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              filter === f ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-300 hover:border-white/30"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
        {channels.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              onClick={() => onSelect(c.key)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                selected === c.key ? "bg-cyan-300/10 text-white" : "text-slate-300 hover:bg-white/5"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-medium tabular-nums">{c.key}</span>
                <span className="text-[10px] text-slate-500">{c.spacecraft}</span>
              </span>
              <span className="flex items-center gap-2 text-[10px] tabular-nums">
                <span className={c.missed ? "text-slate-400" : "text-emerald-300"} title="Labelled anomalies caught">
                  {c.missed ? "◐" : "✓"} {c.detected}/{c.labelled}
                </span>
                {c.falseAlarms > 0 && (
                  <span className="text-amber-300" title="False alarms">⚠ {c.falseAlarms}</span>
                )}
              </span>
            </button>
          </li>
        ))}
        {channels.length === 0 && <li className="px-2 py-3 text-xs text-slate-500">No channels match.</li>}
      </ul>
    </aside>
  );
}

function ChannelView({ channelKey }: { channelKey: string }) {
  const { data: ch, isLoading, error } = useQuery({
    queryKey: ["telemetry-channel", channelKey],
    queryFn: () => fetchTelemetryChannel(channelKey),
    staleTime: Infinity,
  });
  const [cursor, setCursor] = useState(Infinity);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(5);
  const [hover, setHover] = useState<number | null>(null);
  const [showLimits, setShowLimits] = useState(false);

  const length = ch?.length ?? 0;
  const at = Math.min(cursor, length);

  useEffect(() => {
    if (!playing || !ch) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCursor((c) => {
        const next = (Number.isFinite(c) ? c : 0) + dt * speed * 100;
        if (next >= ch.length) { setPlaying(false); return Infinity; }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, ch]);

  const bands: ChartBand[] = useMemo(() => {
    if (!ch) return [];
    return [
      ...ch.labelled.map((l) => ({ start: l.start, end: l.end, kind: "labelled" as const })),
      ...ch.alerts.map((a) => ({ start: a.start, end: a.end, kind: "alert" as const })),
      ...(showLimits ? ch.outOfLimits.map((o) => ({ ...o, kind: "limit" as const })) : []),
    ];
  }, [ch, showLimits]);

  if (isLoading) return <p className="text-xs text-slate-400">Loading channel…</p>;
  if (error || !ch) return <p className="text-xs text-amber-300">Could not load channel.</p>;

  const valueLines = [
    { name: "Measured", x: ch.value.x, y: ch.value.y, color: MEASURED, width: 1.5 },
    { name: "Model prediction", x: ch.predicted.x, y: ch.predicted.y, color: PREDICTED, width: 1, opacity: 0.85 },
  ];
  const errorLines = [{ name: "Prediction error", x: ch.error.x, y: ch.error.y, color: MEASURED, width: 1.5 }];
  const readout = hover == null ? null : {
    measured: valueAt(ch.value, hover),
    predicted: valueAt(ch.predicted, hover),
    error: valueAt(ch.error, hover),
  };

  return (
    <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1fr_260px]">
      <section className="min-w-0 space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 lg:overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Channel {ch.key} <span className="text-xs font-normal text-slate-400">· {ch.spacecraft === "SMAP" ? "SMAP satellite" : "Curiosity rover (MSL)"} · {ch.length.toLocaleString()} steps</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Caught {ch.detected} of {ch.labelled.length} labelled anomal{ch.labelled.length === 1 ? "y" : "ies"} ·{" "}
              {ch.falseAlarms} false alarm{ch.falseAlarms === 1 ? "" : "s"}
              {ch.threshold == null && " · no alert threshold (errors never stood out)"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!playing && !Number.isFinite(cursor)) setCursor(0);
                setPlaying((p) => !p);
              }}
              className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-300/15"
            >
              {playing ? "❚❚ Pause" : Number.isFinite(cursor) ? "▶ Resume" : "▶ Replay"}
            </button>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`rounded-md border px-2 py-1 text-[11px] ${speed === s ? "border-cyan-300/50 text-cyan-100" : "border-white/10 text-slate-400 hover:border-white/30"}`}
              >
                {s}×
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setPlaying(false); setCursor(Infinity); }}
              className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:border-white/30"
            >
              Show all
            </button>
          </div>
        </div>

        <Legend showLimits={showLimits} setShowLimits={setShowLimits} />
        <div className="h-5 text-[11px] tabular-nums text-slate-300">
          {readout ? (
            <>
              Step {hover!.toLocaleString()} · <span style={{ color: MEASURED }}>■</span> measured {fmt(readout.measured)} ·{" "}
              <span style={{ color: PREDICTED }}>■</span> predicted {fmt(readout.predicted)} · error {fmt(readout.error)}
              {ch.threshold != null && ` (threshold ${ch.threshold.toFixed(3)})`}
            </>
          ) : Number.isFinite(cursor) ? (
            `Replaying… step ${Math.round(at).toLocaleString()} of ${length.toLocaleString()}`
          ) : (
            <span className="text-slate-500">Hover the charts to read values. Replay plays the telemetry back as if it were live.</span>
          )}
        </div>

        <TelemetryChart
          title="Telemetry value (normalised)"
          length={length}
          lines={valueLines}
          bands={bands}
          cursor={at}
          hover={hover}
          onHover={setHover}
          height={220}
        />
        <TelemetryChart
          title="Model prediction error (smoothed)"
          length={length}
          lines={errorLines}
          bands={bands}
          threshold={ch.threshold == null ? null : { value: ch.threshold, label: `alert threshold ${ch.threshold.toFixed(3)}` }}
          cursor={at}
          hover={hover}
          onHover={setHover}
          height={170}
        />
        <p className="text-[10px] text-slate-500">X axis: time step (NASA anonymised timestamps). Alerts are raised when the
          smoothed error crosses the threshold; the threshold is chosen without using the labels.</p>
      </section>
      <AlertFeed ch={ch} cursor={at} />
    </div>
  );
}

function Legend({ showLimits, setShowLimits }: { showLimits: boolean; setShowLimits: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-300">
      <span className="flex items-center gap-1.5"><Swatch color={MEASURED} /> Measured</span>
      <span className="flex items-center gap-1.5"><Swatch color={PREDICTED} /> Model prediction</span>
      <span className="flex items-center gap-1.5"><Swatch color={BAND_STYLE.labelled.strip} band /> NASA-labelled anomaly</span>
      <span className="flex items-center gap-1.5"><Swatch color={BAND_STYLE.alert.strip} band /> ⚠ Model alert</span>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" className="accent-amber-300" checked={showLimits} onChange={(e) => setShowLimits(e.target.checked)} />
        <Swatch color={BAND_STYLE.limit.strip} band /> Out-of-limits alerts (baseline)
      </label>
    </div>
  );
}

function Swatch({ color, band = false }: { color: string; band?: boolean }) {
  return <span className={`inline-block ${band ? "h-2 w-3" : "h-0.5 w-3"} rounded-sm`} style={{ background: color }} />;
}

type FeedEvent = { step: number; kind: "alert" | "start" | "end"; text: string; verdict?: "good" | "bad" | "neutral" };

function AlertFeed({ ch, cursor }: { ch: TelemetryChannel; cursor: number }) {
  const events = useMemo(() => {
    const ev: FeedEvent[] = [];
    for (const a of ch.alerts) {
      const real = ch.labelled.some((l) => overlaps(a, l));
      ev.push({
        step: a.start,
        kind: "alert",
        text: `⚠ Alert raised (peak error ${a.peak_error.toFixed(3)})`,
        verdict: real ? "good" : "bad",
      });
    }
    for (const l of ch.labelled) {
      const caught = ch.alerts.some((a) => overlaps(a, l));
      ev.push({ step: l.start, kind: "start", text: `NASA-labelled ${l.class} anomaly begins`, verdict: "neutral" });
      ev.push({ step: l.end, kind: "end", text: caught ? "✓ Labelled anomaly ends — caught" : "✕ Labelled anomaly ends — missed", verdict: caught ? "good" : "bad" });
    }
    return ev.sort((a, b) => a.step - b.step);
  }, [ch]);

  const visible = events.filter((e) => e.step <= cursor).reverse();
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border border-white/5 bg-white/[0.02] max-xl:max-h-64">
      <h3 className="border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">Event log</h3>
      <ul className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {visible.length === 0 && <li className="px-1 text-xs text-slate-500">No events yet.</li>}
        {visible.map((e, i) => (
          <li key={i} className="rounded-md border border-white/5 px-2 py-1.5 text-[11px]">
            <div className="tabular-nums text-slate-500">Step {e.step.toLocaleString()}</div>
            <div className="text-slate-200">{e.text}</div>
            {e.kind === "alert" && (
              <div className={e.verdict === "good" ? "text-emerald-300" : "text-amber-300"}>
                {e.verdict === "good" ? "✓ matches a labelled anomaly" : "✕ false alarm (no labelled anomaly here)"}
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

const pct = (x: number) => `${Number((x * 100).toFixed(1))}%`;
const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(3));
