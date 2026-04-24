/**
 * SKYLOG — click-a-plane live flight card.
 *
 * Shown in the top-right when a user clicks an aircraft glyph. Presents
 * everything we can know from a single OpenSky state vector and the
 * bundled aircraft metadata DB.
 *
 * Separate from DetailPanel (which is for completed historical passes)
 * because live flights haven't ended yet — no closest-approach point,
 * no pass duration.
 */

import { useEffect, useState } from "react";
import type { StateVector } from "../lib/opensky";
import { parseCallsign, prettyFlightName } from "../lib/callsign";
import {
  formatAltitude,
  formatClock,
  formatSpeed,
  type UnitSystem,
} from "../lib/units";
import { lookupAircraft, type AircraftInfo } from "../lib/aircraftDb";
import { getSighting } from "../lib/sightings";
import type { AircraftSighting } from "../lib/db";
import { haversineMeters } from "../lib/geo";
import { useSky } from "../state/store";

interface FlightCardProps {
  state: StateVector;
  onClose: () => void;
}

export function FlightCard({ state, onClose }: FlightCardProps): JSX.Element {
  const units = useSky((s) => s.units) as UnitSystem;
  const home = useSky((s) => s.home);
  // Prefer enrichment fields carried on the state vector (airplanes.live
  // includes them); fall back to async aircraft-DB lookup for OpenSky-style
  // payloads that lack them.
  const [ac, setAc] = useState<AircraftInfo | null>(null);
  const [sighting, setSighting] = useState<AircraftSighting | null>(null);

  const enriched: AircraftInfo | null =
    state._registration || state._typeCode || state._aircraftDesc || state._operator
      ? {
          icao24: state.icao24,
          registration: state._registration ?? null,
          manufacturer: state._aircraftDesc ?? null,
          model: null,
          typecode: state._typeCode ?? null,
          operator: state._operator ?? null,
          built: null,
        }
      : null;

  useEffect(() => {
    if (enriched) {
      setAc(enriched);
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.icao24, enriched?.registration, enriched?.typecode]);


  useEffect(() => {
    let cancelled = false;
    getSighting(state.icao24)
      .then((s) => {
        if (!cancelled) setSighting(s ?? null);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [state.icao24]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = parseCallsign(state.callsign);
  const title = prettyFlightName(parsed);

  const distanceFromHome =
    home && state.latitude != null && state.longitude != null
      ? haversineMeters(home, { lat: state.latitude, lon: state.longitude })
      : null;

  const verticalRateFtMin =
    state.verticalRateMps != null
      ? Math.round(state.verticalRateMps * 196.85)
      : null;

  return (
    <aside
      className="pointer-events-auto fixed right-2 top-[4.2rem] sm:right-4 sm:top-20 z-30 w-[340px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-ink-800 bg-ink-900/95 shadow-2xl backdrop-blur"
      role="dialog"
      aria-label={`Flight ${title}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {parsed.airlineIcao ?? state.icao24.toUpperCase()}
            {state.callsign && state.callsign.trim() && state.callsign.trim() !== parsed.airlineIcao
              ? ` · ${state.callsign.trim()}`
              : ""}
          </p>
          <h3 className="mt-0.5 truncate text-lg font-semibold text-ink-100">
            {title}
          </h3>
          {ac ? (
            <p className="mt-1 text-xs text-ink-300">
              {ac.manufacturer ? `${ac.manufacturer} ` : ""}
              {ac.model ?? ac.typecode ?? "Unknown type"}
              {ac.registration ? ` · ${ac.registration}` : ""}
            </p>
          ) : state.originCountry ? (
            <p className="mt-1 text-xs text-ink-400">
              Registered in {state.originCountry}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-500">Looking up aircraft…</p>
          )}
          {ac?.operator ? (
            <p className="text-xs text-ink-400">{ac.operator}</p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 font-mono text-[11px] text-ink-400 hover:text-accent"
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
          {state.trackDeg != null
            ? `${Math.round(state.trackDeg)}° ${compassPoint(state.trackDeg)}`
            : "—"}
        </Stat>
        <Stat label="Vertical rate">
          {verticalRateFtMin == null
            ? "level"
            : verticalRateFtMin === 0
            ? "level"
            : `${verticalRateFtMin > 0 ? "↑" : "↓"} ${Math.abs(
                verticalRateFtMin
              ).toLocaleString()} ft/min`}
        </Stat>
        {distanceFromHome != null && (
          <Stat label="Distance from home">
            {formatDistanceShort(distanceFromHome, units)}
          </Stat>
        )}
        <Stat label="Last contact">
          {state.lastContact ? formatClock(state.lastContact * 1000) : "—"}
        </Stat>
        <Stat label="Squawk">
          <span className={squawkClass(state.squawk)}>{state.squawk ?? "—"}</span>
        </Stat>
        <Stat label="Status">
          {state.onGround ? "on ground" : state.spi ? "special" : "airborne"}
        </Stat>
      </section>
      {sighting && (
        <section className="border-t border-ink-800 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-accent">
            skylog has seen this plane before
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Stat label="Total sightings">
              {sighting.sightingCount.toLocaleString()}
            </Stat>
            <Stat label="Distinct days">{sighting.dayCount}</Stat>
            <Stat label="First seen">
              {timeAgoShort(sighting.firstSeenAt)}
            </Stat>
            <Stat label="Max altitude">
              {sighting.maxAltitudeM != null
                ? `${Math.round(sighting.maxAltitudeM * 3.28084).toLocaleString()} ft`
                : "—"}
            </Stat>
          </div>
          {sighting.callsigns.length > 1 && (
            <p className="mt-2 font-mono text-[10px] text-ink-500">
              callsigns used: {sighting.callsigns.slice(0, 5).join(", ")}
              {sighting.callsigns.length > 5 ? "…" : ""}
            </p>
          )}
        </section>
      )}
      <footer className="border-t border-ink-800 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-500">
        icao24 {state.icao24}
        {state.positionSource != null && ` · src ${posSourceLabel(state.positionSource)}`}
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

function compassPoint(deg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) / 45) % 8);
  return points[(idx + 8) % 8]!;
}

function formatDistanceShort(meters: number, units: UnitSystem): string {
  if (units === "imperial") {
    const mi = meters / 1609.344;
    return mi < 0.1
      ? `${Math.round(meters * 3.28084)} ft`
      : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  if (meters < 1_000) return `${Math.round(meters)} m`;
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

function squawkClass(sq: string | null): string {
  if (!sq) return "";
  if (sq === "7500" || sq === "7600" || sq === "7700") return "text-accent";
  return "";
}

function posSourceLabel(src: number): string {
  // OpenSky's position_source enum.
  switch (src) {
    case 0:
      return "ADS-B";
    case 1:
      return "ASTERIX";
    case 2:
      return "MLAT";
    case 3:
      return "FLARM";
    default:
      return `${src}`;
  }
}

function timeAgoShort(t: number): string {
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
