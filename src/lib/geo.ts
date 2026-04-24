/**
 * SKYLOG — geo primitives.
 *
 * All functions work in SI units: coordinates in decimal degrees (WGS-84),
 * distances in meters, altitudes in meters above mean sea level.
 *
 * References:
 *   - Haversine formula: Sinnott, R.W. (1984), "Virtues of the Haversine",
 *     Sky and Telescope, vol. 68, no. 2, p. 159.
 *   - WGS-84 mean radius: https://en.wikipedia.org/wiki/Earth_radius#Arithmetic_mean_radius
 *   - Slant distance: classic Pythagorean triangle between ground range and altitude.
 */

/**
 * WGS-84 arithmetic mean radius (R1). Good enough for overhead-plane
 * geometry where we care about distances up to ~100 km. At that scale the
 * haversine error with mean-radius is well under a meter.
 *
 * Source: IUGG 1980 parameters; 6,371,008.7714 m.
 * https://en.wikipedia.org/wiki/Earth_radius
 */
export const EARTH_RADIUS_M = 6_371_008.7714;

/** A geographic coordinate, in decimal degrees. */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Axis-aligned geographic bounding box, [minLat, minLon, maxLat, maxLon]. */
export interface BBox {
  readonly lamin: number;
  readonly lomin: number;
  readonly lamax: number;
  readonly lomax: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Convert degrees to radians. */
export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** Convert radians to degrees. */
export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

/**
 * Great-circle distance, in meters, between two WGS-84 points using the
 * haversine formula.
 *
 * Numerically stable for antipodal points (which we will never encounter
 * in a 50 km overhead cone, but the stability is free).
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const dLat = lat2 - lat1;
  const dLon = degToRad(b.lon - a.lon);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  // 2 * asin(sqrt(h)) is equivalent to 2 * atan2(sqrt(h), sqrt(1-h))
  // and slightly more numerically stable near h ~ 1.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Axis-aligned bounding box of radius R around a center point, expressed
 * in decimal degrees. Lon delta widens near the poles — the cosine-latitude
 * expansion is the standard correction. We clamp at the ±180° anti-meridian
 * and at the poles so callers always see a valid OpenSky-compatible bbox.
 *
 * OpenSky wants a box bounded to a reasonable size (area ceiling for anon).
 * A 25 km radius → ~0.45° per side at temperate latitudes, which is well
 * within OpenSky's anon bbox policy. Source: OpenSky REST API docs,
 * https://opensky-network.org/apidoc/rest.html
 */
export function boundingBox(center: LatLon, radiusMeters: number): BBox {
  const latDelta = radToDeg(radiusMeters / EARTH_RADIUS_M);

  // At the poles, cos(lat) -> 0, so lon delta blows up. Clamp to a very
  // small denominator so we produce a full-longitude band (useful is
  // debatable at the pole, but at least correct).
  const cosLat = Math.max(Math.cos(degToRad(center.lat)), 1e-6);
  const lonDelta = radToDeg(radiusMeters / (EARTH_RADIUS_M * cosLat));

  return {
    lamin: clamp(center.lat - latDelta, -90, 90),
    lamax: clamp(center.lat + latDelta, -90, 90),
    // We do not handle anti-meridian crossing: we clamp. OpenSky's API does
    // not accept a wrapped box, and for users within ~1000 km of the
    // dateline this degrades gracefully (slightly truncated bbox).
    lomin: clamp(center.lon - lonDelta, -180, 180),
    lomax: clamp(center.lon + lonDelta, -180, 180),
  };
}

/**
 * 3D slant distance, in meters, from a ground observer at altitude 0 to an
 * aircraft at a given geographic position and barometric altitude.
 *
 * We treat ground range as a straight chord (via haversine) and altitude
 * as perpendicular. For overhead-plane physics this is accurate enough:
 * the Earth's curvature contributes ~1 m of error over 25 km at typical
 * flight altitudes, which is well below the acoustic model's noise floor.
 */
export function slantDistanceMeters(
  observer: LatLon,
  aircraftPos: LatLon,
  aircraftAltitudeM: number
): number {
  const groundRange = haversineMeters(observer, aircraftPos);
  return Math.hypot(groundRange, Math.max(0, aircraftAltitudeM));
}

/**
 * Initial bearing (forward azimuth), in degrees clockwise from true north,
 * from point A to point B. Useful for rendering the flight-path arrow in
 * the detail panel.
 */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const dLon = degToRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const brng = radToDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/**
 * Clamp a number to [min, max]. Does the sensible thing with NaN
 * (returns min).
 */
export function clamp(x: number, min: number, max: number): number {
  if (Number.isNaN(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

/**
 * Quick rejection: is an aircraft position within the given bbox?
 * Used on the hot path inside the worker before we bother computing
 * slant distance.
 */
export function isInBBox(p: LatLon, box: BBox): boolean {
  return (
    p.lat >= box.lamin &&
    p.lat <= box.lamax &&
    p.lon >= box.lomin &&
    p.lon <= box.lomax
  );
}
