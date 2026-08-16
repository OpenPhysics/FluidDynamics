/**
 * FluidDynamicsPreferencesModel.ts
 *
 * Model for the simulation-specific preferences shown in Preferences →
 * Simulation. Each preference Property takes its initial value from the
 * corresponding query parameter in fluidDynamicsQueryParameters.
 */

import { BooleanProperty, NumberProperty, Property } from "scenerystack/axon";
import { StringIO, type Tandem } from "scenerystack/tandem";
import { GRID_RESOLUTIONS, type GridResolution } from "../common/gpu/FluidGridSpec.js";
import { DYE_DISSIPATION_RANGE, VORTICITY_RANGE } from "../FluidDynamicsConstants.js";
import FluidDynamicsNamespace from "../FluidDynamicsNamespace.js";
import fluidDynamicsQueryParameters from "./fluidDynamicsQueryParameters.js";

export class FluidDynamicsPreferencesModel {
  /**
   * Whether to run the higher-accuracy pressure solve.
   *
   * This is a cost/quality trade rather than a physics control, which is why it
   * lives in Preferences and not on the Lab screen: more Jacobi iterations leave
   * less residual divergence — dye holds its shape longer instead of slowly
   * thinning — at a proportional cost in GPU time each frame. On a slower
   * machine, leaving it off is the difference between 60 and 30 fps.
   */
  public readonly highQualitySolverProperty: BooleanProperty;

  /**
   * Solver grid resolution. A cost/quality trade like the solver toggle: finer
   * grids resolve smaller vortices and thinner shear layers, at a proportional
   * cost in GPU memory and time each frame. It changes how much memory the
   * fields need, so it cannot ride along as a uniform the way the other
   * parameters do.
   */
  public readonly gridResolutionProperty: Property<GridResolution>;

  /**
   * Strength of the vorticity-confinement correction. A visual-fidelity knob
   * rather than a physics control — confinement restores the small-scale
   * vorticity that the grid damps away — so it lives in Preferences.
   */
  public readonly vorticityProperty: NumberProperty;

  /**
   * Fraction of dye remaining after one second. A display-lifetime knob rather
   * than a physics control — how long the tracer stays visible — so it lives in
   * Preferences.
   */
  public readonly dyeDissipationProperty: NumberProperty;

  public constructor(tandem?: Tandem) {
    this.highQualitySolverProperty = new BooleanProperty(
      fluidDynamicsQueryParameters.highQualitySolver,
      tandem ? { tandem: tandem.createTandem("highQualitySolverProperty") } : undefined,
    );
    // The query parameter's declared type is `string | null`, but its
    // validValues already constrain it to GRID_RESOLUTIONS at parse time (and
    // the defaultValue rules out null); the lookup narrows it for TypeScript.
    const initialResolution: GridResolution =
      GRID_RESOLUTIONS.find((resolution) => resolution === fluidDynamicsQueryParameters.gridResolution) ?? "standard";
    // Plain string union, so it instruments as StringIO for PhET-iO with the
    // union as validValues (NumberProperty/BooleanProperty infer their IO type;
    // a generic Property over strings does not).
    this.gridResolutionProperty = new Property<GridResolution>(initialResolution, {
      phetioValueType: StringIO,
      validValues: [...GRID_RESOLUTIONS],
      ...(tandem && { tandem: tandem.createTandem("gridResolutionProperty") }),
    });
    this.vorticityProperty = new NumberProperty(fluidDynamicsQueryParameters.vorticity, {
      range: VORTICITY_RANGE,
      ...(tandem && { tandem: tandem.createTandem("vorticityProperty") }),
    });
    this.dyeDissipationProperty = new NumberProperty(fluidDynamicsQueryParameters.dyeDissipation, {
      range: DYE_DISSIPATION_RANGE,
      ...(tandem && { tandem: tandem.createTandem("dyeDissipationProperty") }),
    });
  }

  public reset(): void {
    this.highQualitySolverProperty.reset();
    this.gridResolutionProperty.reset();
    this.vorticityProperty.reset();
    this.dyeDissipationProperty.reset();
  }
}

FluidDynamicsNamespace.register("FluidDynamicsPreferencesModel", FluidDynamicsPreferencesModel);
