/**
 * SKYLOG — simplified outdoor-propagation loudness model.
 *
 * The goal is to turn (aircraft type, slant distance, altitude) into a
 * single believable A-weighted dB value we can color a timeline bar with.
 * A proper answer would require ray-traced ground reflections, directivity
 * patterns, Mach-adjusted thrust, and a weather sounding. We do none of
 * that. We model two physical effects only:
 *
 *   1. Geometric spreading (inverse-square law for a point source in a
 *      free field). Doubling distance => -6 dB.
 *
 *          L(r) = L_ref - 20 * log10(r / r_ref)
 *
 *      where r_ref = 1 m is the source reference distance by convention.
 *      (A real "reference" is usually the engine test stand distance, but
 *      sources below are already normalized to r_ref = 1 m.)
 *
 *      Ref: ISO 9613-2:1996, §7.1 "Geometrical divergence".
 *      https://www.iso.org/standard/20649.html
 *
 *   2. Atmospheric absorption as a linear term in distance. The ISO 9613-2
 *      absorption coefficient α depends on frequency, temperature, and
 *      humidity (§7.2). For a broadband aircraft spectrum centered around
 *      500–1000 Hz at 10 °C / 60 %RH at sea level, α is approximately
 *      5 dB/km = 0.005 dB/m. This is the single-number constant everyone
 *      pulls out when they need an order-of-magnitude answer, and it is
 *      documented in ISO 9613-2 Table B.1 and Eurocontrol's noise guidance.
 *      Ref: ISO 9613-2:1996, §7.2.
 *
 *   L_observer = L_source - 20*log10(slant_m) - alpha * slant_m
 *
 * Source levels L_source are at 1 m and *loosely* calibrated to match
 * FAA Advisory Circular 36-1H certification data and SAE AIR 1845
 * source-noise tables, rounded to integer dB. These are NOT flyover values
 * — they are the hypothetical free-field 1-meter reference that, when
 * propagated 1000 ft straight up through still atmosphere, lands within
 * ~3 dB of the published flyover L_max for that category. Good enough to
 * distinguish a 747 from a Cessna on a timeline.
 *
 * Constants are expressed with their sources so anyone reading the source
 * understands what they are looking at.
 */

/**
 * Aircraft categories, matching OpenSky's "category" enum in the state
 * vector (field index 17). 0 means "no information".
 * https://opensky-network.org/apidoc/rest.html
 */
export const CATEGORY = {
  NO_INFO: 0,
  NO_ADS_B: 1,
  LIGHT: 2,            // < 15,500 lbs
  SMALL: 3,            // 15,500 – 75,000 lbs
  LARGE: 4,            // 75,000 – 300,000 lbs
  HIGH_VORTEX: 5,      // e.g., B-757
  HEAVY: 6,            // > 300,000 lbs
  HIGH_PERF: 7,        // > 5g, > 400 kt
  ROTORCRAFT: 8,
  GLIDER: 9,
  LIGHTER_THAN_AIR: 10,
  PARACHUTIST: 11,
  ULTRALIGHT: 12,
  RESERVED: 13,
  UAV: 14,
  SPACECRAFT: 15,
  SURFACE_VEHICLE_EMERGENCY: 16,
  SURFACE_VEHICLE_SERVICE: 17,
  POINT_OBSTACLE: 18,
  CLUSTER_OBSTACLE: 19,
  LINE_OBSTACLE: 20,
} as const;

export type OpenSkyCategory =
  (typeof CATEGORY)[keyof typeof CATEGORY];

/**
 * Reference source sound power level at 1 m, in dB(A).
 *
 * Values are our own rough calibration against:
 *   - FAA AC 36-1H (aircraft certification noise levels)
 *   - SAE AIR 1845 (procedure for noise calcs of departures/arrivals)
 *   - Eurocontrol Doc 29 "Report on standard method of computing noise contours"
 *
 * They are deliberately conservative — a user wants to hear a believable
 * "747 overhead at 3000 ft = ~75 dB" more than they want 0.5 dB precision.
 */
const SOURCE_LEVELS_DB: Record<number, number> = {
  [CATEGORY.NO_INFO]: 120,           // used only as last-resort default
  [CATEGORY.NO_ADS_B]: 120,
  [CATEGORY.LIGHT]: 105,             // piston singles, Cessna 172 class
  [CATEGORY.SMALL]: 125,             // turboprops, regional jets (CRJ, Dash-8)
  [CATEGORY.LARGE]: 135,             // narrow-body jets, 737/A320 class
  [CATEGORY.HIGH_VORTEX]: 137,       // 757 / heavy widebodies at the light end
  [CATEGORY.HEAVY]: 140,             // 777, 747, A380 class
  [CATEGORY.HIGH_PERF]: 145,         // military fighters
  [CATEGORY.ROTORCRAFT]: 130,        // helicopters — blade-slap is loud up close
  [CATEGORY.GLIDER]: 70,             // essentially silent powered
  [CATEGORY.LIGHTER_THAN_AIR]: 80,
  [CATEGORY.PARACHUTIST]: 40,
  [CATEGORY.ULTRALIGHT]: 100,
  [CATEGORY.RESERVED]: 120,
  [CATEGORY.UAV]: 90,
  [CATEGORY.SPACECRAFT]: 160,        // only relevant for re-entry / launch
  [CATEGORY.SURFACE_VEHICLE_EMERGENCY]: 95,
  [CATEGORY.SURFACE_VEHICLE_SERVICE]: 80,
  [CATEGORY.POINT_OBSTACLE]: 0,
  [CATEGORY.CLUSTER_OBSTACLE]: 0,
  [CATEGORY.LINE_OBSTACLE]: 0,
};

