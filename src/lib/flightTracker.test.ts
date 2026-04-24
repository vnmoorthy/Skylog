import { describe, expect, it } from "vitest";
import { normaliseCallsign } from "./flightTracker";

describe("normaliseCallsign", () => {
  it("strips whitespace and uppercases", () => {
    expect(normaliseCallsign("  ual841  ")).toBe("UAL841");
    expect(normaliseCallsign("ba 286")).toBe("BA286");
  });
  it("is idempotent", () => {
    expect(normaliseCallsign(normaliseCallsign("UAL841"))).toBe("UAL841");
  });
  it("handles mixed case", () => {
    expect(normaliseCallsign("BaW286")).toBe("BAW286");
  });
});
