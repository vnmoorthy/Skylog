/**
 * SKYLOG — track one flight by callsign, forever.
 *
 * The core "why would I open this app today" feature. User pastes a
 * callsign (e.g. UAL841, BAW286); we start a dedicated 10 s poll of
 * airplanes.live's /v2/callsign/{cs} endpoint and broadcast every
 * update to the caller. Independent of the map-viewport poller, so the
 * tracked flight is visible even when the user has panned continents
 * away.
 *
 * If the callsign has multiple ADS-B matches (rare — happens with
 * generic tail-numbers like "BLOCKED") we pick the first.
 *
 * The tracker also accepts an optional home LatLon; when present, each
 * update reports the great-circle distance and a crude ETA (distance /
 * ground-speed).
 */

import { haversineMeters, type LatLon } from "./geo";
import type { StateVector } from "./opensky";

export type TrackedFlightStatus =
  | { kind: "searching"; callsign: string }
  | { kind: "live"; state: StateVector; distanceM: number | null; etaSec: number | null }
  | { kind: "lost"; callsign: string; lastSeenAt: number; lastState: StateVector }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export interface FlightTracker {
  readonly callsign: string;
  readonly stop: () => void;
}

const POLL_MS = 10_000;

/** Normalise user input: strip whitespace, uppercase. */
export function normaliseCallsign(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/** Airplanes.live callsign payload shape we need. */
interface AlAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  mag_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  category?: string;
  seen?: number;
  seen_pos?: number;
}

const FT_PER_M = 3.28084;
const KNOTS_PER_MS = 1.943844;
const FPM_PER_MS = 196.850394;

function alToStateVector(a: AlAircraft, nowMs: number): StateVector | null {
  if (a.lat == null || a.lon == null) return null;
  const baroFt =
    typeof a.alt_baro === "number" ? a.alt_baro : a.alt_baro === "ground" ? 0 : null;
  const geoFt = a.alt_geom ?? null;
  const heading = a.track ?? a.true_heading ?? a.mag_heading ?? null;
  const verticalFpm = a.geom_rate ?? a.baro_rate ?? null;
  return {
    icao24: a.hex.toLowerCase(),
    callsign: a.flight ? a.flight.trim() : null,
    originCountry: null,
    timePosition:
      a.seen_pos != null ? Math.round(nowMs / 1000 - a.seen_pos) : null,
    lastContact: Math.round(nowMs / 1000 - (a.seen ?? 0)),
    longitude: a.lon,
    latitude: a.lat,
    baroAltitudeM: baroFt != null ? baroFt / FT_PER_M : null,
    onGround: a.alt_baro === "ground",
    velocityMps: a.gs != null ? a.gs / KNOTS_PER_MS : null,
    trackDeg: heading,
    verticalRateMps: verticalFpm != null ? verticalFpm / FPM_PER_MS : null,
    geoAltitudeM: geoFt != null ? geoFt / FT_PER_M : null,
    squawk: a.squawk ?? null,
    spi: false,
    positionSource: 0,
    category: null,
    _registration: a.r ?? null,
    _typeCode: a.t ?? null,
    _aircraftDesc: a.desc ?? null,
    _operator: a.ownOp ?? null,
  };
}

export function trackCallsign(
  callsignRaw: string,
  home: LatLon | null,
  onUpdate: (status: TrackedFlightStatus) => void
): FlightTracker {
  const callsign = normaliseCallsign(callsignRaw);
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastState: StateVector | null = null;
  let lastSeenAt = 0;

  onUpdate({ kind: "searching", callsign });

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const res = await fetch(
        `https://api.airplanes.live/v2/callsign/${encodeURIComponent(callsign)}`,
        { headers: { Accept: "application/json" } }
      );
      if (cancelled) return;
      if (!res.ok) {
        onUpdate({ kind: "error", message: `HTTP ${res.status}` });
        schedule();
        return;
      }
      const body = (await res.json()) as { ac?: AlAircraft[] };
      const now = Date.now();
      const raw = body.ac?.[0];
      if (!raw) {
        if (lastState && now - lastSeenAt < 15 * 60 * 1000) {
          // Recently-seen but momentarily not in the index — call it lost.
          onUpdate({
            kind: "lost",
            callsign,
            lastSeenAt,
            lastState,
          });
        } else {
          onUpdate({ kind: "searching", callsign });
        }
        schedule();
        return;
      }
      const state = alToStateVector(raw, now);
      if (!state) {
        onUpdate({ kind: "searching", callsign });
        schedule();
        return;
      }
      lastState = state;
      lastSeenAt = now;

      let distanceM: number | null = null;
      let etaSec: number | null = null;
      if (home && state.latitude != null && state.longitude != null) {
        distanceM = haversineMeters(home, {
          lat: state.latitude,
          lon: state.longitude,
        });
        if (state.velocityMps && state.velocityMps > 10) {
          etaSec = distanceM / state.velocityMps;
        }
      }
      onUpdate({ kind: "live", state, distanceM, etaSec });
      schedule();
    } catch (err) {
      if (cancelled) return;
      onUpdate(
        navigator.onLine
          ? { kind: "error", message: err instanceof Error ? err.message : String(err) }
          : { kind: "offline" }
      );
      schedule();
    }
  };

  const schedule = (): void => {
    if (cancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void tick();
    }, POLL_MS);
  };

  void tick();

  return {
    callsign,
    stop() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