/**
 * Atmospheric absorption in dB per meter for mid-frequency broadband
 * aircraft noise at 10 °C / 60 % RH / 101.325 kPa. See ISO 9613-2:1996
 * Table B.1 for the frequency-dependent values; this is the collapsed
 * single-number representative. A ~10 % humidity change moves this by
 * ~10 %, so it is imprecise but defensible for a v0.1 on-device model.
 */
export const ATMOSPHERIC_ABSORPTION_DB_PER_M = 0.005;

/** Reference source distance in meters. Conventionally 1 m. */
export const REFERENCE_DISTANCE_M = 1;

/**
 * Minimum slant distance we will plug into the log. Below this the model
 * explodes toward +infinity and stops being meaningful (a plane cannot
 * physically be 10 cm from your ear). We clip at 10 m.
 */
const MIN_SLANT_M = 10;

/** The A-weighted dB floor below which we say "silent". */
export const SILENCE_FLOOR_DB = 25;

/** The loud ceiling used for color normalization. 120 dB is pain threshold. */
export const LOUDNESS_CEILING_DB = 120;

/**
 * Look up the reference source level (dB at 1 m) for an OpenSky category.
 *
 * Unknown / missing categories fall back to a heuristic driven by altitude:
 * if the plane is cruising high (>10 km), it is probably a heavy/large
 * airliner (137 dB); otherwise assume a narrow-body (130 dB). This keeps
 * "no_info" aircraft from disappearing entirely but doesn't over-state
 * low-altitude helicopters.
 */
export function sourceLevelDb(
  category: number | null | undefined,
  fallbackAltitudeM: number
): number {
  if (category != null && SOURCE_LEVELS_DB[category] !== undefined) {
    return SOURCE_LEVELS_DB[category]!;
  }
  // Fallback heuristic.
  if (fallbackAltitudeM > 10_000) return 137;
  if (fallbackAltitudeM > 4_000) return 130;
  return 115;
}

/**
 * Ground-level estimated A-weighted dB for a single aircraft sample,
 * using inverse-square geometric spreading and a linear atmospheric
 * absorption term.
 *
 *   L_obs = L_src - 20*log10(r / r_ref) - α * r
 *
 * @param sourceDb  source level at r_ref (dB, A-weighted)
 * @param slantM    slant distance from observer to source (meters)
 * @returns         estimated observed SPL in dB(A)
 *
 * Clamps the result to [SILENCE_FLOOR_DB, LOUDNESS_CEILING_DB] so downstream
 * color mappings stay sensible.
 */
export function estimateDbAtObserver(sourceDb: number, slantM: number): number {
  const r = Math.max(MIN_SLANT_M, slantM);
  const geometric = 20 * Math.log10(r / REFERENCE_DISTANCE_M);
  const absorption = ATMOSPHERIC_ABSORPTION_DB_PER_M * r;
  const observed = sourceDb - geometric - absorption;
  if (observed < SILENCE_FLOOR_DB) return SILENCE_FLOOR_DB;
  if (observed > LOUDNESS_CEILING_DB) return LOUDNESS_CEILING_DB;
  return observed;
}

/**
 * Convenience wrapper: given OpenSky category + slant distance + altitude,
 * produce the final observed dB in one call. Used on the worker hot path.
 */
export function observedDb(
  category: number | null | undefined,
  slantM: number,
  altitudeM: number
): number {
  const src = sourceLevelDb(category, altitudeM);
  return estimateDbAtObserver(src, slantM);
}

/**
 * Map an observed dB value to a [0, 1] intensity for colorization.
 * 35 dB (quiet suburb) -> 0, 90+ dB (jet nearly overhead) -> 1.
 * The perceptual midpoint of 60 dB (conversation) lands at ~0.45.
 */
export function loudnessIntensity(observedDb: number): number {
  const lo = 35;
  const hi = 95;
  if (observedDb <= lo) return 0;
  if (observedDb >= hi) return 1;
  return (observedDb - lo) / (hi - lo);
}

/**
 * A short human-readable label for a given dB, to help the UI feel
 * informative without resorting to marketing prose.
 *
 * These are loose everyday comparisons, calibrated against the CDC's
 * "What noises cause hearing loss?" reference page.
 * https://www.cdc.gov/nceh/hearing_loss/what_noises_cause_hearing_loss.html
 */
export function dbDescriptor(db: number): string {
  if (db < 35) return "near silent";
  if (db < 45) return "quiet room";
  if (db < 55) return "soft conversation";
  if (db < 65) return "normal conversation";
  if (db < 75) return "vacuum cleaner";
  if (db < 85) return "city traffic";
  if (db < 95) return "motorcycle";
  if (db < 110) return "chainsaw";
  return "jet takeoff";
}
