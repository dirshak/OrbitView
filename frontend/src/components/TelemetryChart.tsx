import { useEffect, useMemo, useRef, useState } from "react";

export interface ChartLine {
  name: string;
  x: number[];
  y: (number | null)[];
  color: string;
  width: number;
  opacity?: number;
}

export interface ChartBand {
  start: number;
  end: number;
  kind: "labelled" | "alert" | "limit";
}

interface Props {
  title: string;
  length: number;
  lines: ChartLine[];
  bands: ChartBand[];
  threshold?: { value: number; label: string } | null;
  cursor: number; // data after this step is not drawn yet (replay)
  hover: number | null;
  onHover: (step: number | null) => void;
  height: number;
}

const M = { left: 44, right: 12, top: 18, bottom: 22 };
const INK_MUTED = "#898781";
const GRID = "#2c2c2a";
const AXIS = "#383835";
export const BAND_STYLE = {
  labelled: { fill: "rgba(240,239,236,0.09)", strip: "rgba(240,239,236,0.45)" },
  alert: { fill: "rgba(208,59,59,0.22)", strip: "#d03b3b" },
  limit: { fill: "rgba(250,178,25,0.10)", strip: "#fab219" },
} as const;

/** Single-axis time-series chart for one telemetry channel. */
export function TelemetryChart({ title, length, lines, bands, threshold, cursor, hover, onHover, height }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Y domain from the whole series (not just the revealed part) so replay doesn't rescale.
  const [y0, y1] = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of lines) for (const v of l.y) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (threshold) { lo = Math.min(lo, threshold.value); hi = Math.max(hi, threshold.value); }
    if (!Number.isFinite(lo)) return [0, 1];
    const pad = (hi - lo || 1) * 0.08;
    return [lo - pad, hi + pad];
  }, [lines, threshold]);

  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const sx = (step: number) => M.left + (step / Math.max(1, length)) * innerW;
  const sy = (v: number) => M.top + (1 - (v - y0) / (y1 - y0)) * innerH;

  const paths = useMemo(
    () =>
      lines.map((l) => {
        let d = "";
        let pen = false;
        for (let i = 0; i < l.x.length; i += 1) {
          const v = l.y[i];
          if (l.x[i] > cursor) break;
          if (v == null) { pen = false; continue; }
          d += `${pen ? "L" : "M"}${sx(l.x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
          pen = true;
        }
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, cursor, width, height, y0, y1, length]
  );

  const yTicks = niceTicks(y0, y1, 4);
  // One decimal count per axis, from the tick spacing, so labels line up (e.g. -1.0, 0.0, 1.0).
  const yDecimals = yTicks.length > 1 ? decimalsFor(yTicks[1] - yTicks[0]) : 2;
  const xTicks = niceTicks(0, length, 6).filter((t) => t >= 0 && t <= length);
  const visibleBands = bands
    .filter((b) => b.start <= cursor)
    .map((b) => ({ ...b, end: Math.min(b.end, cursor) }));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const step = Math.round(((e.clientX - rect.left - M.left) / innerW) * length);
    onHover(step < 0 || step > Math.min(cursor, length) ? null : step);
  };

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={title}
        onMouseMove={onMove}
        onMouseLeave={() => onHover(null)}
        className="block"
      >
        <text x={M.left} y={11} fill="#c3c2b7" fontSize={11}>{title}</text>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={M.left + innerW} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
            <text x={M.left - 6} y={sy(t) + 3} textAnchor="end" fill={INK_MUTED} fontSize={10} className="tabular-nums">
              {t.toFixed(Math.min(yDecimals, 3))}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={height - 6} textAnchor="middle" fill={INK_MUTED} fontSize={10} className="tabular-nums">
            {t.toLocaleString()}
          </text>
        ))}
        <line x1={M.left} x2={M.left + innerW} y1={M.top + innerH} y2={M.top + innerH} stroke={AXIS} />

        {visibleBands.map((b, i) => {
          const s = BAND_STYLE[b.kind];
          const x = sx(b.start);
          const w = Math.max(2, sx(b.end) - x);
          // Strips: labelled on top, model alerts just below, out-of-limits at the bottom.
          const stripY = b.kind === "labelled" ? M.top : b.kind === "alert" ? M.top + 4 : M.top + innerH - 3;
          return (
            <g key={`b${i}`}>
              {b.kind !== "limit" && <rect x={x} y={M.top} width={w} height={innerH} fill={s.fill} />}
              <rect x={x} y={stripY} width={w} height={3} fill={s.strip} />
            </g>
          );
        })}

        {threshold && (
          <g>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={sy(threshold.value)}
              y2={sy(threshold.value)}
              stroke="#c3c2b7"
              strokeDasharray="5 4"
              strokeWidth={1}
            />
            <text x={M.left + innerW - 4} y={sy(threshold.value) - 4} textAnchor="end" fill="#c3c2b7" fontSize={10}>
              {threshold.label}
            </text>
          </g>
        )}

        {lines.map((l, i) => (
          <path
            key={l.name}
            d={paths[i]}
            fill="none"
            stroke={l.color}
            strokeWidth={l.width}
            strokeOpacity={l.opacity ?? 1}
            strokeLinejoin="round"
          />
        ))}

        {cursor < length && (
          <line x1={sx(cursor)} x2={sx(cursor)} y1={M.top} y2={M.top + innerH} stroke="#5ce1ff" strokeWidth={1.5} />
        )}
        {hover != null && (
          <line x1={sx(hover)} x2={sx(hover)} y1={M.top} y2={M.top + innerH} stroke="#f0efec" strokeOpacity={0.5} />
        )}
        {hover != null &&
          lines.map((l) => {
            const v = valueAt(l, hover);
            return v == null ? null : (
              <circle key={`h${l.name}`} cx={sx(hover)} cy={sy(v)} r={4} fill={l.color} stroke="#1a1a19" strokeWidth={2} />
            );
          })}
      </svg>
    </div>
  );
}

/** Nearest sampled value at or before `step` (binary search on sorted x). */
export function valueAt(line: { x: number[]; y: (number | null)[] }, step: number): number | null {
  let lo = 0;
  let hi = line.x.length - 1;
  if (hi < 0 || step < line.x[0]) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.x[mid] <= step) lo = mid;
    else hi = mid - 1;
  }
  return line.y[lo];
}

/** Fewest decimals that show a tick step exactly (0.25 -> 2, 0.5 -> 1, 20 -> 0). */
function decimalsFor(step: number): number {
  for (let d = 0; d < 4; d += 1) if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6) return d;
  return 3;
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}
