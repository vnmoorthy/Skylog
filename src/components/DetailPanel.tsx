/**
 * SKYLOG — right-side slide-in detail panel.
 *
 * Shown when the user selects a pass. Key facts up top (flight label,
 * operator, aircraft type), a small SVG chart of altitude vs time and
 * ground-distance vs time during the pass, and a small directional
 * flight-path SVG relative to home.
 */

import { useEffect, useState } from "react";
import { useSky } from "../state/store";
import { parseCallsign, prettyFlightName } from "../lib/callsign";
import {
  formatAltitude,
  formatClock,
  formatDistance,
  formatDb,
  formatSpeed,
  type UnitSystem,
} from "../lib/units";
import {
  lookupAircraft,
  type AircraftInfo,
} from "../lib/aircraftDb";
import { dbDescriptor } from "../lib/acoustics";
import type { AircraftPass, PassSample } from "../lib/db";
import { bearingDegrees } from "../lib/geo";

export function DetailPanel(): JSX.Element | null {
  const pass = useSky((s) =>
    s.selectedPassId ? s.passes[s.selectedPassId] ?? null : null
  );
  const units = useSky((s) => s.units);
  const home = useSky((s) => s.home);
  const clear = useSky((s) => s.selectPass);
  const [ac, setAc] = useState<AircraftInfo | null>(null);

  useEffect(() => {
    let abandoned = false;
    if (!pass) {
      setAc(null);
      return;
    }
    lookupAircraft(pass.icao24)
      .then((info) => {
        if (!abandoned) setAc(info);
      })
      .catch(() => {
        if (!abandoned) setAc(null);
      });
    return () => {
      abandoned = true;
    };
  }, [pass?.icao24]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") clear(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  if (!pass) return null;

  const parsed = parseCallsign(pass.callsign);
  const title = prettyFlightName(parsed);

  return (
    <aside
      className="fixed right-0 top-0 z-40 h-full w-full max-w-[420px] overflow-y-auto border-l border-ink-700 bg-ink-900/95 p-6 backdrop-blur"
      role="dialog"
      aria-label="Aircraft pass details"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {parsed.airlineIcao ?? "Callsign"} ·{" "}
            {pass.icao24.toUpperCase()}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-ink-100">{title}</h3>
          {ac && (
            <p className="mt-1 text-sm text-ink-300">
              {ac.manufacturer ? `${ac.manufacturer} ` : ""}
              {ac.model ?? ac.typecode ?? "Unknown type"}
              {ac.registration ? ` · ${ac.registration}` : ""}
            </p>
          )}
          {ac?.operator && (
            <p className="text-sm text-ink-400">{ac.operator}</p>
          )}
          {pass.originCountry && !ac && (
            <p className="text-sm text-ink-400">
              Registered in {pass.originCountry}
            </p>
          )}
        </div>
        <button
          onClick={() => clear(null)}
          className="font-mono text-xs text-ink-400 hover:text-accent"
          aria-label="Close"
        >
          ESC ×
        </button>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4">
        <Stat label="Closest approach">
          {formatClock(pass.closestApproachAt)}
        </Stat>
        <Stat label="Duration in radius">
          {Math.max(1, Math.round((pass.lastSeen - pass.firstSeen) / 1000))}s
        </Stat>
        <Stat label="Altitude at closest">
          {formatAltitude(pass.closestAltM, units)}
        </Stat>
        <Stat label="Ground distance">
          {formatDistance(pass.closestGroundM, units)}
        </Stat>
        <Stat label="Peak loudness">
          <span>
            {formatDb(pass.peakDb)}{" "}
            <span className="text-ink-500">· {dbDescriptor(pass.peakDb)}</span>
          </span>
        </Stat>
        <Stat label="Speed at closest">
          {formatSpeed(
            pass.samples.find((s) => s.t === pass.closestApproachAt)?.speedMps ??
              null,
            units
          )}
        </Stat>
      </section>

      <section className="mt-8">
        <h4 className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
          Altitude & ground distance
        </h4>
        <PassPlot pass={pass} units={units} />
      </section>

      {home && (
        <section className="mt-8">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
            Ground track through radius
          </h4>
          <GroundTrack pass={pass} home={home} />
        </section>
      )}

      <section className="mt-8 border-t border-ink-800 pt-4 font-mono text-[10px] uppercase tracking-wider text-ink-500">
        {pass.samples.length} samples · {pass.category != null ? `category ${pass.category}` : "no category"}
      </section>
    </aside>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className="mt-1 font-mono tabular-nums text-sm text-ink-100">
        {children}
      </p>
    </div>
  );
}

/* ---- altitude + ground distance chart ---- */

function PassPlot({
  pass,
  units,
}: {
  pass: AircraftPass;
  units: UnitSystem;
}): JSX.Element {
  const samples = pass.samples;
  if (samples.length < 2) {
    return (
      <p className="mt-2 font-mono text-xs text-ink-500">
        Not enough samples to plot.
      </p>
    );
  }

  const W = 360;
  const H = 140;
  const pad = { l: 34, r: 8, t: 8, b: 22 };

  const tMin = samples[0]!.t;
  const tMax = samples[samples.length - 1]!.t;
  const altMax = Math.max(...samples.map((s) => s.altM ?? 0), 100);
  const gMax = Math.max(...samples.map((s) => s.slantM), 100);

  const x = (t: number): number =>
    pad.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - pad.l - pad.r);
  const yAlt = (v: number): number =>
    H - pad.b - (v / altMax) * (H - pad.t - pad.b);
  const yDist = (v: number): number =>
    H - pad.b - (v / gMax) * (H - pad.t - pad.b);

  const altPath = pathFromSamples(samples, (s) => yAlt(s.altM ?? 0), x);
  const distPath = pathFromSamples(samples, (s) => yDist(s.slantM), x);

  return (
    <figure className="mt-2">
      <svg width={W} height={H} className="block">
        {/* grid */}
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={H - pad.b}
          y2={H - pad.b}
          stroke="#27272f"
        />
        <path d={altPath} fill="none" stroke="#ff8a4c" strokeWidth={1.5} />
        <path
          d={distPath}
          fill="none"
          stroke="#8a8a96"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {/* closest-approach marker */}
        <line
          x1={x(pass.closestApproachAt)}
          x2={x(pass.closestApproachAt)}
          y1={pad.t}
          y2={H - pad.b}
          stroke="#ff8a4c"
          strokeDasharray="1 2"
        />
        <text
          x={pad.l}
          y={H - 4}
          fontFamily="JetBrains Mono"
          fontSize={9}
          fill="#8a8a96"
        >
          {formatClock(tMin)}
        </text>
        <text
          x={W - pad.r}
          y={H - 4}
          fontFamily="JetBrains Mono"
          fontSize={9}
          fill="#8a8a96"
          textAnchor="end"
        >
          {formatClock(tMax)}
        </text>
      </svg>
      <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ink-500">
        <span className="mr-3">
          <span className="mr-1 inline-block h-1 w-3 align-middle bg-accent" />
          altitude ({formatAltitude(altMax, units)} max)
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-3 align-middle border-t border-dashed border-ink-400" />
          slant distance ({formatDistance(gMax, units)} max)
        </span>
      </figcaption>
    </figure>
  );
}

