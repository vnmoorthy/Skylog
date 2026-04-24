/// <reference lib="webworker" />

/**
 * SKYLOG — background poller.
 *
 * Runs in a dedicated worker. Receives a START message from the main
 * thread with home coordinates + radius, then drives an indefinite poll
 * loop against OpenSky. For each poll:
 *
 *   1. Compute a bbox around home.
 *   2. Fetch /states/all within that bbox.
 *   3. For each aircraft in bbox, compute slant distance + estimated dB.
 *   4. If slant < radius, open-or-extend the aircraft's current pass:
 *       - first contact: create a new pass in IndexedDB
 *       - subsequent: append a sample, update closest-approach fields
 *   5. If slant >= radius but we have an open pass, finalize it.
 *   6. On an 8-minute tick, trim the rolling buffer to 72 h.
 *
 * Error handling: network failures and rate-limit bodies are caught,
 * reported to the main thread as status messages, and the loop continues.
 */

import {
  boundingBox,
  slantDistanceMeters,
  haversineMeters,
  type LatLon,
} from "../lib/geo";
import { observedDb } from "../lib/acoustics";
import {
  fetchStates,
  MIN_POLL_INTERVAL_MS,
  accountCall,
  canPollNow,
  dailyCapReached,
  createRateLimitState,
  type RateLimitState,
  type StateVector,
} from "../lib/opensky";
import {
  db,
  trimOldPasses,
  enforceStorageCeiling,
  type AircraftPass,
  type PassSample,
} from "../lib/db";

/* ---- protocol ---- */

export interface StartMessage {
  type: "START";
  home: LatLon;
  radiusMeters: number;
}

export interface StopMessage {
  type: "STOP";
}

export interface UpdateHomeMessage {
  type: "UPDATE_HOME";
  home: LatLon;
  radiusMeters: number;
}

export type InboundMessage = StartMessage | StopMessage | UpdateHomeMessage;

export type OutboundMessage =
  | { type: "STATUS"; kind: "idle" | "polling" | "offline"; creditsUsed: number; nextPollAt: number }
  | { type: "STATUS"; kind: "rate_limited"; until: number; creditsUsed: number }
  | { type: "STATUS"; kind: "error"; message: string; creditsUsed: number }
  | { type: "PASS_UPDATED"; pass: AircraftPass }
  | { type: "PASS_CLOSED"; passId: string }
  | { type: "LIVE_TICK"; at: number; aircraft: LivePoint[] };

export interface LivePoint {
  readonly icao24: string;
  readonly callsign: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly altM: number | null;
  readonly slantM: number;
  readonly db: number;
  readonly trackDeg: number | null;
  readonly speedMps: number | null;
  readonly category: number | null;
}

/* ---- state ---- */

interface OpenPass {
  base: AircraftPass;
  samples: PassSample[];
  lastWriteAt: number;
}

let home: LatLon | null = null;
let radius = 25_000;
let running = false;
let rate: RateLimitState = createRateLimitState();
const openPasses = new Map<string, OpenPass>();
let abort: AbortController | null = null;

let lastTrimAt = 0;
const TRIM_INTERVAL_MS = 8 * 60 * 1000;

/* ---- helpers ---- */

