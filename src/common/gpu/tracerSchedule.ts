/**
 * tracerSchedule.ts
 *
 * When the next column of tracer dots is released, and which slot in the
 * particle buffer it is written into.
 *
 * The columns are released by *distance* rather than by time: the clock
 * accumulates how far the free stream has carried the fluid since the last
 * release and fires when that reaches TRACER_COLUMN_SPACING_M. That is what
 * keeps the columns evenly spaced in the channel across the whole speed slider —
 * a fixed time interval would bunch them into a crowd at 0.05 m/s and string
 * them into a scatter at 3 m/s, and the even spacing is exactly what makes the
 * deformation of one column legible against its neighbours.
 *
 * The slot released into cycles through the buffer's columns in order, so a
 * dot that stalls at the stagnation point or gets trapped in the recirculation
 * bubble is not immortal: its slot comes round again after a full cycle, which
 * at the spacing above is roughly one and a half channel lengths of flow.
 *
 * No GPU or scenery dependency: this is arithmetic, and it is unit-tested. The
 * engine feeds the result to the shader as the `tracerEmitBatch` uniform.
 */

import { TRACER_BATCH_COUNT, TRACER_COLUMN_SPACING_M } from "../../FluidDynamicsConstants.js";

/** `tracerEmitBatch` value meaning "no column was released this step". */
export const NO_TRACER_RELEASE = -1;

/** Where the release clock stands. */
export type TracerReleaseState = {
  /** Distance the stream has carried since the last release, in metres. */
  readonly carry: number;
  /** Buffer column the next release will overwrite. */
  readonly nextBatch: number;
  /** Column released by the step that produced this state, or NO_TRACER_RELEASE. */
  readonly emitBatch: number;
};

/**
 * A clock that has never released anything, primed to fire on its first step
 * with a positive dt — so checking the box puts a column of dots at the inlet
 * on the very next frame rather than one spacing later.
 */
export function initialTracerRelease(): TracerReleaseState {
  return { carry: TRACER_COLUMN_SPACING_M, nextBatch: 0, emitBatch: NO_TRACER_RELEASE };
}

/**
 * Advances the clock by one solver step.
 *
 * At most one column is released per step, because the shader can only be told
 * about one. That is not a real limit: the largest step the engine takes is
 * MAX_PHYSICS_DT at the top of the speed range, which is 0.05 m of travel
 * against a 0.56 m spacing. Should it ever be exceeded anyway, the leftover is
 * clamped to one full spacing so the next step fires immediately and the clock
 * catches up rather than silently dropping columns.
 */
export function advanceTracerRelease(
  state: TracerReleaseState,
  inflowSpeed: number,
  dt: number,
  batchCount: number = TRACER_BATCH_COUNT,
): TracerReleaseState {
  // A paused frame releases nothing: the dots it released would sit on top of
  // the previous column, since nothing has moved.
  if (dt <= 0) {
    return { carry: state.carry, nextBatch: state.nextBatch, emitBatch: NO_TRACER_RELEASE };
  }

  const carry = state.carry + Math.max(inflowSpeed, 0) * dt;
  if (carry < TRACER_COLUMN_SPACING_M) {
    return { carry, nextBatch: state.nextBatch, emitBatch: NO_TRACER_RELEASE };
  }

  return {
    carry: Math.min(carry - TRACER_COLUMN_SPACING_M, TRACER_COLUMN_SPACING_M),
    nextBatch: (state.nextBatch + 1) % batchCount,
    emitBatch: state.nextBatch,
  };
}
