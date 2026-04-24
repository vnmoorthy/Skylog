/**
 * SKYLOG — satellite tracking via TLE propagation.
 *
 * We propagate satellite orbits client-side using satellite.js's SGP4
 * port. TLEs come from Celestrak — a free, no-key public feed that
 * updates roughly every 8 hours. We fetch only the "stations" group
 * (ISS, Tiangong, and a few others) by default; the caller can request
 * other groups (visual-brightest, starlink, gps-ops, etc.) if desired.
 *
 * Positions returned are in WGS-84 geodetic (lat/lon/altKm) which
 * MapLibre renders directly.
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
  /** Speed over ground in km/s. */
  readonly speedKmS: number;
}

interface ParsedSat {
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

/**
 * Fetch a Celestrak group and return parsed satrec records ready for
 * propagation. Throws on network failure so the caller can decide how
 * to degrade the UI.
 */
export async function fetchSatellites(
  group: CelestrakGroup = "stations"
): Promise<ParsedSat[]> {
  const res = await fetch(CELESTRAK_GROUPS[group]);
  if (!res.ok) {
    throw new Error(`Celestrak ${group}: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseTleBundle(text);
}

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
    const rec = twoline2satrec(l1, l2);
    // satellite number is characters 2-7 of line 1.
    const id = l1.substring(2, 7).trim();
    out.push({ id, name, satrec: rec });
  }
  return out;
}

/**
 * Propagate each satellite to the given UTC instant and return its
 * geodetic position + ground speed. Satellites whose propagation fails
 * are silently dropped.
 */
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
    const geo = eciToGeodetic(pv.position as EciVec3<number>, gmst);
    const v = pv.velocity as EciVec3<number>;
    // ECI velocity in km/s; ground-speed approximation is just ||v||.
    const speed = Math.hypot(v.x, v.y, v.z);
    out.push({
      id: s.id,
      name: s.name,
      lat: degreesLat(geo.latitude),
      lon: degreesLong(geo.longitude),
      altKm: geo.height,
      speedKmS: speed,
    });
  }
  return out;
}
