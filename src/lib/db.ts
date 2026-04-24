/**
 * SKYLOG — IndexedDB schema via Dexie.
 *
 * Two concerns:
 *   1. The rolling buffer of aircraft passes (`passes`). Each pass is the
 *      condensed record of one aircraft coming in and out of the user's
 *      overhead radius within a single flight leg. Bounded to 72 hours.
 *   2. Cached lookups (aircraft type, airport) so we don't re-parse the
 *      bundled JSON on every visit.
 *
 * Storage ceiling target: 50 MB. We trim aggressively in `trimOldPasses`.
 */

import Dexie, { type Table } from "dexie";

/** A single point sample written during the pass. */
export interface PassSample {
  /** Unix-ms timestamp. */
  readonly t: number;
  /** Latitude, degrees. */
  readonly lat: number;
  /** Longitude, degrees. */
  readonly lon: number;
  /** Barometric altitude, meters. null if OpenSky hasn't reported one. */
  readonly altM: number | null;
  /** Slant distance from home, meters. */
  readonly slantM: number;
  /** Estimated dB at home for this sample. */
  readonly db: number;
  /** Ground speed, m/s, or null. */
  readonly speedMps: number | null;
  /** Track (true heading), degrees, or null. */
  readonly trackDeg: number | null;
}

/**
 * One pass of one aircraft through the user's overhead radius.
 *
 * passId is derived from icao24 + the 10-minute floor of first-contact
 * time. This means if a helicopter loiters, we treat it as multiple passes
 * every 10 minutes. That matches user intuition ("another one").
 */
export interface AircraftPass {
  /** Unique key: icao24 + "-" + bucket10m. */
  readonly passId: string;
  /** Lowercase 6-hex ICAO 24-bit address. */
  readonly icao24: string;
  /** Trimmed callsign, or null. */
  readonly callsign: string | null;
  /** Country of registration from OpenSky. */
  readonly originCountry: string | null;
  /** OpenSky category enum value (0..20). */
  readonly category: number | null;

  /** Unix-ms of first contact within radius. */
  readonly firstSeen: number;
  /** Unix-ms of most recent contact within radius. */
  readonly lastSeen: number;

  /** Minimum slant distance observed during the pass, meters. */
  readonly minSlantM: number;
  /** Unix-ms at which minSlantM was observed. Used as the timeline anchor. */
  readonly closestApproachAt: number;
  /** Estimated dB at the observer at that closest approach. */
  readonly peakDb: number;
  /** Altitude (m) at closest approach, or null. */
  readonly closestAltM: number | null;
  /** Ground range (m) at closest approach. */
  readonly closestGroundM: number;

  /** Full sample trajectory while in radius. Bounded ~360 points (1h @10s). */
  readonly samples: readonly PassSample[];
}

export interface CachedAircraft {
  readonly icao24: string;
  readonly registration: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly typecode: string | null;
  readonly operator: string | null;
  readonly owner: string | null;
  readonly built: string | null;
}

export interface CachedAirport {
  readonly icao: string;
  readonly iata: string | null;
  readonly name: string;
  readonly municipality: string | null;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
}

export interface AircraftSighting {
  /** Lowercase 6-hex ICAO24 of the aircraft. Primary key. */
  readonly icao24: string;
  /** Most recent callsign string we've associated with this hex. */
  readonly lastCallsign: string | null;
  /** All distinct callsigns we've ever seen this hex use. */
  readonly callsigns: readonly string[];
  /** Most recent registration enrichment, if any data source provided it. */
  readonly registration: string | null;
  /** Most recent aircraft type code, if known (e.g. "B738"). */
  readonly typecode: string | null;
  /** Most recent operator string, if known (e.g. "United Airlines"). */
  readonly operator: string | null;
  /** Most recent country of registration from the live feed. */
  readonly originCountry: string | null;
  /** Unix-ms of the very first time we saw this aircraft. */
  readonly firstSeenAt: number;
  /** Unix-ms of the most recent sighting. */
  readonly lastSeenAt: number;
  /** Total number of polls that included this aircraft. */
  readonly sightingCount: number;
  /** Number of distinct UTC days on which we've seen this aircraft. */
  readonly dayCount: number;
  /** Max altitude in meters across all sightings. */
  readonly maxAltitudeM: number | null;
  /** Min altitude in meters across all sightings. */
  readonly minAltitudeM: number | null;
  /**
   * Comma-separated YYYY-MM-DD UTC dates we've seen this aircraft on,
   * capped to the most recent 30 for a bounded footprint.
   */
  readonly recentDays: string;
  /**
   * Recent sighting timestamps (unix-ms), capped to the most recent 100.
   * Used to detect patterns (same weekday+hour clusters = regular).
   * Stored as a comma-separated string so Dexie can persist it without
   * needing a blob column.
   */
  readonly recentTimes: string;
}

