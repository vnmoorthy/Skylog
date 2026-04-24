/**
 * SKYLOG — airport lookup, parallel to aircraftDb.
 *
 * Data source: OurAirports (public domain), filtered at build time to
 * medium+ airports only (~4000 rows). That's small enough to load
 * eagerly when needed, and covers every scheduled commercial route.
 */

import { db, type CachedAirport } from "./db";

interface BuiltAirport {
  c: string;
  a: string | null;
  n: string;
  m: string | null;
  k: string;
  y: number; // lat
  x: number; // lon
}

let memCache: Map<string, BuiltAirport> | null = null;
let iataIndex: Map<string, string> | null = null;
let loadPromise: Promise<Map<string, BuiltAirport>> | null = null;

const SOURCE_URL = "/data/airports.json.gz";

async function fetchAndDecompress(url: string): Promise<Record<string, BuiltAirport>> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`airport DB HTTP ${res.status}`);
  }
  const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(decompressed).text();
  return JSON.parse(text) as Record<string, BuiltAirport>;
}

export async function loadAirportDb(): Promise<Map<string, BuiltAirport>> {
  if (memCache) return memCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const cached = await db.meta.get("airportDbVersion");
      if (cached?.value === "ourairports-2024") {
        const rows = await db.airports.toArray();
        if (rows.length > 0) {
          return buildCache(
            Object.fromEntries(rows.map((r) => [r.icao, toBuilt(r)]))
          );
        }
      }
    } catch {
      // fall through
    }

    const data = await fetchAndDecompress(SOURCE_URL);
    const cache = buildCache(data);

    try {
      const rows: CachedAirport[] = [];
      for (const [icao, v] of Object.entries(data)) {
        rows.push({
          icao,
          iata: v.a,
          name: v.n,
          municipality: v.m,
          countryCode: v.k,
          lat: v.y,
          lon: v.x,
        });
      }
      await db.transaction("rw", db.airports, db.meta, async () => {
        await db.airports.clear();
        await db.airports.bulkPut(rows);
        await db.meta.put({ key: "airportDbVersion", value: "ourairports-2024" });
      });
    } catch {
      // non-fatal
    }

    return cache;
  })();

  return loadPromise;
}

function toBuilt(r: CachedAirport): BuiltAirport {
  return {
    c: r.icao,
    a: r.iata,
    n: r.name,
    m: r.municipality,
    k: r.countryCode,
    y: r.lat,
    x: r.lon,
  };
}

function buildCache(data: Record<string, BuiltAirport>): Map<string, BuiltAirport> {
  const m = new Map<string, BuiltAirport>();
  const iata = new Map<string, string>();
  for (const [icao, v] of Object.entries(data)) {
    m.set(icao, v);
    if (v.a) iata.set(v.a, icao);
  }
  memCache = m;
  iataIndex = iata;
  return m;
}

export interface AirportInfo {
  readonly icao: string;
  readonly iata: string | null;
  readonly name: string;
  readonly municipality: string | null;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
}

export async function lookupAirportByIcao(icao: string): Promise<AirportInfo | null> {
  const m = await loadAirportDb();
  const v = m.get(icao.toUpperCase());
  return v ? toInfo(v) : null;
}

export async function lookupAirportByIata(iata: string): Promise<AirportInfo | null> {
  await loadAirportDb();
  const idx = iataIndex;
  if (!idx) return null;
  const icao = idx.get(iata.toUpperCase());
  if (!icao) return null;
  return lookupAirportByIcao(icao);
}

function toInfo(v: BuiltAirport): AirportInfo {
  return {
    icao: v.c,
    iata: v.a,
    name: v.n,
    municipality: v.m,
    countryCode: v.k,
    lat: v.y,
    lon: v.x,
  };
}
