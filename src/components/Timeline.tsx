/**
 * SKYLOG — the Timeline.
 *
 * A horizontal strip of the last 24 hours. Each aircraft pass is a small
 * horizontal bar positioned at its time of closest approach. Color ramps
 * with estimated ground-level dB; bar height inversely scales with
 * altitude (low planes are taller bars than high ones). A faint vertical
 * line marks "now"; faint tick marks mark each hour.
 *
 * The hero interaction: hover shows a one-line tooltip; click selects.
 * Keyboard: left/right arrows scrub between passes; Enter opens the
 * detail panel; Escape clears selection.
 *
 * Rendering strategy: we use D3 for scales but plain SVG for drawing.
 * Pulling all of D3 would add ~90 KB for layout we don't need.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  scaleLinear,
  scaleTime,
  type ScaleTime,
  type ScaleLinear,
} from "d3-scale";
import { useSky, selectPassesInWindow } from "../state/store";
import type { AircraftPass } from "../lib/db";
import {
  loudnessIntensity,
  dbDescriptor,
} from "../lib/acoustics";
import { formatAltitude, formatClock, formatDb } from "../lib/units";
import { parseCallsign, prettyFlightName } from "../lib/callsign";

const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Color ramp for loudness: cool gray at 0 -> warm orange at ~0.7 ->
 * deep red-orange at 1. Avoid blue. Avoid green.
 *
 * Anchors chosen to keep each stop visually distinguishable on a black
 * background without relying on luminance alone.
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [0x50, 0x50, 0x58]],
  [0.25, [0x8a, 0x7a, 0x5a]],
  [0.5, [0xd4, 0xa5, 0x4c]],
  [0.75, [0xff, 0x8a, 0x4c]],
  [1.0, [0xff, 0x4c, 0x24]],
];

function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [ta, ca] = STOPS[i - 1]!;
    const [tb, cb] = STOPS[i]!;
    if (x <= tb) {
      const k = (x - ta) / (tb - ta || 1);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
      const b = Math.round(ca[2] + (cb[2] - ca[2]) * k);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(255,76,36)";
}

export function Timeline(): JSX.Element {
  const passes = useSky((s) =>
    selectPassesInWindow(s, Date.now() - WINDOW_MS, Date.now())
  );
  const selectedId = useSky((s) => s.selectedPassId);
  const selectPass = useSky((s) => s.selectPass);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const HEIGHT = 200;
  const MARGIN = { top: 10, right: 24, bottom: 30, left: 24 } as const;

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Tick the timeline forward every 10 s so the "now" line crawls right.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const xScale = useMemo<ScaleTime<number, number>>(
    () =>
      scaleTime<number, number>()
        .domain([nowMs - WINDOW_MS, nowMs])
        .range([MARGIN.left, width - MARGIN.right]),
    [nowMs, width]
  );

  // Bar height from altitude: ~10 m = 90 px, ~12,000 m = 14 px.
  const heightScale = useMemo<ScaleLinear<number, number>>(
    () => scaleLinear<number, number>().domain([0, 12_000]).range([90, 14]).clamp(true),
    []
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (passes.length === 0) return;
      const idx = selectedId
        ? passes.findIndex((p) => p.passId === selectedId)
        : -1;
      if (e.key === "ArrowRight") {
        const next = Math.min(passes.length - 1, idx + 1);
        selectPass(passes[next]!.passId);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        const prev = Math.max(0, idx === -1 ? 0 : idx - 1);
        selectPass(passes[prev]!.passId);
        e.preventDefault();
      } else if (e.key === "Escape") {
        selectPass(null);
        e.preventDefault();
      }
    },
    [passes, selectedId, selectPass]
  );

  return (
    <div
      ref={wrapperRef}
      className="relative w-full outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Timeline of aircraft passes in the last 24 hours"
      role="region"
    >
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
        height={HEIGHT}
        className="block"
      >
        <HourTicks
          xScale={xScale}
          width={width}
          height={HEIGHT}
          margin={MARGIN}
        />
        <NowLine x={xScale(nowMs)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
        <Bars
          passes={passes}
          xScale={xScale}
          heightScale={heightScale}
          baseY={HEIGHT - MARGIN.bottom - 2}
          selectedId={selectedId}
          onSelect={selectPass}
        />
      </svg>
      <Axis xScale={xScale} width={width} margin={MARGIN} y={HEIGHT - MARGIN.bottom + 4} />
    </div>
  );
}

/* ---- hour ticks ---- */