function pathFromSamples(
  samples: readonly PassSample[],
  y: (s: PassSample) => number,
  x: (t: number) => number
): string {
  return samples
    .map((s, i) => `${i === 0 ? "M" : "L"} ${x(s.t).toFixed(1)} ${y(s).toFixed(1)}`)
    .join(" ");
}

/* ---- ground track ---- */

interface TrackProps {
  pass: AircraftPass;
  home: { lat: number; lon: number };
}

function GroundTrack({ pass, home }: TrackProps): JSX.Element {
  const W = 240;
  const H = 160;
  const cx = W / 2;
  const cy = H / 2;

  // Project samples onto a local ENU frame centered on home.
  const pts = pass.samples.map((s) => {
    const dx = (s.lon - home.lon) * 111_320 * Math.cos((home.lat * Math.PI) / 180);
    const dy = -(s.lat - home.lat) * 111_320;
    return { x: dx, y: dy, t: s.t };
  });
  const maxR = Math.max(
    ...pts.map((p) => Math.hypot(p.x, p.y)),
    500
  );
  const scale = (Math.min(W, H) / 2 - 18) / maxR;

  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(cx + p.x * scale).toFixed(1)} ${(cy + p.y * scale).toFixed(1)}`)
    .join(" ");

  const start = pts[0];
  const end = pts[pts.length - 1];
  const bearing = start && end
    ? bearingDegrees(
        { lat: home.lat + start.y / -111_320, lon: home.lon + start.x / (111_320 * Math.cos((home.lat * Math.PI) / 180)) },
        { lat: home.lat + end.y / -111_320, lon: home.lon + end.x / (111_320 * Math.cos((home.lat * Math.PI) / 180)) }
      )
    : null;

  return (
    <figure className="mt-2 flex items-start gap-6">
      <svg width={W} height={H} className="block">
        {/* concentric radius rings */}
        {[0.33, 0.66, 1].map((k) => (
          <circle
            key={k}
            cx={cx}
            cy={cy}
            r={(Math.min(W, H) / 2 - 18) * k}
            fill="none"
            stroke="#1b1b22"
            strokeWidth={1}
          />
        ))}
        {/* track */}
        <path d={path} fill="none" stroke="#ff8a4c" strokeWidth={1.25} />
        {/* start dot */}
        {start && (
          <circle
            cx={cx + start.x * scale}
            cy={cy + start.y * scale}
            r={2.5}
            fill="#ffb07d"
          />
        )}
        {/* end arrow-ish */}
        {end && (
          <circle
            cx={cx + end.x * scale}
            cy={cy + end.y * scale}
            r={3.5}
            fill="#ff4c24"
          />
        )}
        {/* home marker */}
        <circle cx={cx} cy={cy} r={2.5} fill="#ececef" />
      </svg>
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
        <div>
          <span className="inline-block h-2 w-2 rounded-full bg-ink-100 align-middle" />{" "}
          home
        </div>
        <div className="mt-1">
          <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#ffb07d" }} />{" "}
          start of pass
        </div>
        <div className="mt-1">
          <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: "#ff4c24" }} />{" "}
          end of pass
        </div>
        {bearing != null && (
          <div className="mt-3 text-ink-300">
            Heading {Math.round(bearing)}°
          </div>
        )}
      </div>
    </figure>
  );
}
