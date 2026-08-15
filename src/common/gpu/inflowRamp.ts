/**
 * inflowRamp.ts
 *
 * The inflow speed the solver applies, as distinct from the one the slider
 * asks for.
 *
 * The inflow is a Dirichlet condition: forces.wgsl hard-sets the left boundary
 * strip to it every frame. When the applied value jumps in one step, the
 * projection — which is incompressible, and so answers globally and instantly —
 * must reconcile the new inlet flux with the momentum already in the channel,
 * and the pressure field it builds for that is a transient as large as the
 * change itself. When the change is a slow-down, that transient reflects off
 * the p = 0 outflow and drives the flow there into reverse, growing over the
 * next half-second until the whole column sloshes backward at up to several
 * times the *old* speed.
 *
 * Giving the boundary the inertia a real channel has removes the impulse. An
 * exponential approach was measured to leave the least residue of the shapes
 * tried: a smoothstep concentrates the change in the middle of the ramp and
 * rang worse, and no ramp at all rings worst of all. What residue remains is
 * not the ramp's fault but the projection's: an under-converged pressure solve
 * over-drains the channel's momentum through the outflow. So while the inflow
 * is settling (see isInflowSettling) the caller should run the pressure solve
 * at its high-accuracy sweep count, which measurement shows reduces the
 * ring-down by roughly four times.
 *
 * No GPU or scenery dependency: this is arithmetic, and it is unit-tested.
 */

import { FLOW_SPEED_RESPONSE_TIME } from "../../FluidDynamicsConstants.js";

/** Where the inflow ramp stands between slider values. */
export type InflowRampState = {
  /** Speed currently applied at the boundary, in m/s. */
  readonly applied: number;
  /** The target the ramp is heading toward. */
  readonly target: number;
  /** Seconds since the target last changed. */
  readonly sinceRetarget: number;
};

/**
 * One step of the ramp.
 *
 * `state === null` means there is no history — the first step, or the fluid was
 * just reset — where the applied speed snaps to the target: a field at rest is
 * already consistent with any inflow, so there is nothing to smooth. A dt of
 * zero (the paused path) advances nothing, leaving the boundary frozen at its
 * current speed until the sim plays again.
 */
export function advanceInflowRamp(
  state: InflowRampState | null,
  target: number,
  dt: number,
  responseTime: number = FLOW_SPEED_RESPONSE_TIME,
): InflowRampState {
  if (state === null || responseTime <= 0) {
    return { applied: target, target, sinceRetarget: Number.POSITIVE_INFINITY };
  }

  // A new target does not jump the applied speed; the chase just re-aims.
  const blend = 1 - Math.exp(-dt / responseTime);
  const applied = state.applied + (target - state.applied) * blend;
  return {
    applied,
    target,
    sinceRetarget: target === state.target ? state.sinceRetarget + dt : 0,
  };
}

/**
 * True while the channel is still adjusting to a speed change.
 *
 * The applied speed reaches the slider's value after ~3 response times, but the
 * fluid's momentum takes longer to drain to match it, and that is the window in
 * which an under-converged pressure solve can ring the outflow into reverse.
 */
export function isInflowSettling(state: InflowRampState | null): boolean {
  return state !== null && state.sinceRetarget < 3 * FLOW_SPEED_RESPONSE_TIME;
}
