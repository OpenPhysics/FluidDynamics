/**
 * Tests for the shared flow-parameter model.
 */

import { describe, expect, it } from "vitest";
import { FLOW_REGIMES } from "../src/common/model/FlowRegime.js";
import { FluidModel } from "../src/common/model/FluidModel.js";
import { OBSTACLE_SHAPES, obstacleShapeCode } from "../src/common/model/ObstacleShape.js";
import { VISUALIZATION_MODES, visualizationModeCode } from "../src/common/model/VisualizationMode.js";
import {
  FLOW_SPEED_DEFAULT,
  FLOW_SPEED_RANGE,
  OBSTACLE_DIAMETER_DEFAULT,
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

  it("restores every Property on reset", () => {
    const model = new FluidModel();
    const initialRe = model.reynoldsNumberProperty.value;

    model.flowSpeedProperty.value = 2.5;
    model.kinematicViscosityProperty.value = 5e-2;
    model.obstacleDiameterProperty.value = 0.3;
    model.obstacleCenterProperty.value = model.obstacleCenterProperty.value.plusXY(0.25, -0.1);
    model.obstacleShapeProperty.value = "airfoil";
    model.vorticityProperty.value = 5;
    model.dyeDissipationProperty.value = 0.2;
    model.visualizationModeProperty.value = "vorticity";
    model.gridResolutionProperty.value = "fine";
    model.pressureIterationsProperty.value = 50;

    model.reset();

    expect(model.flowSpeedProperty.value).toBe(FLOW_SPEED_DEFAULT);
    expect(model.kinematicViscosityProperty.value).toBe(VISCOSITY_DEFAULT);
    expect(model.obstacleDiameterProperty.value).toBe(OBSTACLE_DIAMETER_DEFAULT);
    expect(model.obstacleShapeProperty.value).toBe("cylinder");
    expect(model.visualizationModeProperty.value).toBe("dye");
    expect(model.gridResolutionProperty.value).toBe("standard");
    expect(model.reynoldsNumberProperty.value).toBeCloseTo(initialRe, 12);

    model.dispose();
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
