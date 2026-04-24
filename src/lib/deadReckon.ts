/**
 * SKYLOG — dead-reckoning for smooth plane motion between polls.
 *
 * OpenSky returns a snapshot every 10 seconds. Simply snapping a marker
 * from the old position to the new position every 10s looks stuttery.
 * Instead we extrapolate: given last-known (lat, lon, velocity, track),
 * we step the position forward every animation frame using the known
 * ground speed and heading. When the next poll lands we fold that
 * truth in (with a one-frame lerp for stability).
 *
 * The math is a small-angle approximation valid for a few km — which
 * is fine because we never extrapolate more than 30 s (poll + jitter).
 * Full geodetic treatment is in geo.ts.
 */

const EARTH_RADIUS_M = 6_371_008.7714;
const DEG_PER_M_LAT = 360 / (2 * Math.PI * EARTH_RADIUS_M);

export interface TrackSeed {
  /** Latitude at the anchor time, degrees. */
  readonly lat: number;
  /** Longitude at the anchor time, degrees. */
  readonly lon: number;
  /** Ground speed in m/s, or 0 if unknown. */
  readonly speedMps: number;
  /** True track (heading), degrees clockwise from north. 0 if unknown. */
  readonly trackDeg: number;
  /** ms Date.now() when (lat, lon) was observed. */
  readonly anchorAt: number;
}

/**
 * Extrapolate the given seed forward to time `at` (Date.now()) using
 * a flat-earth approximation. Returns [lat, lon].
 *
 * Error magnitude for small Δt:
 *   at 250 m/s (≈ cruise), over 30 s → 7,500 m of travel, well under
 *   the 1° latitude cell (~111 km). Flat-earth error << 1 m.
 */
export function extrapolate(seed: TrackSeed, at: number): [number, number] {
  const dtSec = Math.max(0, (at - seed.anchorAt) / 1000);
  if (dtSec === 0 || seed.speedMps === 0) return [seed.lat, seed.lon];
  const distance = seed.speedMps * dtSec;
  const trackRad = (seed.trackDeg * Math.PI) / 180;
  const dLatM = Math.cos(trackRad) * distance;
  const dLonM = Math.sin(trackRad) * distance;
  const dLat = dLatM * DEG_PER_M_LAT;
  const dLon =
    (dLonM * DEG_PER_M_LAT) /
    Math.max(0.001, Math.cos((seed.lat * Math.PI) / 180));
  return [seed.lat + dLat, seed.lon + dLon];
}

/** Linear interpolation used when merging a fresh poll with an extrapolated estimate. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
