import { describe, expect, it } from "vitest";
import { extrapolate, lerp } from "./deadReckon";

describe("extrapolate", () => {
  it("returns anchor position when dt = 0", () => {
    const [la, lo] = extrapolate(
      { lat: 40, lon: -74, speedMps: 250, trackDeg: 90, anchorAt: 1_000 },
      1_000
    );
    expect(la).toBeCloseTo(40, 8);
    expect(lo).toBeCloseTo(-74, 8);
  });

  it("returns anchor position when speed = 0", () => {
    const [la, lo] = extrapolate(
      { lat: 40, lon: -74, speedMps: 0, trackDeg: 0, anchorAt: 1_000 },
      10_000
    );
    expect(la).toBeCloseTo(40, 8);
    expect(lo).toBeCloseTo(-74, 8);
  });

  it("moves north for track=0", () => {
    // 250 m/s * 10 s = 2,500 m north → ~0.0225° of latitude.
    const [la, lo] = extrapolate(
      { lat: 40, lon: -74, speedMps: 250, trackDeg: 0, anchorAt: 0 },
      10_000
    );
    expect(la).toBeGreaterThan(40);
    expect(la - 40).toBeGreaterThan(0.02);
    expect(la - 40).toBeLessThan(0.03);
    expect(lo).toBeCloseTo(-74, 4);
  });

  it("moves east for track=90 with longitude scaled by cos(lat)", () => {
    // At 60°N, 1° lon is ~55 km (cos(60) = 0.5 * 111 km).
    // 250 m/s * 10 s = 2,500 m → ~0.045° of longitude.
    const [la, lo] = extrapolate(
      { lat: 60, lon: 10, speedMps: 250, trackDeg: 90, anchorAt: 0 },
      10_000
    );
    expect(la).toBeCloseTo(60, 4);
    expect(lo - 10).toBeGreaterThan(0.04);
    expect(lo - 10).toBeLessThan(0.05);
  });

  it("moves south for track=180", () => {
    const [la] = extrapolate(
      { lat: 40, lon: -74, speedMps: 250, trackDeg: 180, anchorAt: 0 },
      10_000
    );
    expect(la).toBeLessThan(40);
  });

  it("moves west for track=270", () => {
    const [, lo] = extrapolate(
      { lat: 40, lon: -74, speedMps: 250, trackDeg: 270, anchorAt: 0 },
      10_000
    );
    expect(lo).toBeLessThan(-74);
  });
});

describe("lerp", () => {
  it("returns a at t=0 and b at t=1", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });
  it("interpolates linearly", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(-5, 5, 0.25)).toBe(-2.5);
  });
});
