/**
 * SKYLOG — aircraft DB lazy loader.
 *
 * Runtime flow:
 *   1. On first lookup, fetch /data/aircraft.json.gz.
 *   2. Decompress via DecompressionStream (browser native, no polyfill).
 *   3. Parse into a Record<hex, BuiltAircraft>.
 *   4. Cache in memory and in Dexie (so second launch is instant).
 *
 * The raw OpenSky aircraft database is ~50 MB CSV. The build-time
 * transform drops to ~3 MB gzipped JSON. Decompressed in-memory size is
 * ~25 MB of strings, which is acceptable for a single-page app that
 * expects desktop usage.
 */

import { db, type CachedAircraft } from "./db";

interface BuiltAircraft {
  r: string | null;
  m: string | null;
  n: string | null;
  t: string | null;
  o: string | null;
  y: string | null;
}

let memCache: Map<string, BuiltAircraft> | null = null;
let loadPromise: Promise<Map<string, BuiltAircraft>> | null = null;

const SOURCE_URL = (import.meta.env.BASE_URL ?? "/") + "data/aircraft.json.gz";

async function fetchAndDecompress(url: string): Promise<Record<string, BuiltAircraft>> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`aircraft DB HTTP ${res.status}`);
  }
  const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(decompressed).text();
  return JSON.parse(text) as Record<string, BuiltAircraft>;
}

/**
 * Load the aircraft DB (memoized). Safe to call concurrently — the first
 * call wins, later calls await the same promise.
 */
export async function loadAircraftDb(): Promise<Map<string, BuiltAircraft>> {
  if (memCache) return memCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Try the Dexie cache first.
    try {
      const cached = await db.meta.get("aircraftDbVersion");
      if (cached?.value === "2024-10") {
        const rows = await db.aircraft.toArray();
        if (rows.length > 0) {
          const m = new Map<string, BuiltAircraft>();
          for (const r of rows) {
            m.set(r.icao24, {
              r: r.registration,
              m: r.manufacturer,
              n: r.model,
              t: r.typecode,
              o: r.operator,
              y: r.built,
            });
          }
          memCache = m;
          return m;
        }
      }
    } catch {
      // Dexie can throw on private-mode browsers. Fall through to fetch.
    }

    const data = await fetchAndDecompress(SOURCE_URL);
    const map = new Map<string, BuiltAircraft>(Object.entries(data));

    // Write-through to Dexie for next launch.
    try {
      const rows: CachedAircraft[] = [];
      for (const [hex, v] of map) {
        rows.push({
          icao24: hex,
          registration: v.r,
          manufacturer: v.m,
          model: v.n,
          typecode: v.t,
          operator: v.o,
          owner: null,
          built: v.y,
        });
      }
      await db.transaction("rw", db.aircraft, db.meta, async () => {
        await db.aircraft.clear();
        await db.aircraft.bulkPut(rows);
        await db.meta.put({ key: "aircraftDbVersion", value: "2024-10" });
      });
    } catch {
      // Non-fatal: app still works without the persistent cache.
    }

    memCache = map;
    return map;
  })();

  return loadPromise;
}

export interface AircraftInfo {
  readonly icao24: string;
  readonly registration: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly typecode: string | null;
  readonly operator: string | null;
  readonly built: string | null;
}

/**
 * Look up one aircraft. Triggers DB load on first call. Returns null when
 * the hex is unknown.
 */
export async function lookupAircraft(icao24: string): Promise<AircraftInfo | null> {
  const key = icao24.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(key)) return null;
  const m = await loadAircraftDb();
  const row = m.get(key);
  if (!row) return null;
  return {
    icao24: key,
    registration: row.r,
    manufacturer: row.m,
    model: row.n,
    typecode: row.t,
    operator: row.o,
    built: row.y,
  };
}

/** Synchronous lookup — useful inside React render after preload. */
export function lookupAircraftSync(icao24: string): AircraftInfo | null {
  if (!memCache) return null;
  const key = icao24.trim().toLowerCase();
  const row = memCache.get(key);
  if (!row) return null;
  return {
    icao24: key,
    registration: row.r,
    manufacturer: row.m,
    model: row.n,
    typecode: row.t,
    operator: row.o,
    built: row.y,
  };
}