export interface MetaKV {
  readonly key: string;
  readonly value: string;
}

class SkylogDB extends Dexie {
  passes!: Table<AircraftPass, string>;
  aircraft!: Table<CachedAircraft, string>;
  airports!: Table<CachedAirport, string>;
  sightings!: Table<AircraftSighting, string>;
  meta!: Table<MetaKV, string>;

  constructor() {
    super("skylog");

    // Version 1 schema.
    this.version(1).stores({
      passes: "passId, icao24, firstSeen, lastSeen, closestApproachAt, peakDb",
      aircraft: "icao24",
      airports: "icao, iata",
      meta: "key",
    });
    // Version 2: aircraft memory ("sightings").
    this.version(2).stores({
      passes: "passId, icao24, firstSeen, lastSeen, closestApproachAt, peakDb",
      aircraft: "icao24",
      airports: "icao, iata",
      sightings: "icao24, lastSeenAt, sightingCount, dayCount",
      meta: "key",
    });
    // Version 3: add `recentTimes` on sightings — used for pattern
    // detection (regular visitors, loudest hour, etc). Keep the same
    // index set; the new field is just an extra property on each row
    // so no schema migration function is needed.
    this.version(3).stores({
      passes: "passId, icao24, firstSeen, lastSeen, closestApproachAt, peakDb",
      aircraft: "icao24",
      airports: "icao, iata",
      sightings: "icao24, lastSeenAt, sightingCount, dayCount",
      meta: "key",
    }).upgrade((tx) => {
      return tx.table("sightings").toCollection().modify((row) => {
        if (row.recentTimes == null) row.recentTimes = "";
      });
    });
  }
}

export const db = new SkylogDB();

/** Retention window for the rolling buffer: 72 hours. */
export const RETENTION_MS = 72 * 60 * 60 * 1000;

/**
 * Delete passes older than the retention window. Cheap because of the
 * `firstSeen` index.
 */
export async function trimOldPasses(now: number = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_MS;
  return db.passes.where("firstSeen").below(cutoff).delete();
}

/**
 * Rough storage-size estimator. IndexedDB doesn't expose exact byte usage,
 * so we approximate with a per-record constant + per-sample constant. This
 * is good enough to decide when to trim, not for reporting to the user.
 */
export async function estimatedBytes(): Promise<number> {
  const passes = await db.passes.toArray();
  let total = 0;
  for (const p of passes) {
    total += 512 + p.samples.length * 64;
  }
  total += (await db.aircraft.count()) * 140;
  total += (await db.airports.count()) * 110;
  return total;
}

/** 50 MB soft ceiling. */
export const STORAGE_CEILING_BYTES = 50 * 1024 * 1024;

/**
 * If we're near the ceiling, drop the oldest 20 % of passes. Called from
 * the worker on a timer.
 */
export async function enforceStorageCeiling(): Promise<number> {
  const bytes = await estimatedBytes();
  if (bytes < STORAGE_CEILING_BYTES) return 0;
  const count = await db.passes.count();
  const drop = Math.ceil(count * 0.2);
  const oldest = await db.passes
    .orderBy("firstSeen")
    .limit(drop)
    .primaryKeys();
  await db.passes.bulkDelete(oldest);
  return oldest.length;
}
