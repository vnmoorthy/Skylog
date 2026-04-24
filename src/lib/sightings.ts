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

const MAX_CALLSIGNS = 12;
const MAX_RECENT_DAYS = 30;

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
