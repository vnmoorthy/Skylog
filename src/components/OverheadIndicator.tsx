/**
 * SKYLOG — bottom-left "what's closest to home" indicator.
 *
 * Always visible when home is set. Answers the question most people
 * open a flight tracker to answer: "that plane I hear overhead —
 * which one is it?". Updates live as aircraft positions change.
 *
 * Shown even when the home radius ring is off-screen.
 */

import type { StateVector } from "../lib/opensky";
import { haversineMeters } from "../lib/geo";
import { parseCallsign, prettyFlightName } from "../lib/callsign";
import { formatAltitude, formatDistance, type UnitSystem } from "../lib/units";
import { useSky } from "../state/store";

interface OverheadIndicatorProps {
  aircraft: readonly StateVector[];
  onSelect: (s: StateVector) => void;
}

export function OverheadIndicator({
  aircraft,
  onSelect,
}: OverheadIndicatorProps): JSX.Element | null {
  const home = useSky((s) => s.home);
  const units = useSky((s) => s.units) as UnitSystem;
  const radiusM = useSky((s) => s.radiusMeters);

  if (!home) return null;

  // Sort by distance from home; pick the three nearest (within 3× radius).
  const scored = aircraft
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => {
      const d = haversineMeters(home, {
        lat: s.latitude as number,
        lon: s.longitude as number,
      });
      return { state: s, d };
    })
    .filter((x) => x.d <= radiusM * 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-4 z-20 rounded-md border border-ink-800 bg-ink-900/85 p-3 backdrop-blur"
      aria-live="polite"
    >
      <p className="font-mono text-[9px] uppercase tracking-widest text-ink-500">
        nearest to home
      </p>
      {scored.length === 0 ? (
        <p className="mt-2 max-w-[22rem] text-xs text-ink-400">
          Nothing within {formatDistance(radiusM * 3, units)}. When a plane
          passes, it'll pop up here first.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {scored.map(({ state, d }) => {
            const parsed = parseCallsign(state.callsign);
            const title = prettyFlightName(parsed);
            const inside = d <= radiusM;
            return (
              <li key={state.icao24}>
                <button
                  onClick={() => onSelect(state)}
                  className="group flex w-full items-baseline justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-ink-800/60"
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        inside ? "bg-accent" : "bg-ink-500"
                      }`}
                    />
                    <span className="font-mono tabular-nums text-sm text-ink-100 group-hover:text-accent">
                      {title}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-[10px] text-ink-400">
                    {formatDistance(d, units)} ·{" "}
                    {formatAltitude(
                      state.baroAltitudeM ?? state.geoAltitudeM ?? null,
                      units
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
