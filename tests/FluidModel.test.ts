/**
 * Tests for the shared flow-parameter model.
 */

import { Vector2 } from "scenerystack/dot";
import { describe, expect, it } from "vitest";
import { FLOW_REGIMES } from "../src/common/model/FlowRegime.js";
import { FluidModel } from "../src/common/model/FluidModel.js";
import { OBSTACLE_SHAPES, obstacleShapeCode } from "../src/common/model/ObstacleShape.js";
import { VISUALIZATION_MODES, visualizationModeCode } from "../src/common/model/VisualizationMode.js";
import {
  ANGLE_OF_ATTACK_DEFAULT,
  ANGLE_OF_ATTACK_RANGE,
  FLOW_SPEED_DEFAULT,
  FLOW_SPEED_RANGE,
  OBSTACLE_DIAMETER_DEFAULT,
  OBSTACLE_DIAMETER_RANGE,
  OBSTACLE_DRAG_BOUNDS_M,
  obstacleDragBounds,
  RULER_POSITION_DEFAULT,
  TAPE_BASE_DEFAULT,
  TAPE_TIP_DEFAULT,
  VISCOSITY_DEFAULT,
  VISCOSITY_RANGE,
} from "../src/FluidDynamicsConstants.js";

describe("FluidModel", () => {
  it("derives the Reynolds number from speed, diameter and viscosity", () => {
    const model = new FluidModel();

    expect(model.reynoldsNumberProperty.value).toBeCloseTo(
      (FLOW_SPEED_DEFAULT * OBSTACLE_DIAMETER_DEFAULT) / VISCOSITY_DEFAULT,
      6,
    );

    model.flowSpeedProperty.value = 2 * FLOW_SPEED_DEFAULT;
    expect(model.reynoldsNumberProperty.value).toBeCloseTo(
      (2 * FLOW_SPEED_DEFAULT * OBSTACLE_DIAMETER_DEFAULT) / VISCOSITY_DEFAULT,
      6,
    );

    model.dispose();
  });

  it("reaches all four regimes within the shipped slider ranges", () => {
    // Every (speed, viscosity) pair below is inside FLOW_SPEED_RANGE and
    // VISCOSITY_RANGE, so this doubles as a check that the ranges the learner
    // can actually reach span the whole laminar-to-turbulent story.
    const cases = [
      { speed: FLOW_SPEED_RANGE.min, viscosity: VISCOSITY_RANGE.max, expected: "creeping" },
      { speed: 0.6, viscosity: 1e-2, expected: "steadyWake" },
      { speed: 1, viscosity: 1e-3, expected: "vortexShedding" },
      { speed: FLOW_SPEED_RANGE.max, viscosity: VISCOSITY_RANGE.min, expected: "turbulent" },
    ] as const;

    const model = new FluidModel();
    for (const { speed, viscosity, expected } of cases) {
      model.flowSpeedProperty.value = speed;
      model.kinematicViscosityProperty.value = viscosity;
      expect(model.flowRegimeProperty.value, `U=${speed} ν=${viscosity}`).toBe(expected);
    }
    model.dispose();
  });

  it("never moves to a lower regime as the flow speed rises", () => {
    const model = new FluidModel();
    model.kinematicViscosityProperty.value = 1e-3;

    let previousIndex = -1;
    for (let speed = FLOW_SPEED_RANGE.min; speed <= FLOW_SPEED_RANGE.max; speed += 0.05) {
      model.flowSpeedProperty.value = speed;
      const index = FLOW_REGIMES.indexOf(model.flowRegimeProperty.value);
      expect(index, `U=${speed}`).toBeGreaterThanOrEqual(previousIndex);
      previousIndex = index;
    }

    model.dispose();
  });

  it("reports the obstacle radius as half the diameter", () => {
    const model = new FluidModel();

    model.obstacleDiameterProperty.value = 0.2;
    expect(model.obstacleRadius).toBeCloseTo(0.1, 12);

    model.dispose();
  });

  it("reports the angle of attack in radians", () => {
    const model = new FluidModel();

    expect(model.angleOfAttackProperty.value).toBe(ANGLE_OF_ATTACK_DEFAULT);
    expect(model.obstacleAngle).toBeCloseTo((ANGLE_OF_ATTACK_DEFAULT * Math.PI) / 180, 12);

    model.angleOfAttackProperty.value = ANGLE_OF_ATTACK_RANGE.max;
    expect(model.obstacleAngle).toBeCloseTo(Math.PI / 2, 12);

    model.dispose();
  });

  it("pulls the obstacle away from the walls when it grows past where it fits", () => {
    const model = new FluidModel();
    // Parked at the bottom-left corner of the drag region, legal at the default
    // size but not for a body near the top of the slider.
    model.obstacleCenterProperty.value = new Vector2(0.25, 0.25);

    model.obstacleDiameterProperty.value = OBSTACLE_DIAMETER_RANGE.max;

    const bounds = obstacleDragBounds(OBSTACLE_DIAMETER_RANGE.max);
    expect(model.obstacleCenterProperty.value.x).toBeCloseTo(bounds.minX, 12);
    expect(model.obstacleCenterProperty.value.y).toBeCloseTo(bounds.minY, 12);

    model.dispose();
  });

  it("restores every Property on reset", () => {
    const model = new FluidModel();
    const initialRe = model.reynoldsNumberProperty.value;

    model.flowSpeedProperty.value = 2.5;
    model.kinematicViscosityProperty.value = 5e-2;
    model.obstacleDiameterProperty.value = 0.3;
    model.obstacleCenterProperty.value = model.obstacleCenterProperty.value.plusXY(0.25, -0.1);
    model.obstacleShapeProperty.value = "airfoil";
    model.angleOfAttackProperty.value = ANGLE_OF_ATTACK_RANGE.min;
    model.vorticityProperty.value = 5;
    model.dyeDissipationProperty.value = 0.2;
    model.visualizationModeProperty.value = "vorticity";
    model.gridResolutionProperty.value = "fine";
    model.pressureIterationsProperty.value = 50;
    model.measuringTapeVisibleProperty.value = true;
    model.tapeBasePositionProperty.value = model.tapeBasePositionProperty.value.plusXY(0.4, 0.2);
    model.tapeTipPositionProperty.value = model.tapeTipPositionProperty.value.plusXY(-0.3, 0.15);
    model.rulerVisibleProperty.value = true;
    model.rulerPositionProperty.value = model.rulerPositionProperty.value.plusXY(0.9, -0.4);

    model.reset();

    expect(model.flowSpeedProperty.value).toBe(FLOW_SPEED_DEFAULT);
    expect(model.kinematicViscosityProperty.value).toBe(VISCOSITY_DEFAULT);
    expect(model.obstacleDiameterProperty.value).toBe(OBSTACLE_DIAMETER_DEFAULT);
    expect(model.obstacleShapeProperty.value).toBe("cylinder");
    expect(model.angleOfAttackProperty.value).toBe(ANGLE_OF_ATTACK_DEFAULT);
    expect(model.visualizationModeProperty.value).toBe("dye");
    expect(model.gridResolutionProperty.value).toBe("standard");
    expect(model.reynoldsNumberProperty.value).toBeCloseTo(initialRe, 12);
    expect(model.measuringTapeVisibleProperty.value, "reset puts the tape back in the toolbox").toBe(false);
    expect(model.tapeBasePositionProperty.value.equals(TAPE_BASE_DEFAULT)).toBe(true);
    expect(model.tapeTipPositionProperty.value.equals(TAPE_TIP_DEFAULT)).toBe(true);
    expect(model.rulerVisibleProperty.value, "reset puts the ruler back in the toolbox").toBe(false);
    expect(model.rulerPositionProperty.value.equals(RULER_POSITION_DEFAULT)).toBe(true);

    model.dispose();
  });
});

