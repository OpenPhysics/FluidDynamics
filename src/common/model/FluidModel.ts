/**
 * FluidModel.ts
 *
 * The physical parameters of the flow, shared by both screens.
 *
 * This is the whole model. The fluid *state* — velocity, pressure, dye — never
 * exists on the CPU: it lives in GPU textures owned by WebGPUFluidEngine, and
 * there is no copy to keep in sync. What remains here is exactly the set of
 * quantities a learner can change, plus the two dimensionless results that make
 * the simulation mean something (Reynolds number and the regime it implies).
 *
 * Consequently this file has no scenery and no WebGPU imports, and is fully
 * unit-testable. See doc/implementation-notes.md for why the solver itself lives
 * under common/gpu/ rather than here.
 */

import { BooleanProperty, DerivedProperty, NumberProperty, Property, type TReadOnlyProperty } from "scenerystack/axon";
import { Range, Vector2Property } from "scenerystack/dot";
import {
  AIRFOIL_THICKNESS_DEFAULT,
  AIRFOIL_THICKNESS_RANGE,
  ANGLE_OF_ATTACK_DEFAULT,
  ANGLE_OF_ATTACK_RANGE,
  DYE_DISSIPATION_DEFAULT,
  DYE_DISSIPATION_RANGE,
  FLOW_SPEED_DEFAULT,
  FLOW_SPEED_RANGE,
  OBSTACLE_CENTER_DEFAULT,
  OBSTACLE_DIAMETER_DEFAULT,
  OBSTACLE_DIAMETER_RANGE,
  OBSTACLE_FOCAL_MAX_FRACTION,
  obstacleDragBounds,
  PRESSURE_ITERATIONS_DEFAULT,
  PRESSURE_ITERATIONS_HIGH,
  PRESSURE_ITERATIONS_RANGE,
  RULER_POSITION_DEFAULT,
  TAPE_BASE_DEFAULT,
  TAPE_TIP_DEFAULT,
  VISCOSITY_DEFAULT,
  VISCOSITY_RANGE,
  VORTICITY_DEFAULT,
  VORTICITY_RANGE,
} from "../../FluidDynamicsConstants.js";
import fluidDynamicsQueryParameters from "../../preferences/fluidDynamicsQueryParameters.js";
import type { GridResolution } from "../gpu/FluidGridSpec.js";
import { classifyFlowRegime, computeReynoldsNumber, type FlowRegime } from "./FlowRegime.js";
import { maxFocalRadius } from "./ObstacleGeometry.js";
import type { ObstacleShape } from "./ObstacleShape.js";
import type { VisualizationMode } from "./VisualizationMode.js";

type FluidModelOptions = {
  /**
   * Shape the screen starts with. The Intro screen keeps the cylinder it has
   * always shown; the Lab starts on the ellipse, which at zero focal
   * separation is the same disk.
   */
  readonly initialObstacleShape?: ObstacleShape;
};

export class FluidModel {
  /** Inflow speed U at the left boundary, in m/s. */
  public readonly flowSpeedProperty: NumberProperty;

  /** Kinematic viscosity ν, in m²/s. */
  public readonly kinematicViscosityProperty: NumberProperty;

  /** Obstacle diameter D, in metres — the length scale in Re = U·D/ν. */
  public readonly obstacleDiameterProperty: NumberProperty;

  /** Obstacle centre, in metres from the channel's lower-left corner. */
  public readonly obstacleCenterProperty: Vector2Property;

  public readonly obstacleShapeProperty: Property<ObstacleShape>;

  /**
   * Angle of attack of the plate, airfoil and ellipse, in degrees — the tilt of
   * the body's chord (for the ellipse, its major axis) relative to the oncoming
   * flow. No effect on the cylinder or on "no obstacle", which have no chord
   * to tilt.
   */
  public readonly angleOfAttackProperty: NumberProperty;

  /**
   * Half the distance between the ellipse's two foci, in metres from its
   * centre. Zero collapses the ellipse to a disk; the drag handles on the
   * focal points write here and read it back. No effect on the other shapes.
   */
  public readonly obstacleFocalRadiusProperty: NumberProperty;

  /**
   * Airfoil thickness as a fraction of chord (the t in a NACA 00xx section).
   * No effect on the other shapes.
   */
  public readonly airfoilThicknessProperty: NumberProperty;

