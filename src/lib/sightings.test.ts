import { describe, expect, it } from "vitest";
import { mergeOne } from "./sightings";
import type { StateVector } from "./opensky";
import type { AircraftSighting } from "./db";

const baseState = (over: Partial<StateVector> = {}): StateVector => ({
  icao24: "a1b2c3",
  callsign: "UAL841",
  originCountry: "United States",
  timePosition: null,
  lastContact: 0,
  longitude: -100,
  latitude: 40,
  baroAltitudeM: 10_000,
  onGround: false,
  velocityMps: 250,
  trackDeg: 90,
  verticalRateMps: 0,
  geoAltitudeM: 10_100,
  squawk: null,
  spi: false,
  positionSource: 0,
  category: 5,
  ...over,
});

describe("mergeOne", () => {
  it("creates a new record for a first-time visitor", () => {
    const now = Date.UTC(2026, 3, 24, 10, 0, 0);
    const out = mergeOne(undefined, baseState(), now);
    expect(out.icao24).toBe("a1b2c3");
    expect(out.sightingCount).toBe(1);
    expect(out.firstSeenAt).toBe(now);
    expect(out.lastSeenAt).toBe(now);
    expect(out.dayCount).toBe(1);
    expect(out.recentDays).toBe("2026-04-24");
    expect(out.callsigns).toEqual(["UAL841"]);
    expect(out.minAltitudeM).toBe(10_000);
    expect(out.maxAltitudeM).toBe(10_000);
  });

  it("increments visit count on repeat sightings same day", () => {
    const t1 = Date.UTC(2026, 3, 24, 10, 0, 0);
    const t2 = Date.UTC(2026, 3, 24, 11, 0, 0);
    const first = mergeOne(undefined, baseState(), t1);
    const second = mergeOne(first, baseState({ baroAltitudeM: 12_000 }), t2);
    expect(second.sightingCount).toBe(2);
    expect(second.firstSeenAt).toBe(t1);
    expect(second.lastSeenAt).toBe(t2);
    expect(second.dayCount).toBe(1);
    expect(second.maxAltitudeM).toBe(12_000);
    expect(second.minAltitudeM).toBe(10_000);
  });

  it("adds distinct UTC days to recentDays", () => {
    const d1 = Date.UTC(2026, 3, 24, 10, 0, 0);
    const d2 = Date.UTC(2026, 3, 25, 10, 0, 0);
    const first = mergeOne(undefined, baseState(), d1);
    const second = mergeOne(first, baseState(), d2);
    expect(second.dayCount).toBe(2);
    expect(second.recentDays.startsWith("2026-04-25,2026-04-24")).toBe(true);
  });

  it("accumulates distinct callsigns up to the cap", () => {
    const t = 1_700_000_000_000;
    let rec: AircraftSighting | undefined = undefined;
    for (let i = 0; i < 15; i++) {
      rec = mergeOne(rec, baseState({ callsign: `AAL${i}` }), t + i * 1000);
    }
    expect(rec!.callsigns.length).toBe(12); // MAX_CALLSIGNS
    expect(rec!.callsigns[0]).toBe("AAL14"); // most recent first
  });

  it("keeps the latest registration/type/operator when provided", () => {
    const t = 1_700_000_000_000;
    const first = mergeOne(
      undefined,
      baseState({ _registration: "N123AB", _typeCode: "B738" }),
      t
    );
    const second = mergeOne(
      first,
      baseState({ _operator: "United Airlines" }),
      t + 1000
    );
    expect(second.registration).toBe("N123AB"); // carried forward
    expect(second.typecode).toBe("B738");
    expect(second.operator).toBe("United Airlines");
  });

  it("records altitude min/max across sightings", () => {
    const t = 1_700_000_000_000;
    const a = mergeOne(undefined, baseState({ baroAltitudeM: 5_000 }), t);
    const b = mergeOne(a, baseState({ baroAltitudeM: 11_000 }), t + 1000);
    const c = mergeOne(b, baseState({ baroAltitudeM: 2_000 }), t + 2000);
    expect(c.minAltitudeM).toBe(2_000);
    expect(c.maxAltitudeM).toBe(11_000);
  });

  it("caps recentDays at 30 entries", () => {
    let rec: AircraftSighting | undefined = undefined;
    for (let d = 0; d < 40; d++) {
      const t = Date.UTC(2026, 0, 1) + d * 24 * 60 * 60 * 1000;
      rec = mergeOne(rec, baseState(), t);
    }
    expect(rec!.recentDays.split(",").length).toBe(30);
  });
});

import { dominantPattern, decodeRecentTimes, prettyPattern } from "./sightings";

describe("dominantPattern", () => {
  it("returns null for <3 sightings", () => {
    expect(dominantPattern([])).toBeNull();
    expect(dominantPattern([Date.now()])).toBeNull();
    expect(dominantPattern([Date.now(), Date.now() - 1000])).toBeNull();
  });

  it("detects a weekly pattern (same weekday+hour, 3+ weeks)", () => {
    // Three Tuesdays at 7 AM local
    const d1 = new Date(2026, 3, 7, 7, 15).getTime();  // Tue
    const d2 = new Date(2026, 3, 14, 7, 20).getTime(); // Tue
    const d3 = new Date(2026, 3, 21, 7, 5).getTime();  // Tue
    const p = dominantPattern([d1, d2, d3]);
    expect(p).not.toBeNull();
    expect(p!.hour).toBe(7);
    // Tue = 2
    expect(p!.weekday).toBe(2);
    expect(p!.count).toBe(3);
  });

  it("picks the most-common bucket when multiple exist", () => {
    // Two Mondays at 9am, one Tuesday at 3pm, one random
    const times = [
      new Date(2026, 3, 6, 9, 0).getTime(),   // Mon 9
      new Date(2026, 3, 13, 9, 15).getTime(), // Mon 9
      new Date(2026, 3, 20, 9, 5).getTime(),  // Mon 9
      new Date(2026, 3, 7, 15, 0).getTime(),  // Tue 15
    ];
    const p = dominantPattern(times);
    expect(p!.hour).toBe(9);
    expect(p!.weekday).toBe(1); // Mon
    expect(p!.count).toBe(3);
  });

  it("returns null when nothing clusters ≥3", () => {
    const times = [
      new Date(2026, 3, 6, 9, 0).getTime(),
      new Date(2026, 3, 13, 10, 0).getTime(),
      new Date(2026, 3, 20, 11, 0).getTime(),
    ];
    expect(dominantPattern(times)).toBeNull();
  });
});

describe("decodeRecentTimes", () => {
  it("round-trips a simple CSV", () => {
    expect(decodeRecentTimes("1,2,3")).toEqual([1, 2, 3]);
  });
  it("returns empty for empty input", () => {
    expect(decodeRecentTimes("")).toEqual([]);
  });
  it("drops non-numeric entries", () => {
    expect(decodeRecentTimes("1,foo,3")).toEqual([1, 3]);
  });
});

describe("prettyPattern", () => {
  it("formats weekday + hour nicely", () => {
    expect(prettyPattern({ weekday: 2, hour: 7, count: 4 })).toBe(
      "Tuesdays around 07:00"
    );
    expect(prettyPattern({ weekday: 0, hour: 22, count: 3 })).toBe(
      "Sundays around 22:00"
    );
  });
});