describe("obstacle drag bounds", () => {
  it("leaves the region the original size range allowed untouched", () => {
    // 0.35 m was the top of the first shipped slider; every body it allowed
    // sees exactly the bounds it always had.
    for (const diameter of [OBSTACLE_DIAMETER_RANGE.min, OBSTACLE_DIAMETER_DEFAULT, 0.35]) {
      expect(obstacleDragBounds(diameter).equalsEpsilon(OBSTACLE_DRAG_BOUNDS_M, 1e-9), `D=${diameter}`).toBe(true);
    }
  });

  it("shrinks the region as the body grows, but never empties it", () => {
    for (let diameter = OBSTACLE_DIAMETER_RANGE.min; diameter <= OBSTACLE_DIAMETER_RANGE.max; diameter += 0.01) {
      const bounds = obstacleDragBounds(diameter);
      expect(bounds.minX, `D=${diameter}`).toBeLessThanOrEqual(bounds.maxX);
      expect(bounds.minY, `D=${diameter}`).toBeLessThanOrEqual(bounds.maxY);
    }

    // The largest body pins near mid-height — the only place with room for it.
    const largest = obstacleDragBounds(OBSTACLE_DIAMETER_RANGE.max);
    expect(largest.minY).toBeGreaterThan(OBSTACLE_DRAG_BOUNDS_M.minY);
    expect(largest.maxY).toBeLessThan(OBSTACLE_DRAG_BOUNDS_M.maxY);
    expect(largest.minY).toBeLessThan(largest.maxY);
  });
});

describe("shader enum codes", () => {
  it("gives each obstacle shape a distinct code matching its index", () => {
    expect(OBSTACLE_SHAPES.map(obstacleShapeCode)).toEqual([0, 1, 2, 3]);
  });

  it("gives each visualization mode a distinct code matching its index", () => {
    expect(VISUALIZATION_MODES.map(visualizationModeCode)).toEqual([0, 1, 2, 3]);
  });

  it("keeps 'none' as obstacle code 0, which the shader treats as no body", () => {
    expect(obstacleShapeCode("none")).toBe(0);
  });
});
