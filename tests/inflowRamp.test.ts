/**
 * Tests for the inflow speed ramp.
 *
 * The boundary condition the ramp feeds is a Dirichlet strip, and the solver
 * behind it is an incompressible projection — the combination that makes a step
 * change of inflow speed slosh the whole channel backward off the p = 0 outflow.
 * The arithmetic that prevents that is simple enough to look obvious, which is
 * exactly why it is pinned here: the properties that make it safe (never
 * jumping, freezing when paused, being independent of how the caller slices
 * time) are the ones a refactor would quietly break.
 */

import { describe, expect, it } from "vitest";
import { advanceInflowRamp, isInflowSettling } from "../src/common/gpu/inflowRamp.js";
import { FLOW_SPEED_RESPONSE_TIME } from "../src/FluidDynamicsConstants.js";

const DT = 1 / 60;

describe("advanceInflowRamp", () => {
  it("snaps to the target when there is no history, because a field at rest matches any inflow", () => {
    const state = advanceInflowRamp(null, 0.6, DT);
    expect(state.applied).toBe(0.6);
    expect(state.target).toBe(0.6);
    expect(isInflowSettling(state)).toBe(false);
  });

  it("never jumps: one step moves the applied speed by a bounded fraction of the gap", () => {
    let state = advanceInflowRamp(null, 3, DT);
    state = advanceInflowRamp(state, 0.05, DT);
    // One 1/60 s step covers 1 - e^(-dt/τ) of the remaining gap — small.
    expect(state.applied).toBeGreaterThan(2.9);
    expect(state.applied).toBeLessThan(3);
  });

  it("is framerate-independent: two half-steps land where one whole step does", () => {
    const whole = advanceInflowRamp(advanceInflowRamp(null, 3, DT), 0.3, DT);
    const halves = advanceInflowRamp(advanceInflowRamp(advanceInflowRamp(null, 3, DT), 0.3, DT / 2), 0.3, DT / 2);
    expect(halves.applied).toBeCloseTo(whole.applied, 10);
  });

  it("converges to the target monotonically", () => {
    let state = advanceInflowRamp(null, 3, DT);
    state = advanceInflowRamp(state, 0.3, DT);
    let previous = state.applied;
    for (let i = 0; i < 600; i++) {
      state = advanceInflowRamp(state, 0.3, DT);
      expect(state.applied).toBeLessThanOrEqual(previous);
      expect(state.applied).toBeGreaterThanOrEqual(0.3);
      previous = state.applied;
    }
    expect(state.applied).toBeCloseTo(0.3, 5);
  });

  it("freezes when paused, even if the slider moves while the sim stands still", () => {
    let state = advanceInflowRamp(null, 3, DT);
    state = advanceInflowRamp(state, 0.3, DT);
    const frozen = state.applied;
    state = advanceInflowRamp(state, 0.05, 0);
    expect(state.applied).toBe(frozen);
    expect(state.target).toBe(0.05);
  });

  it("retargets continuously: moving the slider mid-ramp never jumps the boundary", () => {
    let state = advanceInflowRamp(null, 3, DT);
    state = advanceInflowRamp(state, 0.3, DT);
    const before = state.applied;
    // New target above and below the applied speed: either way the boundary
    // moves by less than one step's fraction of the new gap.
    for (const target of [2, 0.05]) {
      state = advanceInflowRamp(state, target, DT);
      expect(Math.abs(state.applied - before)).toBeLessThan(Math.abs(target - before));
      expect(Math.abs(state.applied - before)).toBeGreaterThan(0);
    }
  });

  it("treats a non-positive response time as no ramp at all", () => {
    const state = advanceInflowRamp({ applied: 0.1, target: 3, sinceRetarget: 5 }, 3, DT, 0);
    expect(state.applied).toBe(3);
  });
});

describe("isInflowSettling", () => {
  it("is true after a retarget and until the channel has had time to drain", () => {
    let state = advanceInflowRamp(null, 3, DT);
    expect(isInflowSettling(state)).toBe(false);

    state = advanceInflowRamp(state, 0.3, DT);
    expect(isInflowSettling(state)).toBe(true);

    // The applied speed reaches the target after ~3τ, but the settling window
    // outlasts the ramp itself.
    let elapsed = 0;
    while (elapsed < 3 * FLOW_SPEED_RESPONSE_TIME - DT) {
      state = advanceInflowRamp(state, 0.3, DT);
      elapsed += DT;
    }
    expect(isInflowSettling(state)).toBe(true);

    state = advanceInflowRamp(state, 0.3, DT);
    expect(isInflowSettling(state)).toBe(false);
  });

  it("restarts the window when the slider moves again", () => {
    let state = advanceInflowRamp(null, 3, DT);
    let elapsed = 0;
    while (elapsed < 4 * FLOW_SPEED_RESPONSE_TIME) {
      state = advanceInflowRamp(state, 3, DT);
      elapsed += DT;
    }
    expect(isInflowSettling(state)).toBe(false);

    state = advanceInflowRamp(state, 1, DT);
    expect(isInflowSettling(state)).toBe(true);
  });
});
