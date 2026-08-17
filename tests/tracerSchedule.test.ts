/**
 * Tests for the tracer release clock.
 *
 * The clock decides when a column of dots is put back at the inlet and which
 * slot of the particle buffer it overwrites. Everything it gets wrong is a
 * picture that looks *nearly* right — columns bunching up at one end of the
 * speed slider, a column reappearing while its dots are still crossing the
 * channel — so it is arithmetic worth pinning rather than eyeballing.
 */

import { describe, expect, it } from "vitest";
import {
  advanceTracerRelease,
  initialTracerRelease,
  NO_TRACER_RELEASE,
  type TracerReleaseState,
} from "../src/common/gpu/tracerSchedule.js";
import { TRACER_BATCH_COUNT, TRACER_COLUMN_SPACING_M } from "../src/FluidDynamicsConstants.js";

/** Runs the clock over `steps` steps of `dt` at a fixed speed, collecting the releases. */
function run(
  speed: number,
  dt: number,
  steps: number,
): { readonly emits: number[]; readonly state: TracerReleaseState } {
  let state = initialTracerRelease();
  const emits: number[] = [];
  for (let i = 0; i < steps; i++) {
    state = advanceTracerRelease(state, speed, dt);
    if (state.emitBatch !== NO_TRACER_RELEASE) {
      emits.push(state.emitBatch);
    }
  }
  return { emits, state };
}

describe("tracer release clock", () => {
  it("releases the first column on the first step, so checking the box shows dots at once", () => {
    const state = advanceTracerRelease(initialTracerRelease(), 0.6, 1 / 60);
    expect(state.emitBatch).toBe(0);
  });

  it("releases nothing on a paused step, whatever the speed", () => {
    const state = advanceTracerRelease(initialTracerRelease(), 3, 0);
    expect(state.emitBatch).toBe(NO_TRACER_RELEASE);
    // And the clock has not moved, so resuming releases immediately.
    expect(state.carry).toBe(TRACER_COLUMN_SPACING_M);
  });

  it("spaces the columns by distance, not by time", () => {
    // Ten seconds at each speed. The number of columns is the distance travelled
    // divided by the spacing, whatever the speed — which is what keeps the
    // columns evenly spaced in the channel across the whole slider.
    for (const speed of [0.05, 0.6, 3]) {
      const { emits } = run(speed, 1 / 60, 600);
      const expected = Math.floor((speed * 10) / TRACER_COLUMN_SPACING_M);
      // ±1: the clock starts primed, and the last release may fall either side
      // of the final step.
      expect(Math.abs(emits.length - (expected + 1)), `at ${speed} m/s`).toBeLessThanOrEqual(1);
    }
  });

  it("cycles through the buffer's columns in order and wraps", () => {
    const { emits } = run(3, 1 / 60, 60 * 60);
    expect(emits.length).toBeGreaterThan(TRACER_BATCH_COUNT);
    for (let i = 0; i < emits.length; i++) {
      expect(emits[i]).toBe(i % TRACER_BATCH_COUNT);
    }
  });

  it("does not reuse a column's slot until a whole cycle of flow has passed", () => {
    // A slot is recycled after TRACER_BATCH_COUNT releases, i.e. after the
    // stream has carried that many spacings. That distance must exceed the
    // channel, or a column would be pulled back to the inlet while its dots
    // were still in view.
    expect(TRACER_BATCH_COUNT * TRACER_COLUMN_SPACING_M).toBeGreaterThan(2);
  });

  it("releases at most one column per step but catches up rather than dropping any", () => {
    // A step far larger than the engine ever takes: the carry is clamped to a
    // full spacing so the next step fires immediately.
    const state = advanceTracerRelease(initialTracerRelease(), 10, 1);
    expect(state.emitBatch).toBe(0);
    expect(state.carry).toBe(TRACER_COLUMN_SPACING_M);
    expect(advanceTracerRelease(state, 10, 1 / 60).emitBatch).toBe(1);
  });

  it("ignores a negative speed rather than winding the clock backwards", () => {
    const primed = advanceTracerRelease(initialTracerRelease(), 0.6, 1 / 60);
    const next = advanceTracerRelease(primed, -5, 1 / 60);
    expect(next.emitBatch).toBe(NO_TRACER_RELEASE);
    expect(next.carry).toBe(primed.carry);
  });

  it("keeps the slot count within the buffer", () => {
    const { emits } = run(3, 1 / 60, 60 * 60);
    for (const batch of emits) {
      expect(batch).toBeGreaterThanOrEqual(0);
      expect(batch).toBeLessThan(TRACER_BATCH_COUNT);
    }
  });
});
