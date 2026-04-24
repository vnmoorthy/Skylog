import { describe, it, expect } from "vitest";
import { parseCallsign, prettyFlightName } from "./callsign";

describe("parseCallsign", () => {
  it("trims whitespace from OpenSky-padded callsigns", () => {
    const p = parseCallsign("AAL2317 ");
    expect(p.raw).toBe("AAL2317");
  });

  it("resolves airline from curated table", () => {
    const p = parseCallsign("UAL825");
    expect(p.airlineIcao).toBe("UAL");
    expect(p.airlineName).toBe("United Airlines");
    expect(p.flightNumber).toBe("825");
    expect(p.isCommercial).toBe(true);
  });

  it("returns non-commercial for unknown designator", () => {
    const p = parseCallsign("ZZZ123");
    expect(p.airlineIcao).toBe("ZZZ");
    expect(p.airlineName).toBeNull();
    expect(p.isCommercial).toBe(false);
  });

  it("returns non-commercial for N-numbers and private callsigns", () => {
    for (const s of ["N738XP", "PRIVATE1", "RCH337", ""]) {
      const p = parseCallsign(s);
      expect(p.isCommercial).toBe(false);
    }
  });

  it("handles null / undefined", () => {
    expect(parseCallsign(null).raw).toBe("");
    expect(parseCallsign(undefined).raw).toBe("");
  });
});

describe("prettyFlightName", () => {
  it("combines known airline with number", () => {
    expect(prettyFlightName(parseCallsign("DAL1121"))).toBe("Delta Air Lines 1121");
  });
  it("falls back to raw for unknown", () => {
    expect(prettyFlightName(parseCallsign("N12345"))).toBe("N12345");
  });
  it("returns Unknown on empty input", () => {
    expect(prettyFlightName(parseCallsign(""))).toBe("Unknown");
  });
});
