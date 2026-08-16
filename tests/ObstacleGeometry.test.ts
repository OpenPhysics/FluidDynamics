/**
 * Tests for the pure geometry the obstacle's drag handles share.
 */

import { describe, expect, it } from "vitest";
import { maxFocalRadius, nacaHalfThickness, wrapAngleOfAttackDeg } from "../src/common/model/ObstacleGeometry.js";
import {
  ANGLE_OF_ATTACK_RANGE,
  OBSTACLE_DIAMETER_RANGE,
  OBSTACLE_FOCAL_MAX_FRACTION,
} from "../src/FluidDynamicsConstants.js";

describe("wrapAngleOfAttackDeg", () => {
  it("maps atan2's (−180°, 180°] into the ±90° the model stores", () => {
    expect(wrapAngleOfAttackDeg(0)).toBe(0);
    expect(wrapAngleOfAttackDeg(45)).toBe(45);
    expect(wrapAngleOfAttackDeg(90)).toBe(90);
    expect(wrapAngleOfAttackDeg(-90)).toBe(-90);
    expect(wrapAngleOfAttackDeg(135)).toBe(-45);
    expect(wrapAngleOfAttackDeg(180)).toBe(0);
    expect(wrapAngleOfAttackDeg(-135)).toBe(45);
    expect(wrapAngleOfAttackDeg(-180)).toBe(0);
  });

  it("exploits the chord's 180° symmetry — α and α ± 180° are the same body", () => {
    for (let angle = -270; angle <= 270; angle += 15) {
      const wrapped = wrapAngleOfAttackDeg(angle);
      expect(wrapped, `α=${angle}°`).toBeGreaterThanOrEqual(ANGLE_OF_ATTACK_RANGE.min);
      expect(wrapped, `α=${angle}°`).toBeLessThanOrEqual(ANGLE_OF_ATTACK_RANGE.max);
      // The wrapped angle differs from the original by a whole half-turn, so
      // it describes the same chord.
      expect(Math.abs(wrapped - angle) % 180, `α=${angle}°`).toBe(0);
    }
  });
});

describe("maxFocalRadius", () => {
  it("caps the foci below the semi-major axis so the minor axis stays real", () => {
    for (let diameter = OBSTACLE_DIAMETER_RANGE.min; diameter <= OBSTACLE_DIAMETER_RANGE.max; diameter += 0.01) {
      const a = diameter / 2;
      const c = maxFocalRadius(diameter, OBSTACLE_FOCAL_MAX_FRACTION);
      expect(c, `D=${diameter}`).toBeLessThan(a);
      // b = √(a² − c²) stays comfortably positive at the cap.
      expect(Math.sqrt(a * a - c * c), `D=${diameter}`).toBeGreaterThan(0.3 * a);
    }
  });
});

describe("nacaHalfThickness", () => {
  it("peaks near the 30% station, as the NACA distribution does", () => {
    let peakStation = 0;
    let peakValue = -1;
    for (let x = 0.01; x <= 1; x += 0.01) {
      const value = nacaHalfThickness(0.12, x);
      if (value > peakValue) {
        peakValue = value;
        peakStation = x;
      }
    }
    expect(peakStation).toBeGreaterThanOrEqual(0.25);
    expect(peakStation).toBeLessThanOrEqual(0.35);
  });

  it("makes a NACA 0012 half a chord's 6% thick at the peak, matching the shader", () => {
    expect(nacaHalfThickness(0.12, 0.3)).toBeCloseTo(0.06, 3);
    // A unit thickness makes the scale factor explicit for handle placement.
    expect(nacaHalfThickness(1, 0.3)).toBeCloseTo(0.5, 3);
  });

  it("scales linearly with the thickness fraction", () => {
    for (const thickness of [0.04, 0.12, 0.3]) {
      const ratio = nacaHalfThickness(thickness, 0.5) / nacaHalfThickness(0.12, 0.5);
      expect(ratio, `t=${thickness}`).toBeCloseTo(thickness / 0.12, 6);
    }
  });
});
