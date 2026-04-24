import { describe, it, expect } from "vitest";
import {
  metersToFeet,
  metersToMiles,
  metersToNm,
  mpsToKnots,
  mpsToMph,
  mpsToKmh,
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatDb,
  formatClock,
} from "./units";

describe("metric <-> imperial conversions", () => {
  it("m to ft (3.28084)", () => {
    expect(metersToFeet(1000)).toBeCloseTo(3280.84, 1);
  });
  it("m to miles (0.000621371)", () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 6);
  });
  it("m to nm (0.000539957)", () => {
    expect(metersToNm(1852)).toBeCloseTo(1, 6);
  });
  it("mps to knots (1 m/s = 1.944 kt)", () => {
    expect(mpsToKnots(1)).toBeCloseTo(1.94384, 3);
  });
  it("mps to mph (1 m/s = 2.23694 mph)", () => {
    expect(mpsToMph(1)).toBeCloseTo(2.23694, 3);
  });
  it("mps to km/h (x3.6)", () => {
    expect(mpsToKmh(10)).toBeCloseTo(36, 6);
  });
});

describe("formatters", () => {
  it("formatAltitude metric/imperial", () => {
    expect(formatAltitude(1000, "metric")).toBe("1,000 m");
    expect(formatAltitude(914, "imperial")).toBe("2,999 ft");
    expect(formatAltitude(null, "metric")).toBe("—");
    expect(formatAltitude(undefined, "imperial")).toBe("—");
  });

  it("formatDistance uses km over meters above 500 m metric", () => {
    expect(formatDistance(300, "metric")).toBe("300 m");
    expect(formatDistance(2500, "metric")).toBe("2.5 km");
  });

  it("formatDistance uses ft below 0.1 mi imperial", () => {
    expect(formatDistance(100, "imperial")).toMatch(/ft$/);
    expect(formatDistance(5000, "imperial")).toMatch(/mi$/);
  });

  it("formatSpeed", () => {
    expect(formatSpeed(100, "imperial")).toMatch(/mph$/);
    expect(formatSpeed(100, "metric")).toMatch(/km\/h$/);
    expect(formatSpeed(null, "metric")).toBe("—");
  });

  it("formatDb", () => {
    expect(formatDb(72.3)).toBe("72 dB");
    expect(formatDb(null)).toBe("—");
  });

  it("formatClock renders 12-hour with padding", () => {
    // Use a known timestamp in local tz.
    const noon = new Date();
    noon.setHours(12, 5, 0, 0);
    expect(formatClock(noon.getTime())).toBe("12:05 PM");

    const am = new Date();
    am.setHours(3, 7, 0, 0);
    expect(formatClock(am.getTime())).toBe("3:07 AM");

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    expect(formatClock(midnight.getTime())).toBe("12:00 AM");
  });
});
