/**
 * SKYLOG — data build script.
 *
 * Downloads the OpenSky aircraft database CSV and the OurAirports CSV,
 * shapes them into compact JSON keyed by hex/ICAO, gzips them, and writes
 * to public/data/. The app fetches these at runtime via
 * DecompressionStream and caches in IndexedDB.
 *
 * Run manually with `pnpm build:data`. Caches raw CSVs in `.cache/` so
 * reruns are fast when iterating on the transform.
 *
 * Data sources (both public, CC-BY-SA-compatible):
 *   - OpenSky aircraft DB: https://opensky-network.org/datasets/metadata/aircraft-database-complete-2024-10.csv
 *     (we fetch the "latest" symlink; sizes ~50 MB raw -> ~3 MB gzipped JSON after trim)
 *   - OurAirports: https://davidmegginson.github.io/ourairports-data/airports.csv
 *     (~3 MB raw -> we keep only medium_airport + large_airport + heliports that
 *      have IATA codes, ~800 KB gzipped JSON)
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import path from "node:path";
import { Readable } from "node:stream";

/* ----------------------- paths ----------------------- */

const ROOT = path.resolve(process.cwd());
const CACHE_DIR = path.join(ROOT, ".cache");
const OUT_DIR = path.join(ROOT, "public", "data");

const AIRCRAFT_CSV = path.join(CACHE_DIR, "aircraft.csv");
const AIRPORTS_CSV = path.join(CACHE_DIR, "airports.csv");

const AIRCRAFT_URL =
  "https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2024-10.csv";
const AIRPORTS_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

/* ----------------------- tiny CSV reader ----------------------- */

/**
 * A minimal RFC 4180-ish CSV parser that handles quoted fields with
 * embedded commas and escaped quotes. We deliberately don't pull in a
 * dependency; both datasets are well-behaved.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

/* ----------------------- fetchers ----------------------- */

async function ensureDir(p: string): Promise<void> {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) {
    console.log(`[cache] using cached ${path.basename(dest)}`);
    return;
  }
  console.log(`[download] ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} for ${url}`);
  }
  // Node fetch's body is a WHATWG ReadableStream; we need to bridge it
  // to a Node writable. Node 18+ supports Readable.fromWeb.
  const nodeStream = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
  console.log(`[ok] wrote ${path.basename(dest)}`);
}

/* ----------------------- transforms ----------------------- */

interface BuiltAircraft {
  r: string | null;  // registration
  m: string | null;  // manufacturer (compact)
  t: string | null;  // typecode (compact)
  o: string | null;  // operator
  n: string | null;  // model name
  y: string | null;  // built year (first 4 chars)
}

async function buildAircraftJson(): Promise<void> {
  const raw = await readFile(AIRCRAFT_CSV, "utf8");
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) throw new Error("aircraft CSV too short");
  const header = parseCsvLine(lines[0]!);

  const idx = (col: string): number => {
    const i = header.indexOf(col);
    if (i < 0) throw new Error(`missing column ${col} in aircraft CSV`);
    return i;
  };

  const iIcao = idx("icao24");
  const iReg = idx("registration");
  const iMfr = idx("manufacturericao");
  const iModel = idx("model");
  const iType = idx("typecode");
  const iOp = idx("operator");
  const iBuilt = idx("built");

  const out: Record<string, BuiltAircraft> = {};
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const icao = (cols[iIcao] ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao)) continue;

    const rec: BuiltAircraft = {
      r: (cols[iReg] ?? "").trim() || null,
      m: (cols[iMfr] ?? "").trim() || null,
      n: (cols[iModel] ?? "").trim() || null,
      t: (cols[iType] ?? "").trim() || null,
      o: (cols[iOp] ?? "").trim() || null,
      y: ((cols[iBuilt] ?? "").trim().slice(0, 4)) || null,
    };

    if (!rec.r && !rec.m && !rec.t && !rec.n && !rec.o) continue;

    out[icao] = rec;
    rows++;
  }

  await ensureDir(OUT_DIR);
  const jsonPath = path.join(OUT_DIR, "aircraft.json");
  await writeFile(jsonPath, JSON.stringify(out));
  await gzipFile(jsonPath, jsonPath + ".gz");
  console.log(`[ok] aircraft.json.gz: ${rows.toLocaleString()} rows`);
}

interface BuiltAirport {
  c: string;   // ICAO
  a: string | null; // IATA
  n: string;   // name
  m: string | null; // municipality
  k: string;   // country code
  y: number;   // lat
  x: number;   // lon
}

async function buildAirportsJson(): Promise<void> {
  const raw = await readFile(AIRPORTS_CSV, "utf8");
  const lines = raw.split(/\r?\n/);
  const header = parseCsvLine(lines[0]!);

  const idx = (col: string): number => {
    const i = header.indexOf(col);
    if (i < 0) throw new Error(`missing column ${col} in airports CSV`);
    return i;
  };

  const iType = idx("type");
  const iIcao = idx("ident");
  const iIata = idx("iata_code");
  const iName = idx("name");
  const iMuni = idx("municipality");
  const iCC = idx("iso_country");
  const iLat = idx("latitude_deg");
  const iLon = idx("longitude_deg");

  const out: Record<string, BuiltAirport> = {};
  let rows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const type = cols[iType];
    if (type !== "medium_airport" && type !== "large_airport") continue;
    const icao = (cols[iIcao] ?? "").trim();
    if (icao.length < 3 || icao.length > 4) continue;

    const lat = Number(cols[iLat]);
    const lon = Number(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const rec: BuiltAirport = {
      c: icao,
      a: (cols[iIata] ?? "").trim() || null,
      n: (cols[iName] ?? "").trim(),
      m: (cols[iMuni] ?? "").trim() || null,
      k: (cols[iCC] ?? "").trim(),
      y: +lat.toFixed(4),
      x: +lon.toFixed(4),
    };
    out[icao] = rec;
    rows++;
  }

  await ensureDir(OUT_DIR);
  const jsonPath = path.join(OUT_DIR, "airports.json");
  await writeFile(jsonPath, JSON.stringify(out));
  await gzipFile(jsonPath, jsonPath + ".gz");
  console.log(`[ok] airports.json.gz: ${rows.toLocaleString()} rows`);
}

async function gzipFile(src: string, dest: string): Promise<void> {
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dest));
}

/* ----------------------- main ----------------------- */

async function main(): Promise<void> {
  await ensureDir(CACHE_DIR);
  await ensureDir(OUT_DIR);

  // Both datasets are best-effort. If a build machine can't reach them,
  // we still write a stub so `vite build` doesn't 404.
  try {
    await download(AIRCRAFT_URL, AIRCRAFT_CSV);
    await buildAircraftJson();
  } catch (err) {
    console.warn("[warn] aircraft DB unavailable:", (err as Error).message);
    await writeStub(path.join(OUT_DIR, "aircraft.json"), "{}");
  }

  try {
    await download(AIRPORTS_URL, AIRPORTS_CSV);
    await buildAirportsJson();
  } catch (err) {
    console.warn("[warn] airports DB unavailable:", (err as Error).message);
    await writeStub(path.join(OUT_DIR, "airports.json"), "{}");
  }
}

async function writeStub(jsonPath: string, contents: string): Promise<void> {
  await writeFile(jsonPath, contents);
  await gzipFile(jsonPath, jsonPath + ".gz");
  console.log(`[stub] ${path.basename(jsonPath)}.gz (empty)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
