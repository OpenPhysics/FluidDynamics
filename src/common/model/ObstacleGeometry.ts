/**
 * ObstacleGeometry.ts
 *
 * Pure geometry shared by the obstacle's drag handles, kept free of scenery so
 * it is unit-testable like the rest of the model.
 *
 * Every chorded body this sim offers — the plate, the symmetric airfoil, the
 * ellipse — looks the same after a half turn, so an angle of attack α and α ±
 * 180° describe the same body. The handles exploit that: they aim a drag
 * wherever the pointer actually is and fold the result back into the ±90°
 * range the model stores.
 */

import { ANGLE_OF_ATTACK_RANGE } from "../../FluidDynamicsConstants.js";

/**
 * Folds an angle in degrees into the angle-of-attack range using the chord's
 * 180° symmetry. atan2 speaks in (−180°, 180°]; this speaks in [−90°, 90°].
 */
export function wrapAngleOfAttackDeg(deg: number): number {
  let angle = deg;
  while (angle > ANGLE_OF_ATTACK_RANGE.max) {
    angle -= 180;
  }
  while (angle < ANGLE_OF_ATTACK_RANGE.min) {
    angle += 180;
  }
  return angle;
}

/**
 * Largest focal half-separation an ellipse of the given diameter may carry.
 *
 * Capped below the semi-major axis a = D/2 so the minor semi-axis
 * b = √(a² − c²) stays real and comfortable to grab: at the cap,
 * b ≈ 0.31·a. The cap is a fraction rather than an absolute so a shrunken
 * body cannot keep a focal distance its own size can no longer hold.
 */
export function maxFocalRadius(diameter: number, maxFraction: number): number {
  return (maxFraction * diameter) / 2;
}

/**
 * Half-thickness of a symmetric NACA 00xx section at the given station,
 * as a fraction of the chord. Mirrors the polynomial in common.wgsl — the
 * shader decides which cells are solid, and this places the thickness handle
 * exactly on the surface the learner is dragging.
 *
 * x runs 0 (leading edge) to 1 (trailing edge); thickness is the t in 00xx
 * (maximum full thickness as a fraction of chord, which this distribution
 * peaks at near x = 0.3).
 */
export function nacaHalfThickness(thickness: number, x: number): number {
  return (
    5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x)
  );
}
