/**
 * SKYLOG — satellite propagation from Celestrak TLEs.
 *
 * We pull TLEs from Celestrak's public HTTP feed, parse them with
 * satellite.js (SGP4), and propagate to the current instant on each
 * render. There is no server; everything is client-side.
 *
 * We cache the last-fetched TLE text in localStorage for 6 hours so
 * refreshing the page doesn't re-fetch, and so the app still works if
 * Celestrak is temporarily unreachable.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type EciVec3,
} from "satellite.js";

export interface SatPosition {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly altKm: number;
  /** Speed in km/s. */
  readonly speedKmS: number;
}

export interface ParsedSat {
  readonly id: string;
  readonly name: string;
  readonly satrec: ReturnType<typeof twoline2satrec>;
}

const CELESTRAK_GROUPS = {
  stations: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
  visual: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
  gps: "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle",
} as const;

export type CelestrakGroup = keyof typeof CELESTRAK_GROUPS;

const CACHE_PREFIX = "skylog:tle:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h

interface CachedTle {
  readonly at: number;
  readonly text: string;
}

function readCache(group: CelestrakGroup): string | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + group);
    if (!raw) return null;
    const v = JSON.parse(raw) as CachedTle;
    if (!v.text || Date.now() - v.at > CACHE_TTL_MS) return null;
    return v.text;
  } catch {
    return null;
  }
}

function writeCache(group: CelestrakGroup, text: string): void {
  try {
    const payload: CachedTle = { at: Date.now(), text };
    localStorage.setItem(CACHE_PREFIX + group, JSON.stringify(payload));
  } catch {
    // Storage may be full or unavailable; ignore.
  }
}

export async function fetchSatellites(
  group: CelestrakGroup = "stations"
): Promise<ParsedSat[]> {
  const cached = readCache(group);
  if (cached) return parseTleBundle(cached);

  const res = await fetch(CELESTRAK_GROUPS[group]);
  if (!res.ok) throw new Error(`Celestrak ${group}: HTTP ${res.status}`);
  const text = await res.text();
  writeCache(group, text);
  return parseTleBundle(text);
}

/** Parse a Celestrak three-lines-per-sat TLE bundle. */
export function parseTleBundle(text: string): ParsedSat[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0);
  const out: ParsedSat[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]!.trim();
    const l1 = lines[i + 1]!;
    const l2 = lines[i + 2]!;
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
    try {
      const rec = twoline2satrec(l1, l2);
      const id = l1.substring(2, 7).trim();
      out.push({ id, name, satrec: rec });
    } catch {
      // Skip malformed TLE triples silently.
    }
  }
  return out;
}

/** Propagate all sats to UTC `at`; drop ones that fail propagation. */
export function propagateAll(
  sats: readonly ParsedSat[],
  at: Date = new Date()
): SatPosition[] {
  const gmst = gstime(at);
  const out: SatPosition[] = [];
  for (const s of sats) {
    const pv = propagate(s.satrec, at);
    if (!pv.position || typeof pv.position === "boolean") continue;
    if (!pv.velocity || typeof pv.velocity === "boolean") continue;
    try {
      const geo = eciToGeodetic(pv.position as EciVec3<number>, gmst);
      const v = pv.velocity as EciVec3<number>;
      out.push({
        id: s.id,
        name: s.name,
        lat: degreesLat(geo.latitude),
        lon: degreesLong(geo.longitude),
        altKm: geo.height,
        speedKmS: Math.hypot(v.x, v.y, v.z),
      });
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Propagate one satellite to a series of future times and return the
 * ground track — useful for drawing a short "path ahead" line.
 */
export function groundTrack(
  sat: ParsedSat,
  fromMs: number,
  steps: number,
  stepMs: number
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const at = new Date(fromMs + i * stepMs);
    const gmst = gstime(at);
    const pv = propagate(sat.satrec, at);
    if (!pv.position || typeof pv.position === "boolean") continue;
    const geo = eciToGeodetic(pv.position as EciVec3<number>, gmst);
    out.push([degreesLong(geo.longitude), degreesLat(geo.latitude)]);
  }
  return out;
}