function post(msg: OutboundMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function passIdFor(sv: StateVector): string {
  // 10-minute bucket: a single aircraft crossing the radius repeatedly
  // within 10 minutes is the same pass; otherwise a new one. This
  // prevents runaway splitting on noisy ADS-B where the plane flickers
  // in and out of radius.
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  return `${sv.icao24}-${bucket}`;
}

function bestAltitude(sv: StateVector): number | null {
  // Prefer baro; fall back to geo.
  if (sv.baroAltitudeM != null) return sv.baroAltitudeM;
  if (sv.geoAltitudeM != null) return sv.geoAltitudeM;
  return null;
}

async function openOrExtendPass(
  sv: StateVector,
  home: LatLon,
  now: number
): Promise<void> {
  const alt = bestAltitude(sv);
  // Can't usefully bucket an aircraft with no altitude AND on-ground flag.
  if (sv.onGround) return;

  const altForCalc = alt ?? 1500; // plausible low-cruise fallback
  const ground = haversineMeters(home, {
    lat: sv.latitude as number,
    lon: sv.longitude as number,
  });
  const slant = slantDistanceMeters(
    home,
    { lat: sv.latitude as number, lon: sv.longitude as number },
    altForCalc
  );
  const db_ = observedDb(sv.category, slant, altForCalc);

  const sample: PassSample = {
    t: now,
    lat: sv.latitude as number,
    lon: sv.longitude as number,
    altM: alt,
    slantM: slant,
    db: db_,
    speedMps: sv.velocityMps,
    trackDeg: sv.trackDeg,
  };

  const id = passIdFor(sv);
  const existing = openPasses.get(id);

  if (!existing) {
    const base: AircraftPass = {
      passId: id,
      icao24: sv.icao24,
      callsign: sv.callsign,
      originCountry: sv.originCountry,
      category: sv.category,
      firstSeen: now,
      lastSeen: now,
      minSlantM: slant,
      closestApproachAt: now,
      peakDb: db_,
      closestAltM: alt,
      closestGroundM: ground,
      samples: [sample],
    };
    openPasses.set(id, {
      base,
      samples: [sample],
      lastWriteAt: now,
    });
    await db.passes.put(base);
    post({ type: "PASS_UPDATED", pass: base });
    return;
  }

  existing.samples.push(sample);
  // Cap per-pass sample storage. 360 samples @ 10 s = 1 h.
  if (existing.samples.length > 360) {
    existing.samples.shift();
  }

  const base = existing.base;
  const nextBase: AircraftPass = {
    ...base,
    callsign: sv.callsign ?? base.callsign,
    category: sv.category ?? base.category,
    lastSeen: now,
    minSlantM: Math.min(base.minSlantM, slant),
    closestApproachAt: slant < base.minSlantM ? now : base.closestApproachAt,
    peakDb: Math.max(base.peakDb, db_),
    closestAltM: slant < base.minSlantM ? alt : base.closestAltM,
    closestGroundM: slant < base.minSlantM ? ground : base.closestGroundM,
    samples: existing.samples.slice(),
  };
  existing.base = nextBase;

  // Coalesce writes to IndexedDB to roughly once per 30 s per pass to
  // keep disk IO down.
  if (now - existing.lastWriteAt > 30_000) {
    await db.passes.put(nextBase);
    existing.lastWriteAt = now;
    post({ type: "PASS_UPDATED", pass: nextBase });
  } else {
    post({ type: "PASS_UPDATED", pass: nextBase });
  }
}

async function closeStalePasses(now: number): Promise<void> {
  // If we haven't seen an aircraft for 3 consecutive polls (30 s), treat
  // the pass as closed.
  const STALE_MS = 35_000;
  const toClose: string[] = [];
  for (const [id, op] of openPasses) {
    if (now - op.base.lastSeen > STALE_MS) {
      toClose.push(id);
      await db.passes.put(op.base);
      post({ type: "PASS_CLOSED", passId: id });
    }
  }
  for (const id of toClose) openPasses.delete(id);
}

async function tick(): Promise<void> {
  if (!running || !home) return;

  const now = Date.now();

  if (dailyCapReached(rate)) {
    post({
      type: "STATUS",
      kind: "rate_limited",
      until: nextMidnightMs(),
      creditsUsed: rate.creditsUsedToday,
    });
    schedule(60_000);
    return;
  }

  if (!canPollNow(rate, now)) {
    schedule(MIN_POLL_INTERVAL_MS - (now - rate.lastCallAt));
    return;
  }

  const bbox = boundingBox(home, radius);
  post({
    type: "STATUS",
    kind: "polling",
    creditsUsed: rate.creditsUsedToday,
    nextPollAt: now + MIN_POLL_INTERVAL_MS,
  });

  abort = new AbortController();
  const result = await fetchStates(bbox, abort.signal);
  abort = null;

  if (!result.ok) {
    if (result.error === "rate_limited") {
      post({
        type: "STATUS",
        kind: "rate_limited",
        until: now + result.retryAfterMs,
        creditsUsed: rate.creditsUsedToday,
      });
      schedule(result.retryAfterMs);
      return;
    }
    if (result.error === "network") {
      post({
        type: "STATUS",
        kind: "offline",
        creditsUsed: rate.creditsUsedToday,
        nextPollAt: now + MIN_POLL_INTERVAL_MS,
      });
      schedule(MIN_POLL_INTERVAL_MS);
      return;
    }
    post({
      type: "STATUS",
      kind: "error",
      message: result.message,
      creditsUsed: rate.creditsUsedToday,
    });
    schedule(MIN_POLL_INTERVAL_MS);
    return;
  }

  rate = accountCall(rate, bbox, now);

  const inRadius: LivePoint[] = [];
  for (const sv of result.data.states) {
    if (sv.latitude == null || sv.longitude == null || sv.onGround) continue;
    const alt = bestAltitude(sv) ?? 1500;
    const slant = slantDistanceMeters(
      home,
      { lat: sv.latitude, lon: sv.longitude },
      alt
    );
    if (slant > radius) continue;

    const db_ = observedDb(sv.category, slant, alt);
    inRadius.push({
      icao24: sv.icao24,
      callsign: sv.callsign,
      lat: sv.latitude,
      lon: sv.longitude,
      altM: bestAltitude(sv),
      slantM: slant,
      db: db_,
      trackDeg: sv.trackDeg,
      speedMps: sv.velocityMps,
      category: sv.category,
    });

    await openOrExtendPass(sv, home, now);
  }

  await closeStalePasses(now);

  if (now - lastTrimAt > TRIM_INTERVAL_MS) {
    await trimOldPasses(now);
    await enforceStorageCeiling();
    lastTrimAt = now;
  }

  post({ type: "LIVE_TICK", at: now, aircraft: inRadius });

  post({
    type: "STATUS",
    kind: "idle",
    creditsUsed: rate.creditsUsedToday,
    nextPollAt: now + MIN_POLL_INTERVAL_MS,
  });

  schedule(MIN_POLL_INTERVAL_MS);
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void tick();
  }, Math.max(250, ms));
}

function nextMidnightMs(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/* ---- entry ---- */

self.addEventListener("message", (ev: MessageEvent<InboundMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "START":
      home = msg.home;
      radius = msg.radiusMeters;
      if (!running) {
        running = true;
        rate = createRateLimitState();
        schedule(0);
      }
      break;
    case "UPDATE_HOME":
      home = msg.home;
      radius = msg.radiusMeters;
      // Clear open-pass accumulator when home moves — old passes no
      // longer apply to the new origin.
      openPasses.clear();
      schedule(0);
      break;
    case "STOP":
      running = false;
      if (abort) abort.abort();
      if (timer) clearTimeout(timer);
      break;
  }
});