  /**
   * Strength of the vorticity-confinement correction. See FluidDynamicsConstants.
   *
   * Preference-backed: the value is owned by Preferences → Simulation and pushed
   * here by {@link attachVorticity}, so Reset All does not touch it.
   */
  public readonly vorticityProperty: NumberProperty;

  /**
   * Fraction of dye remaining after one second. Preference-backed like
   * vorticityProperty: the value is owned by Preferences → Simulation and
   * pushed here by {@link attachDyeDissipation}, so Reset All does not touch it.
   */
  public readonly dyeDissipationProperty: NumberProperty;

  public readonly visualizationModeProperty: Property<VisualizationMode>;

  /**
   * Whether the tracer dots are released at the inlet.
   *
   * Independent of the visualization mode rather than one of its values: the
   * dots mark parcels of fluid, so they are informative over any of the four
   * fields, and a learner watching the vorticity map should not have to give it
   * up to see where the fluid actually goes.
   */
  public readonly tracersVisibleProperty: BooleanProperty;

  /**
   * Solver grid resolution. Preference-backed like vorticityProperty: the value
   * is owned by Preferences → Simulation and pushed here by
   * {@link attachGridResolution}, so Reset All does not touch it.
   */
  public readonly gridResolutionProperty: Property<GridResolution>;

  /**
   * Red-black SOR sweeps in the pressure projection.
   *
   * Preference-backed like vorticityProperty: the value is owned by
   * Preferences → Simulation and pushed here by {@link attachSolverQuality}, so
   * Reset All does not touch it.
   */
  public readonly pressureIterationsProperty: NumberProperty;

  // ── Measurement tools ──────────────────────────────────────────────────────
  // View-owned nodes, but model-owned state: Reset All puts both tools back in
  // the toolbox, which is what a learner expects "reset" to mean. Positions are
  // in metres from the channel's lower-left corner, same frame as the obstacle.

  /** Whether the measuring tape is out of the toolbox. */
  public readonly measuringTapeVisibleProperty: BooleanProperty;

  /** Tape base (the housing) position, in metres. */
  public readonly tapeBasePositionProperty: Vector2Property;

  /** Tape tip position, in metres. The readout is the base–tip distance. */
  public readonly tapeTipPositionProperty: Vector2Property;

  /** Whether the ruler is out of the toolbox. */
  public readonly rulerVisibleProperty: BooleanProperty;

  /** Ruler centre, in metres. */
  public readonly rulerPositionProperty: Vector2Property;

  /** Re = U·D/ν. Infinite at zero viscosity, which classifies as turbulent. */
  public readonly reynoldsNumberProperty: TReadOnlyProperty<number>;

  /** Which of the four textbook regimes the current Re falls in. */
  public readonly flowRegimeProperty: TReadOnlyProperty<FlowRegime>;

  private isDisposed = false;
  private detachSolverQuality: (() => void) | null = null;
  private detachVorticity: (() => void) | null = null;
  private detachDyeDissipation: (() => void) | null = null;
  private detachGridResolution: (() => void) | null = null;
  private detachResizeClamp: (() => void) | null = null;

