/**
 * Tests for Reynolds-number classification.
 *
 * The regime boundaries are the sim's central claim, so they are pinned exactly
 * — including which side of each threshold belongs to which regime.
 */

import { describe, expect, it } from "vitest";
import { classifyFlowRegime, computeReynoldsNumber, FLOW_REGIMES } from "../src/common/model/FlowRegime.js";
import { RE_SEPARATION, RE_SHEDDING_ONSET, RE_TURBULENT_ONSET } from "../src/FluidDynamicsConstants.js";

describe("computeReynoldsNumber", () => {
  it("computes Re = U·D/ν", () => {
    expect(computeReynoldsNumber(1, 0.15, 1e-3)).toBeCloseTo(150, 10);
    expect(computeReynoldsNumber(2, 0.15, 1e-3)).toBeCloseTo(300, 10);
    expect(computeReynoldsNumber(1, 0.3, 1e-3)).toBeCloseTo(300, 10);
  });

  it("is zero for a stationary fluid", () => {
    expect(computeReynoldsNumber(0, 0.15, 1e-3)).toBe(0);
  });

  it("is infinite for an inviscid fluid, which classifies as turbulent", () => {
    const re = computeReynoldsNumber(1, 0.15, 0);
    expect(re).toBe(Number.POSITIVE_INFINITY);
    expect(classifyFlowRegime(re)).toBe("turbulent");
  });
});

describe("classifyFlowRegime", () => {
  it("orders the regimes by increasing Reynolds number", () => {
    expect(FLOW_REGIMES).toEqual(["creeping", "steadyWake", "vortexShedding", "turbulent"]);
  });

  it("classifies well inside each regime", () => {
    expect(classifyFlowRegime(0.5)).toBe("creeping");
    expect(classifyFlowRegime(20)).toBe("steadyWake");
    expect(classifyFlowRegime(100)).toBe("vortexShedding");
    expect(classifyFlowRegime(5000)).toBe("turbulent");
  });

  it("puts each threshold in the regime it opens", () => {
    expect(classifyFlowRegime(RE_SEPARATION)).toBe("steadyWake");
    expect(classifyFlowRegime(RE_SHEDDING_ONSET)).toBe("vortexShedding");
    expect(classifyFlowRegime(RE_TURBULENT_ONSET)).toBe("turbulent");
  });

  it("puts the value just below each threshold in the preceding regime", () => {
    // Number.EPSILON is too small to change a value of order 5 in float64, so
    // use a delta that survives the subtraction.
    expect(classifyFlowRegime(RE_SEPARATION - 0.001)).toBe("creeping");
    expect(classifyFlowRegime(RE_SHEDDING_ONSET - 0.001)).toBe("steadyWake");
    expect(classifyFlowRegime(RE_TURBULENT_ONSET - 0.001)).toBe("vortexShedding");
  });

  it("treats a fluid at rest as creeping", () => {
    expect(classifyFlowRegime(0)).toBe("creeping");
  });

  it("keeps the thresholds strictly increasing", () => {
    expect(RE_SEPARATION).toBeLessThan(RE_SHEDDING_ONSET);
    expect(RE_SHEDDING_ONSET).toBeLessThan(RE_TURBULENT_ONSET);
  });
});
