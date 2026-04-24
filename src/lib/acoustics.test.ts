import { describe, it, expect } from "vitest";
import {
  CATEGORY,
  sourceLevelDb,
  estimateDbAtObserver,
  observedDb,
  loudnessIntensity,
  dbDescriptor,
  ATMOSPHERIC_ABSORPTION_DB_PER_M,
  REFERENCE_DISTANCE_M,
  SILENCE_FLOOR_DB,
  LOUDNESS_CEILING_DB,
} from "./acoustics";

describe("sourceLevelDb", () => {
  it("returns the table value for known categories", () => {
    expect(sourceLevelDb(CATEGORY.HEAVY, 11000)).toBe(140);
    expect(sourceLevelDb(CATEGORY.LIGHT, 600)).toBe(105);
    expect(sourceLevelDb(CATEGORY.ROTORCRAFT, 400)).toBe(130);
  });

  it("falls back based on altitude for unknown categories", () => {
    expect(sourceLevelDb(null, 12_000)).toBe(137);  // cruising -> heavy
    expect(sourceLevelDb(null, 5_000)).toBe(130);   // mid -> narrow-body
    expect(sourceLevelDb(null, 500)).toBe(115);     // low -> small
  });

  it("treats undefined as null (fallback)", () => {
    expect(sourceLevelDb(undefined, 12_000)).toBe(137);
  });

  it("falls back for wildly-out-of-range category values", () => {
    // 999 is unknown -> altitude heuristic: 5 km is in the narrow-body bucket.
    expect(sourceLevelDb(999, 5_000)).toBe(130);
  });
});

describe("estimateDbAtObserver — inverse-square law", () => {
  it("drops approximately 6 dB per doubling of distance at short ranges", () => {
    // At 50 m→100 m→200 m, the inverse-square term contributes exactly
    // 20*log10(2) ≈ 6.02 dB per doubling. Atmospheric absorption adds a
    // small linear term (0.005 dB/m * delta-r), so the observed drop is
    // slightly greater than 6 dB. Use a looser tolerance to accommodate.
    const d1 = estimateDbAtObserver(140, 50);
    const d2 = estimateDbAtObserver(140, 100);
    const d3 = estimateDbAtObserver(140, 200);
    expect(d1 - d2).toBeGreaterThan(6);
    expect(d1 - d2).toBeLessThan(7);
    expect(d2 - d3).toBeGreaterThan(6);
    expect(d2 - d3).toBeLessThan(7.5);
  });

  it("reduces to the source level at r = r_ref", () => {
    // At r = REFERENCE_DISTANCE_M we have 20*log10(1) = 0 and absorption ~ 0.
    // But we clip r to MIN_SLANT_M = 10 to avoid absurdity.
    expect(estimateDbAtObserver(140, REFERENCE_DISTANCE_M)).toBeLessThanOrEqual(140);
  });

  it("clamps to SILENCE_FLOOR_DB at infinite distance", () => {
    expect(estimateDbAtObserver(140, 1_000_000)).toBe(SILENCE_FLOOR_DB);
  });

  it("clamps to LOUDNESS_CEILING_DB for very short distances", () => {
    // With sourceDb = 180 and r = 1m, you'd exceed 160 dB. Clip.
    expect(estimateDbAtObserver(180, 1)).toBe(LOUDNESS_CEILING_DB);
  });

  it("includes atmospheric absorption", () => {
    // At 2 km, absorption contributes α * 2000 = 10 dB on top of the
    // inverse-square loss (no floor clamp at this range).
    const r = 2_000;
    const withAbs = estimateDbAtObserver(140, r);
    const withoutAbs = 140 - 20 * Math.log10(r);
    expect(withoutAbs - withAbs).toBeCloseTo(
      ATMOSPHERIC_ABSORPTION_DB_PER_M * r,
      1
    );
  });
});

describe("observedDb — physically plausible worked examples", () => {
  it("737 (LARGE) at 3000 ft directly overhead is ~60-80 dB", () => {
    // 3000 ft ≈ 914 m. Slant ≈ altitude when directly overhead.
    const db = observedDb(CATEGORY.LARGE, 914, 914);
    expect(db).toBeGreaterThan(60);
    expect(db).toBeLessThan(80);
  });

  it("747 (HEAVY) at 3000 ft is noticeably louder than a Cessna at 3000 ft", () => {
    const heavy = observedDb(CATEGORY.HEAVY, 914, 914);
    const light = observedDb(CATEGORY.LIGHT, 914, 914);
    expect(heavy - light).toBeGreaterThan(30);
  });

  it("airliner at cruise (35000 ft) is effectively inaudible", () => {
    // 35,000 ft ≈ 10,668 m. Atmospheric absorption alone eats ~50 dB.
    const db = observedDb(CATEGORY.HEAVY, 10_668, 10_668);
    expect(db).toBeLessThan(40);
  });

  it("helicopter at 500 ft low-hover is loud (>80 dB)", () => {
    // 500 ft ≈ 152 m overhead.
    const db = observedDb(CATEGORY.ROTORCRAFT, 152, 152);
    expect(db).toBeGreaterThan(80);
  });

  it("is monotonically non-increasing in slant distance (same category)", () => {
    let prev = Number.POSITIVE_INFINITY;
    // Capped at 10 km to avoid running into the silence floor clamp where
    // successive values tie at SILENCE_FLOOR_DB.
    for (const r of [100, 500, 1000, 2500, 5000, 8000]) {
      const db = observedDb(CATEGORY.HEAVY, r, r);
      expect(db).toBeLessThan(prev);
      prev = db;
    }
  });
});

describe("loudnessIntensity", () => {
  it("returns 0 at the silence floor", () => {
    expect(loudnessIntensity(30)).toBe(0);
  });
  it("returns 1 at the ceiling", () => {
    expect(loudnessIntensity(100)).toBe(1);
  });
  it("returns ~0.5 near conversational loudness", () => {
    const v = loudnessIntensity(65);
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(0.6);
  });
  it("is monotonic", () => {
    let prev = -1;
    for (let db = 30; db <= 100; db += 5) {
      const v = loudnessIntensity(db);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("dbDescriptor", () => {
  it("buckets sensibly", () => {
    expect(dbDescriptor(20)).toBe("near silent");
    expect(dbDescriptor(40)).toBe("quiet room");
    expect(dbDescriptor(60)).toBe("normal conversation");
    expect(dbDescriptor(72)).toBe("vacuum cleaner");
    expect(dbDescriptor(115)).toBe("jet takeoff");
  });
});