  public constructor(providedOptions?: FluidModelOptions) {
    const options = { initialObstacleShape: "cylinder" as ObstacleShape, ...providedOptions };

    this.flowSpeedProperty = new NumberProperty(FLOW_SPEED_DEFAULT, {
      range: FLOW_SPEED_RANGE,
      units: "m/s",
    });

    // No `units` option: AXON's unit vocabulary has no m²/s entry, and inventing
    // one would fail PhET-iO validation. The unit is documented on the Property.
    this.kinematicViscosityProperty = new NumberProperty(VISCOSITY_DEFAULT, {
      range: VISCOSITY_RANGE,
    });

    this.obstacleDiameterProperty = new NumberProperty(OBSTACLE_DIAMETER_DEFAULT, {
      range: OBSTACLE_DIAMETER_RANGE,
      units: "m",
    });

    this.obstacleCenterProperty = new Vector2Property(OBSTACLE_CENTER_DEFAULT);

    this.obstacleShapeProperty = new Property<ObstacleShape>(options.initialObstacleShape);

    this.angleOfAttackProperty = new NumberProperty(ANGLE_OF_ATTACK_DEFAULT, {
      range: ANGLE_OF_ATTACK_RANGE,
      units: "\u00B0",
    });

    // The range spans every separation the largest body allows; a smaller body
    // tightens it in the resize listener below, exactly as its centre's drag
    // bounds tighten.
    this.obstacleFocalRadiusProperty = new NumberProperty(0, {
      range: new Range(0, maxFocalRadius(OBSTACLE_DIAMETER_RANGE.max, OBSTACLE_FOCAL_MAX_FRACTION)),
      units: "m",
    });

    this.airfoilThicknessProperty = new NumberProperty(AIRFOIL_THICKNESS_DEFAULT, {
      range: AIRFOIL_THICKNESS_RANGE,
    });

    this.vorticityProperty = new NumberProperty(VORTICITY_DEFAULT, { range: VORTICITY_RANGE });

    this.dyeDissipationProperty = new NumberProperty(DYE_DISSIPATION_DEFAULT, { range: DYE_DISSIPATION_RANGE });

    this.visualizationModeProperty = new Property<VisualizationMode>("dye");

    this.tracersVisibleProperty = new BooleanProperty(false);

    this.gridResolutionProperty = new Property<GridResolution>("standard");

    this.pressureIterationsProperty = new NumberProperty(PRESSURE_ITERATIONS_DEFAULT, {
      range: PRESSURE_ITERATIONS_RANGE,
    });

    this.measuringTapeVisibleProperty = new BooleanProperty(false);
    this.tapeBasePositionProperty = new Vector2Property(TAPE_BASE_DEFAULT);
    this.tapeTipPositionProperty = new Vector2Property(TAPE_TIP_DEFAULT);
    this.rulerVisibleProperty = new BooleanProperty(false);
    this.rulerPositionProperty = new Vector2Property(RULER_POSITION_DEFAULT);

    this.reynoldsNumberProperty = new DerivedProperty(
      [this.flowSpeedProperty, this.obstacleDiameterProperty, this.kinematicViscosityProperty],
      (speed, diameter, viscosity) => computeReynoldsNumber(speed, diameter, viscosity),
    );

    this.flowRegimeProperty = new DerivedProperty([this.reynoldsNumberProperty], (re) => classifyFlowRegime(re));

    // Dragging constrains the centre to where the current body fits (see
    // ObstacleHandleNode), but resizing can strand a body somewhere it no
    // longer fits: growing it with a handle while parked near a wall would
    // push the edge through the wall. So a diameter change re-clamps the
    // centre, sliding the body inward as it grows — and re-clamps the focal
    // separation, which cannot exceed what a body of this size can hold.
    const resizeListener = (diameter: number): void => {
      this.obstacleCenterProperty.value = obstacleDragBounds(diameter).getConstrainedPoint(
        this.obstacleCenterProperty.value,
      );
      this.obstacleFocalRadiusProperty.value = Math.min(
        this.obstacleFocalRadiusProperty.value,
        maxFocalRadius(diameter, OBSTACLE_FOCAL_MAX_FRACTION),
      );
    };
    this.obstacleDiameterProperty.link(resizeListener);
    this.detachResizeClamp = () => this.obstacleDiameterProperty.unlink(resizeListener);
  }

  /**
   * Binds the pressure-solve iteration count to the "higher solver accuracy"
   * preference.
   *
   * The `pressureIterations` query parameter, when set, wins over both — it is a
   * development escape hatch for measuring what the projection costs, so it has
   * to be able to hold a value the preference would otherwise overwrite.
   */
  public attachSolverQuality(highQualityProperty: TReadOnlyProperty<boolean>): void {
    if (fluidDynamicsQueryParameters.pressureIterations !== 0) {
      this.pressureIterationsProperty.value = fluidDynamicsQueryParameters.pressureIterations;
      return;
    }
    const listener = (highQuality: boolean): void => {
      this.pressureIterationsProperty.value = highQuality ? PRESSURE_ITERATIONS_HIGH : PRESSURE_ITERATIONS_DEFAULT;
    };
    highQualityProperty.link(listener);
    this.detachSolverQuality = () => highQualityProperty.unlink(listener);
  }

  /**
   * Binds the vorticity-confinement strength to its preference. Reset All does
   * not reset vorticityProperty: the preference stays put across a reset, and
   * re-syncing the mirror would otherwise desync from it.
   */
  public attachVorticity(vorticityProperty: TReadOnlyProperty<number>): void {
    const listener = (vorticity: number): void => {
      this.vorticityProperty.value = vorticity;
    };
    vorticityProperty.link(listener);
    this.detachVorticity = () => vorticityProperty.unlink(listener);
  }

