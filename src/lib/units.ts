/**
 * SKYLOG — unit conversion. Internally we use strict SI: meters, seconds,
 * meters/second. The render layer converts to imperial only when the user
 * preference demands it.
 */

export type UnitSystem = "metric" | "imperial";

/* ----------------------- length ----------------------- */

/** 1 international foot = 0.3048 meters (BIPM / ICAO). */
export const METERS_PER_FOOT = 0.3048;
/** 1 statute mile = 1609.344 m (US NIST). */
export const METERS_PER_MILE = 1609.344;
/** 1 nautical mile = 1852 m (BIPM 1929). */
export const METERS_PER_NM = 1852;

export function metersToFeet(m: number): number {
  return m / METERS_PER_FOOT;
}
export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}
export function metersToKm(m: number): number {
  return m / 1000;
}
export function metersToNm(m: number): number {
  return m / METERS_PER_NM;
}

/* ----------------------- speed ----------------------- */

/** 1 knot = 0.514444 m/s (exact: 1852/3600). */
export const MPS_PER_KNOT = METERS_PER_NM / 3600;

export function mpsToKnots(mps: number): number {
  return mps / MPS_PER_KNOT;
}
export function mpsToMph(mps: number): number {
  return (mps * 3600) / METERS_PER_MILE;
}
export function mpsToKmh(mps: number): number {
  return mps * 3.6;
}

/* ----------------------- human-readable formatters ----------------------- */

/**
 * Render altitude. Imperial uses feet ("FL350" convention is NOT used —
 * we show the number users see in consumer flight trackers: "35,000 ft").
 */
export function formatAltitude(
  meters: number | null | undefined,
  system: UnitSystem
): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  if (system === "imperial") {
    const ft = Math.round(metersToFeet(meters));
    return `${ft.toLocaleString()} ft`;
  }
  return `${Math.round(meters).toLocaleString()} m`;
}

export function formatDistance(
  meters: number | null | undefined,
  system: UnitSystem
): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  if (system === "imperial") {
    const mi = metersToMiles(meters);
    if (mi < 0.1) return `${Math.round(metersToFeet(meters)).toLocaleString()} ft`;
    return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  const km = metersToKm(meters);
  if (km < 0.5) return `${Math.round(meters).toLocaleString()} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatSpeed(
  mps: number | null | undefined,
  system: UnitSystem
): string {
  if (mps == null || !Number.isFinite(mps)) return "—";
  if (system === "imperial") {
    return `${Math.round(mpsToMph(mps))} mph`;
  }
  return `${Math.round(mpsToKmh(mps))} km/h`;
}

export function formatDb(db: number | null | undefined): string {
  if (db == null || !Number.isFinite(db)) return "—";
  return `${Math.round(db)} dB`;
}

/**
 * Format a Unix-ms timestamp as "H:MM AM/PM" in local time. Tabular-num
 * friendly: always two-digit minutes, no padding for hours.
 */
export function formatClock(tsMs: number): string {
  const d = new Date(tsMs);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function formatClockWithSeconds(tsMs: number): string {
  const d = new Date(tsMs);
  let h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")} ${ampm}`;
}
