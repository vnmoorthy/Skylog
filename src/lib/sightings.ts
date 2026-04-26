/**
 * SKYLOG — aircraft memory.
 *
 * This is the gbrain-shaped feature: every aircraft ever rendered in
 * the live view gets persisted to IndexedDB with a running history of
 * when we've seen it, which callsigns it used, and summary altitude
 * stats. Unlike the home-radius `passes` table (owned by the worker),
 * sightings are recorded from anywhere the user has ever panned the
 * map to — so the memory naturally expands with curiosity.
 *
 * Footprint: one row per unique hex. ~300 B per row. 10,000 rows ≈ 3 MB,
 * well inside our 50 MB IndexedDB ceiling.
 *
 * We update in a single Dexie transaction per poll so we don't race
 * against rapid pan/zoom. `mergeOne` is the pure function that
 * updates a single record — exported for tests.
 */

import { db, type AircraftSighting } from "./db";
import type { StateVector } from "./opensky";
import { parseCallsign, airlineName } from "./callsign";

const MAX_CALLSIGNS = 12;
const MAX_RECENT_DAYS = 30;
const MAX_RECENT_TIMES = 100;

export interface RecordSightingsResult {
  readonly touched: number;
  readonly firstTimers: readonly string[];
}

/**
 * Fold a fresh poll's state vectors into the sightings table.
 * Returns how many rows were written + the icao24 of any aircraft
 * seen for the first time (so the UI can flash a "new visitor" hint).
 */
export async function recordSightings(
  states: readonly StateVector[],
  now: number = Date.now()
): Promise<RecordSightingsResult> {
  if (states.length === 0) {
    return { touched: 0, firstTimers: [] };
  }
  const ids = states.map((s) => s.icao24);
  const existing = await db.sightings.bulkGet(ids);
  const byId = new Map<string, AircraftSighting>();
  for (const e of existing) {
    if (e) byId.set(e.icao24, e);
  }
  const merged: AircraftSighting[] = [];
  const firstTimers: string[] = [];
  for (const s of states) {
    const prev = byId.get(s.icao24);
    if (!prev) firstTimers.push(s.icao24);
    merged.push(mergeOne(prev, s, now));
  }
  await db.sightings.bulkPut(merged);
  return { touched: merged.length, firstTimers };
}

/**
 * Fold a single state vector into an optional existing sighting.
 * Pure function — useful for tests. All time in unix-ms.
 */
export function mergeOne(
  prev: AircraftSighting | undefined,
  s: StateVector,
  now: number
): AircraftSighting {
  const callsign = s.callsign ? s.callsign.trim() || null : null;
  const registration = s._registration ?? prev?.registration ?? null;
  const typecode = s._typeCode ?? prev?.typecode ?? null;
  const operator = s._operator ?? prev?.operator ?? null;
  const originCountry = s.originCountry ?? prev?.originCountry ?? null;

  const alt = s.baroAltitudeM ?? s.geoAltitudeM ?? null;

  const today = utcDayString(now);
  const prevDays = prev ? prev.recentDays.split(",").filter((x) => x) : [];
  const recentDays = prevDays.includes(today)
    ? prevDays
    : [today, ...prevDays].slice(0, MAX_RECENT_DAYS);

  const callsigns = accumulateCallsigns(prev?.callsigns, callsign);

  const maxAltitudeM =
    alt == null
      ? prev?.maxAltitudeM ?? null
      : prev?.maxAltitudeM == null
      ? alt
      : Math.max(prev.maxAltitudeM, alt);
  const minAltitudeM =
    alt == null
      ? prev?.minAltitudeM ?? null
      : prev?.minAltitudeM == null
      ? alt
      : Math.min(prev.minAltitudeM, alt);

  const prevTimes = prev?.recentTimes
    ? prev.recentTimes
        .split(",")
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x))
    : [];
  const nextTimes = [now, ...prevTimes].slice(0, MAX_RECENT_TIMES);

  return {
    icao24: s.icao24,
    lastCallsign: callsign ?? prev?.lastCallsign ?? null,
    callsigns,
    registration,
    typecode,
    operator,
    originCountry,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSeenAt: now,
    sightingCount: (prev?.sightingCount ?? 0) + 1,
    dayCount: recentDays.length,
    maxAltitudeM,
    minAltitudeM,
    recentDays: recentDays.join(","),
    recentTimes: nextTimes.join(","),
  };
}

function accumulateCallsigns(
  prev: readonly string[] | undefined,
  next: string | null
): readonly string[] {
  if (!next) return prev ?? [];
  if (!prev || prev.length === 0) return [next];
  if (prev.includes(next)) return prev;
  return [next, ...prev].slice(0, MAX_CALLSIGNS);
}