  /**
   * Binds the dye dissipation to its preference. Reset All does not reset
   * dyeDissipationProperty, for the same reason as attachVorticity.
   */
  public attachDyeDissipation(dyeDissipationProperty: TReadOnlyProperty<number>): void {
    const listener = (dissipation: number): void => {
      this.dyeDissipationProperty.value = dissipation;
    };
    dyeDissipationProperty.link(listener);
    this.detachDyeDissipation = () => dyeDissipationProperty.unlink(listener);
  }

  /**
   * Binds the solver grid resolution to its preference. Reset All does not
   * reset gridResolutionProperty, for the same reason as attachVorticity.
   */
  public attachGridResolution(gridResolutionProperty: TReadOnlyProperty<GridResolution>): void {
    const listener = (resolution: GridResolution): void => {
      this.gridResolutionProperty.value = resolution;
    };
    gridResolutionProperty.link(listener);
    this.detachGridResolution = () => gridResolutionProperty.unlink(listener);
  }

  /** Obstacle half-size in metres, as written into the shader uniform. */
  public get obstacleRadius(): number {
    return this.obstacleDiameterProperty.value / 2;
  }

  /**
   * Angle of attack in radians, as written into the shader uniform. The model
   * stores degrees because that is what the handles write; the shader wants
   * radians because sin and cos do.
   */
  public get obstacleAngle(): number {
    return (this.angleOfAttackProperty.value * Math.PI) / 180;
  }

  public reset(): void {
    this.flowSpeedProperty.reset();
    this.kinematicViscosityProperty.reset();
    this.obstacleDiameterProperty.reset();
    this.obstacleCenterProperty.reset();
    this.obstacleShapeProperty.reset();
    this.angleOfAttackProperty.reset();
    this.obstacleFocalRadiusProperty.reset();
    this.airfoilThicknessProperty.reset();
    // vorticityProperty, dyeDissipationProperty, gridResolutionProperty and
    // pressureIterationsProperty are deliberately not reset: they mirror
    // Preferences → Simulation, which Reset All does not touch. Resetting one
    // of them does not merely lose the value — the preference's link fires only
    // on change, so nothing ever puts it back, and the toggle would go on
    // reading "on" over a solver that had quietly dropped to the default.
    this.visualizationModeProperty.reset();
    this.tracersVisibleProperty.reset();
    this.rulerPositionProperty.reset();
    this.rulerVisibleProperty.reset();
    this.tapeTipPositionProperty.reset();
    this.tapeBasePositionProperty.reset();
    this.measuringTapeVisibleProperty.reset();
  }

  /**
   * Releases every Property. Derived properties are disposed before their
   * dependencies, so nothing is left listening to a disposed source.
   *
   * Idempotent, as the fleet's memory-leak suite requires. The guard is load
   * bearing: a plain Property tolerates a second dispose(), but DerivedProperty
   * nulls its dependency list on the first one and throws on the second.
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.detachSolverQuality?.();
    this.detachSolverQuality = null;
    this.detachVorticity?.();
    this.detachVorticity = null;
    this.detachDyeDissipation?.();
    this.detachDyeDissipation = null;
    this.detachGridResolution?.();
    this.detachGridResolution = null;
    this.detachResizeClamp?.();
    this.detachResizeClamp = null;
    this.flowRegimeProperty.dispose();
    this.reynoldsNumberProperty.dispose();
    this.pressureIterationsProperty.dispose();
    this.gridResolutionProperty.dispose();
    this.tracersVisibleProperty.dispose();
    this.visualizationModeProperty.dispose();
    this.dyeDissipationProperty.dispose();
    this.vorticityProperty.dispose();
    this.obstacleShapeProperty.dispose();
    this.angleOfAttackProperty.dispose();
    this.airfoilThicknessProperty.dispose();
    this.obstacleFocalRadiusProperty.dispose();
    this.obstacleCenterProperty.dispose();
    this.obstacleDiameterProperty.dispose();
    this.kinematicViscosityProperty.dispose();
    this.flowSpeedProperty.dispose();
    this.rulerPositionProperty.dispose();
    this.rulerVisibleProperty.dispose();
    this.tapeTipPositionProperty.dispose();
    this.tapeBasePositionProperty.dispose();
    this.measuringTapeVisibleProperty.dispose();
  }
}
