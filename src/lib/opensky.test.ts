import { describe, it, expect } from "vitest";
import {
  creditCost,
  decodeStateRow,
  statesUrl,
  accountCall,
  canPollNow,
  dailyCapReached,
  createRateLimitState,
} from "./opensky";

describe("creditCost", () => {
  it("1 credit for small bbox", () => {
    expect(
      creditCost({ lamin: 0, lamax: 1, lomin: 0, lomax: 1 })
    ).toBe(1);
  });
  it("2 credits for mid bbox", () => {
    expect(
      creditCost({ lamin: 0, lamax: 7, lomin: 0, lomax: 7 })
    ).toBe(2);
  });
  it("3 credits for large bbox", () => {
    expect(
      creditCost({ lamin: 0, lamax: 15, lomin: 0, lomax: 15 })
    ).toBe(3);
  });
  it("4 credits for huge bbox", () => {
    expect(
      creditCost({ lamin: 0, lamax: 90, lomin: 0, lomax: 90 })
    ).toBe(4);
  });
});

describe("decodeStateRow", () => {
  it("decodes a typical ADS-B row", () => {
    const row = [
      "abc123",        // icao24
      "AAL2317 ",      // callsign (right-padded)
      "United States", // origin
      1_700_000_000,   // time_position
      1_700_000_005,   // last_contact
      -122.41,         // lon
      37.77,           // lat
      2000,            // baro_altitude (m)
      false,           // on_ground
      240,             // velocity (m/s)
      90,              // true_track
      0,               // vertical_rate
      null,            // sensors
      2100,            // geo_altitude
      "1234",          // squawk
      false,           // spi
      0,               // position_source
      4,               // category: LARGE
    ];
    const sv = decodeStateRow(row);
    expect(sv).not.toBeNull();
    expect(sv!.icao24).toBe("abc123");
    expect(sv!.callsign).toBe("AAL2317");
    expect(sv!.latitude).toBe(37.77);
    expect(sv!.longitude).toBe(-122.41);
    expect(sv!.baroAltitudeM).toBe(2000);
    expect(sv!.category).toBe(4);
  });

  it("returns null when position is missing", () => {
    expect(
      decodeStateRow(["abc123", "X", "Y", 0, 0, null, null, null, false, null, null, null, null, null, null, false, 0, null])
    ).toBeNull();
  });

  it("returns null for short rows", () => {
    expect(decodeStateRow(["abc"])).toBeNull();
  });
});

describe("statesUrl", () => {
  it("produces a parameterized URL", () => {
    const url = statesUrl({ lamin: 37.5, lamax: 37.8, lomin: -122.5, lomax: -122.3 });
    expect(url).toContain("lamin=37.5000");
    expect(url).toContain("lamax=37.8000");
    expect(url).toContain("lomin=-122.5000");
    expect(url).toContain("lomax=-122.3000");
  });
});

describe("rate limit accounting", () => {
  it("canPollNow gates on interval", () => {
    const s = createRateLimitState();
    // Fresh state has lastCallAt = 0; any now >= MIN_POLL_INTERVAL_MS passes.
    const BASE = 1_700_000_000_000;
    expect(canPollNow(s, BASE)).toBe(true);
    const s2 = accountCall(s, { lamin: 0, lamax: 1, lomin: 0, lomax: 1 }, BASE + 1000);
    expect(canPollNow(s2, BASE + 2_000)).toBe(false);
    expect(canPollNow(s2, BASE + 12_000)).toBe(true);
  });

  it("accountCall increments credits", () => {
    const s0 = createRateLimitState();
    const bbox = { lamin: 0, lamax: 1, lomin: 0, lomax: 1 };
    const s1 = accountCall(s0, bbox, Date.now());
    expect(s1.creditsUsedToday).toBe(1);
    const s2 = accountCall(s1, bbox, Date.now());
    expect(s2.creditsUsedToday).toBe(2);
  });

  it("dailyCapReached is true at limit", () => {
    const s = { lastCallAt: 0, creditsUsedToday: 400, dayStartedAt: 0 };
    expect(dailyCapReached(s)).toBe(true);
    expect(dailyCapReached(s, 500)).toBe(false);
  });

  it("resets credits on new day", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const s0 = {
      lastCallAt: yesterday.getTime(),
      creditsUsedToday: 399,
      dayStartedAt: yesterday.getTime(),
    };
    const today = Date.now();
    const s1 = accountCall(s0, { lamin: 0, lamax: 1, lomin: 0, lomax: 1 }, today);
    expect(s1.creditsUsedToday).toBe(1);
  });
});
