import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  boundingBox,
  slantDistanceMeters,
  bearingDegrees,
  isInBBox,
  clamp,
  EARTH_RADIUS_M,
  degToRad,
  radToDeg,
} from "./geo";

// Reference distances calculated using GeographicLib (Karney 2013) — the
// authoritative WGS-84 geodesic library. Haversine on a spherical Earth
// will not match WGS-84 exactly, so we assert tolerances appropriate to
// the kilometer-scale geometry SKYLOG cares about.

describe("degToRad / radToDeg", () => {
  it("round-trips", () => {
    for (const d of [0, 1, 45, 90, 180, -42.5, 359.9]) {
      expect(radToDeg(degToRad(d))).toBeCloseTo(d, 10);
    }
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 37.7749, lon: -122.4194 }, { lat: 37.7749, lon: -122.4194 })).toBe(0);
  });

  it("matches 1° of latitude ≈ 111,195 m", () => {
    // 1 degree of latitude on a sphere = π R / 180
    const expected = (Math.PI * EARTH_RADIUS_M) / 180;
    const got = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(got).toBeCloseTo(expected, 1);
    expect(got).toBeGreaterThan(111_100);
    expect(got).toBeLessThan(111_300);
  });

  it("SFO to LAX great-circle is ~544 km (within 1%)", () => {
    // Reference value: 543.7 km great-circle per GeographicLib for WGS-84.
    // Spherical haversine with the WGS-84 mean radius lands within 0.5 %
    // of this for that pair.
    const sfo = { lat: 37.6213, lon: -122.3790 };
    const lax = { lat: 33.9416, lon: -118.4085 };
    const km = haversineMeters(sfo, lax) / 1000;
    expect(km).toBeGreaterThan(540);
    expect(km).toBeLessThan(548);
  });

  it("is symmetric", () => {
    const a = { lat: 51.5074, lon: -0.1278 }; // London
    const b = { lat: 48.8566, lon: 2.3522 };  // Paris
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("handles antipodal points without NaN", () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 180 };
    const d = haversineMeters(a, b);
    expect(Number.isFinite(d)).toBe(true);
    // Half-circumference ≈ π R
    expect(d).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 0);
  });
});

describe("boundingBox", () => {
  it("produces a symmetric box at the equator", () => {
    const box = boundingBox({ lat: 0, lon: 0 }, 25_000);
    expect(box.lamax).toBeCloseTo(-box.lamin, 6);
    expect(box.lomax).toBeCloseTo(-box.lomin, 6);
    // 25 km corresponds to ~0.2247° at the equator
    expect(box.lamax).toBeGreaterThan(0.22);
    expect(box.lamax).toBeLessThan(0.23);
  });

  it("widens longitudinally at high latitudes", () => {
    const equator = boundingBox({ lat: 0, lon: 0 }, 25_000);
    const arctic = boundingBox({ lat: 70, lon: 0 }, 25_000);
    const equatorLonSpan = equator.lomax - equator.lomin;
    const arcticLonSpan = arctic.lomax - arctic.lomin;
    expect(arcticLonSpan).toBeGreaterThan(equatorLonSpan * 2.5);
  });

  it("clamps at the poles without NaN", () => {
    const box = boundingBox({ lat: 89.9, lon: 0 }, 25_000);
    expect(Number.isFinite(box.lamin)).toBe(true);
    expect(Number.isFinite(box.lamax)).toBe(true);
    expect(box.lamax).toBeLessThanOrEqual(90);
    expect(box.lamin).toBeGreaterThanOrEqual(-90);
  });
});

describe("slantDistanceMeters", () => {
  it("equals altitude when aircraft is directly overhead", () => {
    const home = { lat: 37.77, lon: -122.41 };
    expect(slantDistanceMeters(home, home, 1000)).toBe(1000);
    expect(slantDistanceMeters(home, home, 3048)).toBe(3048);
  });

  it("equals ground range when altitude is 0", () => {
    const home = { lat: 37.77, lon: -122.41 };
    const other = { lat: 37.78, lon: -122.40 };
    const ground = haversineMeters(home, other);
    expect(slantDistanceMeters(home, other, 0)).toBeCloseTo(ground, 6);
  });

  it("is pythagorean of ground and altitude", () => {
    const home = { lat: 0, lon: 0 };
    const other = { lat: 0, lon: 0.01 }; // ~1113 m east
    const ground = haversineMeters(home, other);
    const alt = 2000;
    expect(slantDistanceMeters(home, other, alt)).toBeCloseTo(
      Math.sqrt(ground * ground + alt * alt),
      6
    );
  });

  it("treats negative altitude as zero", () => {
    const home = { lat: 0, lon: 0 };
    const other = { lat: 0, lon: 0.01 };
    expect(slantDistanceMeters(home, other, -500)).toBeCloseTo(
      haversineMeters(home, other),
      6
    );
  });
});

describe("bearingDegrees", () => {
  it("returns 0° for due north", () => {
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 4);
  });

  it("returns 90° for due east", () => {
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 4);
  });

  it("returns 180° for due south", () => {
    expect(bearingDegrees({ lat: 1, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 4);
  });

  it("returns 270° for due west", () => {
    expect(bearingDegrees({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 4);
  });
});

describe("isInBBox", () => {
  const box = { lamin: 10, lomin: 20, lamax: 11, lomax: 21 };
  it("true for interior point", () => {
    expect(isInBBox({ lat: 10.5, lon: 20.5 }, box)).toBe(true);
  });
  it("true on boundary", () => {
    expect(isInBBox({ lat: 10, lon: 20 }, box)).toBe(true);
    expect(isInBBox({ lat: 11, lon: 21 }, box)).toBe(true);
  });
  it("false outside", () => {
    expect(isInBBox({ lat: 9.999, lon: 20.5 }, box)).toBe(false);
    expect(isInBBox({ lat: 11.001, lon: 20.5 }, box)).toBe(false);
    expect(isInBBox({ lat: 10.5, lon: 19.999 }, box)).toBe(false);
    expect(isInBBox({ lat: 10.5, lon: 21.001 }, box)).toBe(false);
  });
});

describe("clamp", () => {
  it("returns x when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps below", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it("clamps above", () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });
  it("returns min on NaN", () => {
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });
});
