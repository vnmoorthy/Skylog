/**
 * SKYLOG — OpenSky Network REST client.
 *
 * Only one endpoint is used in v0.1: /api/states/all with a bounding box.
 *
 * Anonymous rate limit (docs): 10 s minimum between requests, and a
 * per-IP credit budget of 400/day where large bboxes cost more credits.
 * We operate well inside that:
 *   - One global poller, shared across all components.
 *   - Exactly one call every 10 s => 8,640/day theoretical, but at
 *     daily-cap 400, the poller will hit the soft cap after ~66 minutes
 *     in the worst case. We only use a single call per 10 s and back off
 *     aggressively on 429. A typical user's daily budget covers their
 *     waking hours of observation comfortably.
 *
 * Ref: https://opensky-network.org/apidoc/rest.html#all-state-vectors
 */

import type { BBox } from "./geo";

/** Minimum milliseconds between requests, per the anonymous rate policy. */
export const MIN_POLL_INTERVAL_MS = 10_000;

/** Default soft credit budget. OpenSky anon is ~400/day. */
export const DEFAULT_DAILY_CREDITS = 400;

/**
 * A single row from /states/all, typed. OpenSky returns a JSON array
 * whose index layout is documented at the URL in the module header.
 */
export interface StateVector {
  readonly icao24: string;
  readonly callsign: string | null;
  readonly originCountry: string | null;
  readonly timePosition: number | null;
  readonly lastContact: number;
  readonly longitude: number | null;
  readonly latitude: number | null;
  readonly baroAltitudeM: number | null;
  readonly onGround: boolean;
  readonly velocityMps: number | null;
  readonly trackDeg: number | null;
  readonly verticalRateMps: number | null;
  readonly geoAltitudeM: number | null;
  readonly squawk: string | null;
  readonly spi: boolean;
  readonly positionSource: number;
  readonly category: number | null;
}

export interface StatesResponse {
  readonly time: number;
  readonly states: StateVector[];
}

export type OpenSkyStatus =
  | { kind: "idle" }
  | { kind: "polling" }
  | { kind: "rate_limited"; until: number }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export interface RateLimitState {
  lastCallAt: number;
  /** Simple token-bucket: credits used today. Reset at local midnight. */
  creditsUsedToday: number;
  dayStartedAt: number;
}