interface HourTicksProps {
  xScale: ScaleTime<number, number>;
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

function HourTicks({ xScale, height, margin }: HourTicksProps): JSX.Element {
  // A tick at the start of every hour in the visible range.
  const domain = xScale.domain();
  const t0 = domain[0] as Date;
  const t1 = domain[1] as Date;
  const start = new Date(t0);
  start.setMinutes(0, 0, 0);
  const ticks: number[] = [];
  let t = start.getTime();
  while (t <= t1.getTime()) {
    ticks.push(t);
    t += 60 * 60 * 1000;
  }

  return (
    <g>
      {ticks.map((tick) => {
        const x = xScale(tick);
        const d = new Date(tick);
        const major = d.getHours() % 6 === 0;
        return (
          <g key={tick}>
            <line
              x1={x}
              x2={x}
              y1={margin.top}
              y2={height - margin.bottom}
              stroke={major ? "#27272f" : "#1b1b22"}
              strokeWidth={1}
            />
          </g>
        );
      })}
    </g>
  );
}

/* ---- now line ---- */

interface NowLineProps {
  x: number;
  y1: number;
  y2: number;
}
function NowLine({ x, y1, y2 }: NowLineProps): JSX.Element {
  return (
    <g>
      <line x1={x} x2={x} y1={y1} y2={y2} stroke="#ff8a4c" strokeWidth={1} strokeDasharray="2 3" />
      <text x={x + 4} y={y1 + 10} fontSize={9} fontFamily="JetBrains Mono" fill="#ff8a4c">
        NOW
      </text>
    </g>
  );
}

/* ---- bars ---- */

interface BarsProps {
  passes: AircraftPass[];
  xScale: ScaleTime<number, number>;
  heightScale: ScaleLinear<number, number>;
  baseY: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function Bars({
  passes,
  xScale,
  heightScale,
  baseY,
  selectedId,
  onSelect,
}: BarsProps): JSX.Element {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hover = hoverId ? passes.find((p) => p.passId === hoverId) : null;

  return (
    <g>
      {passes.map((p) => {
        const x = xScale(p.closestApproachAt);
        const h = heightScale(p.closestAltM ?? 6000);
        const t = loudnessIntensity(p.peakDb);
        const color = rampColor(t);
        const selected = p.passId === selectedId;
        const hovering = p.passId === hoverId;
        return (
          <g key={p.passId}>
            <rect
              x={x - 2}
              y={baseY - h}
              width={4}
              height={h}
              fill={color}
              stroke={selected ? "#ff8a4c" : "transparent"}
              strokeWidth={selected ? 1 : 0}
              opacity={selected || hovering ? 1 : 0.9}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoverId(p.passId)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelect(p.passId)}
              aria-label={`Pass ${p.callsign ?? p.icao24} at ${formatClock(p.closestApproachAt)}`}
              role="button"
              tabIndex={-1}
            />
          </g>
        );
      })}
      {hover && <Tooltip p={hover} xScale={xScale} baseY={baseY} />}
    </g>
  );
}

interface TooltipProps {
  p: AircraftPass;
  xScale: ScaleTime<number, number>;
  baseY: number;
}

function Tooltip({ p, xScale, baseY }: TooltipProps): JSX.Element {
  const units = useSky((s) => s.units);
  const parsed = parseCallsign(p.callsign);
  const label = prettyFlightName(parsed);
  const text = `${label} · ${formatAltitude(p.closestAltM, units)} · ${formatDb(p.peakDb)} · ${formatClock(p.closestApproachAt)}`;
  const x = xScale(p.closestApproachAt);
  const w = Math.max(160, text.length * 5.8);
  // Shift tooltip left/right so it doesn't clip off the edges.
  const domain = xScale.range();
  const left = Math.min(domain[1]! - w - 4, Math.max(domain[0]! + 4, x - w / 2));
  return (
    <g pointerEvents="none">
      <rect
        x={left}
        y={baseY - 110}
        width={w}
        height={22}
        fill="#111114"
        stroke="#27272f"
        rx={3}
      />
      <text
        x={left + 8}
        y={baseY - 94}
        fontFamily="JetBrains Mono"
        fontSize={11}
        fill="#ececef"
      >
        {text}
      </text>
    </g>
  );
}

/* ---- axis labels ---- */

interface AxisProps {
  xScale: ScaleTime<number, number>;
  width: number;
  margin: { top: number; right: number; bottom: number; left: number };
  y: number;
}
function Axis({ xScale, width, margin, y }: AxisProps): JSX.Element {
  // Label every 3 hours.
  const domain = xScale.domain();
  const t0 = domain[0] as Date;
  const t1 = domain[1] as Date;
  const start = new Date(t0);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + ((3 - (start.getHours() % 3)) % 3));
  const ticks: number[] = [];
  let t = start.getTime();
  while (t <= t1.getTime()) {
    ticks.push(t);
    t += 3 * 60 * 60 * 1000;
  }

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 font-mono text-[10px] text-ink-400"
      style={{ top: y, height: margin.bottom, width }}
    >
      {ticks.map((tick) => {
        const x = xScale(tick);
        const d = new Date(tick);
        const label = `${d.getHours().toString().padStart(2, "0")}:00`;
        return (
          <div
            key={tick}
            className="absolute"
            style={{ left: x, transform: "translateX(-50%)" }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

/* ---- color-swatch legend used elsewhere ---- */

export function LoudnessLegend(): JSX.Element {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] text-ink-400">
      <span className="uppercase tracking-wider">quiet</span>
      <div className="flex h-2 w-32 overflow-hidden rounded-sm">
        {stops.map((s) => (
          <div key={s} className="flex-1" style={{ background: rampColor(s) }} />
        ))}
      </div>
      <span className="uppercase tracking-wider">loud</span>
      <span className="ml-3 text-ink-500">
        {dbDescriptor(50)} → {dbDescriptor(95)}
      </span>
    </div>
  );
}

export { rampColor };