function utcDayString(t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Look up one sighting by hex. */
export async function getSighting(
  icao24: string
): Promise<AircraftSighting | undefined> {
  return db.sightings.get(icao24);
}

/** Most frequent visitors: aircraft with the highest visit count. */
export async function topFrequentVisitors(
  limit: number = 10
): Promise<AircraftSighting[]> {
  // Dexie can't reverse-sort on a non-keypath easily; pull top-N by
  // day-count then sort in JS. 10,000 rows * small payload is fine.
  const all = await db.sightings.toArray();
  all.sort(
    (a, b) =>
      b.sightingCount - a.sightingCount ||
      b.dayCount - a.dayCount ||
      b.lastSeenAt - a.lastSeenAt
  );
  return all.slice(0, limit);
}

/** Totals for the digest widget. */
export interface DigestSummary {
  readonly totalSeen: number;
  readonly todayCount: number;
  readonly yesterdayCount: number;
  readonly newTodayCount: number;
}

export async function digestSummary(
  now: number = Date.now()
): Promise<DigestSummary> {
  const all = await db.sightings.toArray();
  const today = utcDayString(now);
  const yesterday = utcDayString(now - 24 * 60 * 60 * 1000);
  let todayCount = 0;
  let yesterdayCount = 0;
  let newTodayCount = 0;
  for (const s of all) {
    const days = s.recentDays.split(",");
    if (days.includes(today)) todayCount += 1;
    if (days.includes(yesterday)) yesterdayCount += 1;
    if (utcDayString(s.firstSeenAt) === today) newTodayCount += 1;
  }
  return {
    totalSeen: all.length,
    todayCount,
    yesterdayCount,
    newTodayCount,
  };
}


/* =====================================================================
 * Pattern detection.
 * =====================================================================
 *
 * Given a sighting's recentTimes, group by (weekday, hour) using the
 * user's local clock. If three or more sightings cluster into the same
 * weekday+hour bucket, flag as "regular". We keep the best-scoring
 * bucket per aircraft as the canonical pattern.
 */

export interface Pattern {
  /** 0–6, Sunday = 0. */
  readonly weekday: number;
  /** 0–23 in the user's local timezone. */
  readonly hour: number;
  /** How many sightings landed in this bucket. */
  readonly count: number;
}

/** Decode the recentTimes CSV into ms timestamps, newest-first. */
export function decodeRecentTimes(s: string): number[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
}

/** Bucket times into weekday/hour and return the most-common bucket. */
export function dominantPattern(times: readonly number[]): Pattern | null {
  if (times.length < 3) return null;
  const counts = new Map<string, { wd: number; h: number; n: number }>();
  for (const t of times) {
    const d = new Date(t);
    const wd = d.getDay();
    const h = d.getHours();
    const key = `${wd}:${h}`;
    const existing = counts.get(key);
    if (existing) existing.n += 1;
    else counts.set(key, { wd, h, n: 1 });
  }
  let best: { wd: number; h: number; n: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best || best.n < 3) return null;
  return { weekday: best.wd, hour: best.h, count: best.n };
}

/** Locale-friendly weekday names. */
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function prettyPattern(p: Pattern): string {
  const hourLabel = `${p.hour.toString().padStart(2, "0")}:00`;
  return `${WEEKDAY[p.weekday]}s around ${hourLabel}`;
}

export interface RegularVisitor {
  readonly sighting: AircraftSighting;
  readonly pattern: Pattern;
}

/** Find aircraft with a detectable regular-visit pattern. Highest n first. */
export async function regularVisitors(
  limit: number = 10
): Promise<RegularVisitor[]> {
  const all = await db.sightings.toArray();
  const scored: RegularVisitor[] = [];
  for (const s of all) {
    const times = decodeRecentTimes(s.recentTimes);
    const p = dominantPattern(times);
    if (p) scored.push({ sighting: s, pattern: p });
  }
  scored.sort(
    (a, b) =>
      b.pattern.count - a.pattern.count ||
      b.sighting.sightingCount - a.sighting.sightingCount
  );
  return scored.slice(0, limit);
}

/** Most common local hour-of-day across ALL sightings. Null if no data. */
export interface HourOfDayStat {
  readonly hour: number;
  readonly count: number;
}

export async function busiestHour(): Promise<HourOfDayStat | null> {
  const all = await db.sightings.toArray();
  const buckets = new Array(24).fill(0) as number[];
  for (const s of all) {
    for (const t of decodeRecentTimes(s.recentTimes)) {
      const h = new Date(t).getHours();
      buckets[h] += 1;
    }
  }
  let bestH = -1;
  let bestN = 0;
  for (let h = 0; h < 24; h++) {
    if (buckets[h]! > bestN) {
      bestN = buckets[h]!;
      bestH = h;
    }
  }
  if (bestH === -1 || bestN === 0) return null;
  return { hour: bestH, count: bestN };
}


/* =====================================================================
 * Airline distribution: who flies over my sky most?
 * =====================================================================
 */

export interface AirlineShare {
  /** ICAO code (e.g. "UAL"). null for general aviation / military / unknown. */
  readonly icao: string | null;
  /** Human-friendly airline name when we know it, else the ICAO code,
   *  else "General aviation / unknown". */
  readonly name: string;
  /** Total sightings whose lastCallsign maps to this airline. */
  readonly count: number;
  /** Share of total sightings, 0..1. */
  readonly share: number;
}

export async function airlineDistribution(
  limit: number = 10
): Promise<AirlineShare[]> {
  const all = await db.sightings.toArray();
  if (all.length === 0) return [];
  const tally = new Map<string | null, number>();
  for (const s of all) {
    const parsed = parseCallsign(s.lastCallsign);
    const key = parsed.airlineIcao ?? null;
    tally.set(key, (tally.get(key) ?? 0) + s.sightingCount);
  }
  const totalSightings = Array.from(tally.values()).reduce((a, b) => a + b, 0);
  if (totalSightings === 0) return [];
  const shares: AirlineShare[] = [];
  for (const [icao, count] of tally) {
    shares.push({
      icao,
      name:
        icao == null
          ? "General aviation / unknown"
          : airlineName(icao) ?? icao,
      count,
      share: count / totalSightings,
    });
  }
  shares.sort((a, b) => b.count - a.count);
  return shares.slice(0, limit);
}