export function createRateLimitState(): RateLimitState {
  return {
    lastCallAt: 0,
    creditsUsedToday: 0,
    dayStartedAt: startOfLocalDay(Date.now()),
  };
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Compute the credit cost of a single /states/all call with a bbox, using
 * the cost table published in the OpenSky docs. Anon tier costs:
 *   - area ≤ 25 deg²   -> 1 credit
 *   - area ≤ 100 deg²  -> 2 credits
 *   - area ≤ 400 deg²  -> 3 credits
 *   - larger / no box  -> 4 credits
 *
 * We always use a bbox, and for any sensible SKYLOG radius (< ~100 km)
 * the cost is 1 credit.
 */
export function creditCost(bbox: BBox): number {
  const area =
    Math.max(0, bbox.lamax - bbox.lamin) *
    Math.max(0, bbox.lomax - bbox.lomin);
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

/**
 * Decode a raw OpenSky row array into a typed StateVector. Returns null
 * if the row is missing required fields (no position).
 */
export function decodeStateRow(row: readonly unknown[]): StateVector | null {
  // Row layout from the OpenSky docs (index: field).
  if (!Array.isArray(row) || row.length < 17) return null;
  const lat = row[6];
  const lon = row[5];
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  const icao24 = row[0];
  const lastContact = row[4];
  if (typeof icao24 !== "string" || typeof lastContact !== "number") return null;

  return {
    icao24: icao24.trim().toLowerCase(),
    callsign: typeof row[1] === "string" ? (row[1] as string).trim() || null : null,
    originCountry: typeof row[2] === "string" ? (row[2] as string) : null,
    timePosition: typeof row[3] === "number" ? row[3] : null,
    lastContact: lastContact,
    longitude: lon,
    latitude: lat,
    baroAltitudeM: typeof row[7] === "number" ? row[7] : null,
    onGround: row[8] === true,
    velocityMps: typeof row[9] === "number" ? row[9] : null,
    trackDeg: typeof row[10] === "number" ? row[10] : null,
    verticalRateMps: typeof row[11] === "number" ? row[11] : null,
    geoAltitudeM: typeof row[13] === "number" ? row[13] : null,
    squawk: typeof row[14] === "string" ? (row[14] as string) : null,
    spi: row[15] === true,
    positionSource: typeof row[16] === "number" ? row[16] : 0,
    category: typeof row[17] === "number" ? row[17] : null,
  };
}

/**
 * Build the full /states/all URL with a bbox.
 */
export function statesUrl(bbox: BBox): string {
  const qs = new URLSearchParams({
    lamin: bbox.lamin.toFixed(4),
    lomin: bbox.lomin.toFixed(4),
    lamax: bbox.lamax.toFixed(4),
    lomax: bbox.lomax.toFixed(4),
  });
  return `https://opensky-network.org/api/states/all?${qs.toString()}`;
}

/**
 * Execute one poll. Caller is responsible for respecting MIN_POLL_INTERVAL_MS.
 * Returns the decoded response on success, or a structured error.
 */
export async function fetchStates(
  bbox: BBox,
  signal?: AbortSignal
): Promise<
  | { ok: true; data: StatesResponse }
  | { ok: false; error: "rate_limited"; retryAfterMs: number }
  | { ok: false; error: "network"; message: string }
  | { ok: false; error: "invalid"; message: string }
> {
  const url = statesUrl(bbox);

  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    return {
      ok: false,
      error: "network",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.status === 429 || res.status === 503) {
    // OpenSky sometimes returns Retry-After; fall back to 60 s.
    const ra = res.headers.get("Retry-After");
    const sec = ra ? Number.parseInt(ra, 10) : 60;
    return {
      ok: false,
      error: "rate_limited",
      retryAfterMs: Number.isFinite(sec) ? sec * 1000 : 60_000,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: "network",
      message: `HTTP ${res.status} ${res.statusText}`,
    };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: "invalid",
      message: err instanceof Error ? err.message : "bad JSON",
    };
  }

  if (
    !json ||
    typeof json !== "object" ||
    typeof (json as { time?: unknown }).time !== "number"
  ) {
    return {
      ok: false,
      error: "invalid",
      message: "unexpected response shape",
    };
  }

  const rows = (json as { states?: unknown[] }).states;
  const decoded: StateVector[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const sv = decodeStateRow(row);
      if (sv) decoded.push(sv);
    }
  }

  return {
    ok: true,
    data: {
      time: (json as { time: number }).time,
      states: decoded,
    },
  };
}

/**
 * Update the rate-limit bookkeeping for a completed call. Returns a new
 * state (pure). Callers should persist this in the worker's memory.
 */
export function accountCall(
  state: RateLimitState,
  bbox: BBox,
  now: number
): RateLimitState {
  const dayStart = startOfLocalDay(now);
  const fresh = dayStart !== state.dayStartedAt;
  return {
    lastCallAt: now,
    creditsUsedToday:
      (fresh ? 0 : state.creditsUsedToday) + creditCost(bbox),
    dayStartedAt: dayStart,
  };
}

/**
 * True if we're at or above the soft daily credit ceiling.
 */
export function dailyCapReached(
  state: RateLimitState,
  cap: number = DEFAULT_DAILY_CREDITS
): boolean {
  return state.creditsUsedToday >= cap;
}

/**
 * True if enough time has elapsed since the last call to poll again.
 */
export function canPollNow(
  state: RateLimitState,
  now: number,
  minIntervalMs: number = MIN_POLL_INTERVAL_MS
): boolean {
  return now - state.lastCallAt >= minIntervalMs;
}
