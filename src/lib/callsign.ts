/**
 * SKYLOG — callsign parsing.
 *
 * Commercial airliner callsigns combine a 3-letter ICAO airline designator
 * with a 1–4 digit flight number, e.g. "AAL2317" = American Airlines 2317.
 * OpenSky state vectors return the callsign with right-padded spaces; we
 * trim first.
 *
 * The airline designator table here is a curated subset of the ~850
 * commercial airlines. We ship the top ~140 by fleet size (as of 2024-ish)
 * inline so the bundle stays small. Anything not in the table falls back
 * to "{code} flight {number}".
 *
 * Reference: ICAO Doc 8585 — Designators for Aircraft Operating Agencies.
 */

export interface ParsedCallsign {
  /** Raw callsign, trimmed and uppercased. */
  readonly raw: string;
  /** The 3-letter ICAO airline designator if detected. */
  readonly airlineIcao: string | null;
  /** Full name of airline if known to us. */
  readonly airlineName: string | null;
  /** Flight number (integer, as a string to preserve leading zeros). */
  readonly flightNumber: string | null;
  /** True when we are confident this is a scheduled commercial flight. */
  readonly isCommercial: boolean;
}

/**
 * Curated airline ICAO -> display name.
 * This list is intentionally short: adding ~1000 airlines inline would
 * bloat the bundle and the long tail is rarely seen in any one user's
 * 25 km radius.
 */
const AIRLINES: Record<string, string> = {
  AAL: "American Airlines",
  ACA: "Air Canada",
  AFL: "Aeroflot",
  AFR: "Air France",
  AIC: "Air India",
  ANA: "All Nippon Airways",
  ASA: "Alaska Airlines",
  AZA: "ITA Airways",
  BAW: "British Airways",
  BCS: "European Air Transport",
  BOX: "Aerologic",
  CAL: "China Airlines",
  CCA: "Air China",
  CES: "China Eastern",
  CFG: "Condor",
  CPA: "Cathay Pacific",
  CSN: "China Southern",
  CYP: "Cyprus Airways",
  DAL: "Delta Air Lines",
  DLH: "Lufthansa",
  EIN: "Aer Lingus",
  EJU: "easyJet Europe",
  ELY: "El Al",
  ETD: "Etihad",
  EVA: "EVA Air",
  EZS: "easyJet Switzerland",
  EZY: "easyJet",
  FDX: "FedEx Express",
  FIN: "Finnair",
  FFT: "Frontier",
  GEC: "Lufthansa Cargo",
  GIA: "Garuda Indonesia",
  GLO: "Gol",
  HAL: "Hawaiian Airlines",
  IBE: "Iberia",
  ICE: "Icelandair",
  JAL: "Japan Airlines",
  JBU: "JetBlue",
  JST: "Jetstar",
  KAL: "Korean Air",
  KLM: "KLM",
  LOT: "LOT Polish Airlines",
  LXJ: "Flexjet",
  MAS: "Malaysia Airlines",
  MPH: "Martinair",
  NAX: "Norwegian Air Shuttle",
  NCA: "Nippon Cargo",
  NKS: "Spirit Airlines",
  PAL: "Philippine Airlines",
  QFA: "Qantas",
  QTR: "Qatar Airways",
  RAM: "Royal Air Maroc",
  RPA: "Republic Airways",
  RYR: "Ryanair",
  SAS: "SAS",
  SIA: "Singapore Airlines",
  SKW: "SkyWest",
  SVA: "Saudia",
  SWA: "Southwest",
  SWR: "Swiss",
  TAM: "LATAM Brasil",
  TAP: "TAP Portugal",
  THA: "Thai Airways",
  THY: "Turkish Airlines",
  TOM: "TUI Airways",
  TRA: "Transavia",
  UAE: "Emirates",
  UAL: "United Airlines",
  UPS: "UPS Airlines",
  VIR: "Virgin Atlantic",
  VLG: "Vueling",
  VOZ: "Virgin Australia",
  WJA: "WestJet",
  WZZ: "Wizz Air",
};

const CALLSIGN_RE = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/;

/**
 * Parse an OpenSky callsign into its airline + flight-number components.
 * Non-commercial callsigns (N-numbers, military, private) fall through
 * with isCommercial = false.
 */
export function parseCallsign(raw: string | null | undefined): ParsedCallsign {
  const trimmed = (raw ?? "").trim().toUpperCase();

  if (!trimmed) {
    return {
      raw: "",
      airlineIcao: null,
      airlineName: null,
      flightNumber: null,
      isCommercial: false,
    };
  }

  const m = CALLSIGN_RE.exec(trimmed);
  if (!m) {
    return {
      raw: trimmed,
      airlineIcao: null,
      airlineName: null,
      flightNumber: null,
      isCommercial: false,
    };
  }

  const icao = m[1]!;
  const number = m[2]!;
  const name = AIRLINES[icao] ?? null;

  return {
    raw: trimmed,
    airlineIcao: icao,
    airlineName: name,
    flightNumber: number,
    isCommercial: name != null,
  };
}

/**
 * Human-readable flight label, e.g. "American Airlines 2317" or
 * "AAL2317" if the airline is unknown to us.
 */
export function prettyFlightName(parsed: ParsedCallsign): string {
  if (!parsed.raw) return "Unknown";
  if (parsed.airlineName && parsed.flightNumber) {
    return `${parsed.airlineName} ${parsed.flightNumber}`;
  }
  return parsed.raw;
}


/** Lookup the human-friendly name for an ICAO airline designator,
 *  or null if not in our curated table. */
export function airlineName(icao: string): string | null {
  return AIRLINES[icao.toUpperCase()] ?? null;
}
