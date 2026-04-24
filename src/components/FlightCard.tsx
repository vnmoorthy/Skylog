/**
 * SKYLOG — compact overlay card shown when a user clicks a live plane
 * on the map.
 *
 * This is separate from the historical pass DetailPanel (which shows a
 * pass with altitude curves and closest-approach stats) because live
 * aircraft don't have an end-of-pass yet. The card shows the snapshot
 * we know right now and resolves the aircraft registration/type/airline
 * asynchronously against the bundled DB.
 */

import { useEffect, useState } from "react";
import type { StateVector } from "../lib/opensky";
import { parseCallsign, prettyFlightName } from "../lib/callsign";
import {
  formatAltitude,
  formatClock,
  formatSpeed,
} from "../lib/units";
import { lookupAircraft, type AircraftInfo } from "../lib/aircraftDb";
import { useSky } from "../state/store";

interface FlightCardProps {
  state: StateVector;
  onClose: () => void;
}

export function FlightCard({ state, onClose }: FlightCardProps): JSX.Element {
  const units = useSky((s) => s.units);
  const [ac, setAc] = useState<AircraftInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAc(null);
    lookupAircraft(state.icao24)
      .then((info) => {
        if (!cancelled) setAc(info);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [state.icao24]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = parseCallsign(state.callsign);
  const title = prettyFlightName(parsed);

  return (
    <aside
      className="fixed right-4 top-4 z-30 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-ink-800 bg-ink-900/95 shadow-2xl backdrop-blur"
      role="dialog"
      aria-label="Live flight"
    >
      <header className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {parsed.airlineIcao ?? state.icao24.toUpperCase()}
            {state.callsign && state.callsign.trim() !== parsed.airlineIcao
              ? ` · ${state.callsign.trim()}`
              : ""}
          </p>
          <h3 className="mt-0.5 text-lg font-semibold text-ink-100">{title}</h3>
          {state._aircraftDesc || ac ? (
            <p className="mt-1 text-xs text-ink-300">
              {state._aircraftDesc ?? `${ac?.manufacturer ? ac.manufacturer + " " : ""}${ac?.model ?? ac?.typecode ?? "Unknown type"}`}
              {state._registration
                ? ` · ${state._registration}`
                : ac?.registration
                ? ` · ${ac.registration}`
                : ""}
            </p>
          ) : state.originCountry ? (
            <p className="mt-1 text-xs text-ink-400">Registered {state.originCountry}</p>
          ) : null}
          {state._operator ? (
            <p className="text-xs text-ink-400">{state._operator}</p>
          ) : ac?.operator ? (
            <p className="text-xs text-ink-400">{ac.operator}</p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[11px] text-ink-400 hover:text-accent"
          aria-label="Close"
        >
          ESC ×
        </button>
      </header>
      <section className="grid grid-cols-2 gap-3 px-4 py-3">
        <Stat label="Altitude">
          {formatAltitude(state.baroAltitudeM ?? state.geoAltitudeM ?? null, units)}
        </Stat>
        <Stat label="Ground speed">{formatSpeed(state.velocityMps, units)}</Stat>
        <Stat label="Heading">
          {state.trackDeg != null ? `${Math.round(state.trackDeg)}°` : "—"}
        </Stat>
        <Stat label="Vertical rate">
          {state.verticalRateMps != null
            ? `${state.verticalRateMps >= 0 ? "↑" : "↓"} ${Math.abs(
                Math.round(state.verticalRateMps * 196.85) // m/s → ft/min
              )} ft/min`
            : "level"}
        </Stat>
        <Stat label="Last contact">
          {state.lastContact ? formatClock(state.lastContact * 1000) : "—"}
        </Stat>
        <Stat label="Squawk">{state.squawk ?? "—"}</Stat>
      </section>
      <footer className="border-t border-ink-800 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-500">
        icao24 {state.icao24} · on-ground {state.onGround ? "yes" : "no"}
      </footer>
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
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className="mt-0.5 font-mono tabular-nums text-sm text-ink-100">{children}</p>
    </div>
  );
}
