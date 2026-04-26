/**
 * SKYLOG — live aircraft poller.
 *
 * Data source: the community-run airplanes.live v2 REST API. Unlike
 * OpenSky's anonymous REST endpoint, airplanes.live consistently emits
 * proper CORS headers for arbitrary web origins, so we can call it
 * directly from the browser without a proxy. The payload is also
 * richer: each aircraft arrives with its registration, aircraft type,
 * operator, and category pre-joined.
 *
 * Strategy:
 *   - Poll every 10 s (matches the typical radar sweep cadence).
 *   - Query by (centre lat/lon, radius in nautical miles) — derived
 *     from the current map viewport. The API is happiest with queries
 *     up to a few hundred NM; we cap at 250 NM to stay fast.
 *   - Status transitions are dispatched to the caller so the UI can
 *     show "loading / ok / empty / error" without polling itself.
 */

import { haversineMeters, type BBox } from "./geo";
import type { StateVector } from "./opensky";

export type LivePollStatus =
  | { kind: "loading" }
  | { kind: "ok"; count: number; at: number }
  | { kind: "empty"; at: number }
  | { kind: "delayed"; lastGoodAt: number; lastCount: number }
  | { kind: "too_wide" }
  | { kind: "rate_limited"; retryAt: number }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/** Window after a successful poll within which transient errors are
 *  presented as "delayed" rather than "error". 60 s ≈ 6 poll cycles. */
const DELAYED_WINDOW_MS = 60_000;

export const POLL_INTERVAL_MS = 10_000;

/** API caps queries at ~250 NM; we mirror that. Prevents accidental
 *  globe-wide fetches when the user zooms way out. */
const MAX_RADIUS_NM = 250;
const NM_PER_METER = 1 / 1852;

export interface LivePoller {
  updateBBox: (bbox: BBox) => void;
  stop: () => void;
}

interface QueryCenter {
  lat: number;
  lon: number;
  nm: number;
}

/** Derive (center, radius-NM) from a bounding box by taking the
 *  centroid and half the great-circle diagonal. */
function bboxToCenter(b: BBox): QueryCenter {
  const lat = (b.lamin + b.lamax) / 2;
  const lon = (b.lomin + b.lomax) / 2;
  const halfDiagM =
    haversineMeters({ lat: b.lamin, lon: b.lomin }, { lat: b.lamax, lon: b.lomax }) /
    2;
  const nm = Math.min(Math.max(halfDiagM * NM_PER_METER, 25), MAX_RADIUS_NM);
  return { lat, lon, nm };
}

/** airplanes.live payload shape (just the fields we use). */
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
  emergency?: string;
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
    category: parseCategory(a.category),
    _registration: a.r ?? null,
    _typeCode: a.t ?? null,
    _aircraftDesc: a.desc ?? null,
    _operator: a.ownOp ?? null,
  };
}

/** airplanes.live categories are "A0" through "A7" / "B0" etc; OpenSky
 * uses numeric 0–20. A1–A5 map to 2–6 (light → heavy jet). */
function parseCategory(cat?: string): number | null {
  if (!cat) return null;
  if (cat.startsWith("A")) {
    const n = Number(cat.slice(1));
    if (Number.isFinite(n)) return n + 1;
  }
  return null;
}

export function startLivePoller(
  initialBBox: BBox,
  onStates: (states: StateVector[]) => void,
  onStatus: (s: LivePollStatus) => void
): LivePoller {
  let bbox = initialBBox;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastGoodAt = 0;
  let lastCount = 0;

  onStatus({ kind: "loading" });

  const schedule = (ms: number = POLL_INTERVAL_MS): void => {
    if (cancelled) return;
    timer = setTimeout(() => {
      void tick();
    }, ms);
  };

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    const center = bboxToCenter(bbox);
    if (center.nm >= MAX_RADIUS_NM) {
      onStatus({ kind: "too_wide" });
      schedule();
      return;
    }
    const url = `https://api.airplanes.live/v2/point/${center.lat.toFixed(4)}/${center.lon.toFixed(4)}/${Math.round(center.nm)}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (cancelled) return;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "") || 30;
        onStatus({ kind: "rate_limited", retryAt: Date.now() + retryAfter * 1000 });
        schedule(retryAfter * 1000);
        return;
      }
      if (!res.ok) {
        const recentlyGood = lastGoodAt > 0 && Date.now() - lastGoodAt < DELAYED_WINDOW_MS;
        onStatus(
          recentlyGood
            ? { kind: "delayed", lastGoodAt, lastCount }
            : { kind: "error", message: `HTTP ${res.status}` }
        );
        schedule();
        return;
      }
      const json = (await res.json()) as { ac?: AlAircraft[] };
      if (cancelled) return;
      const now = Date.now();
      const states: StateVector[] = (json.ac ?? [])
        .map((a) => alToStateVector(a, now))
        .filter((s): s is StateVector => s !== null);
      lastGoodAt = Date.now();
      lastCount = states.length;
      onStates(states);
      onStatus(
        states.length > 0
          ? { kind: "ok", count: states.length, at: lastGoodAt }
          : { kind: "empty", at: lastGoodAt }
      );
      schedule();
    } catch (err) {
      if (cancelled) return;
      onStatus({
        kind:
          typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
        message: err instanceof Error ? err.message : String(err),
      } as LivePollStatus);
      schedule();
    }
  };

  void tick();

  return {
    updateBBox(next) {
      bbox = next;
    },
    stop() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
