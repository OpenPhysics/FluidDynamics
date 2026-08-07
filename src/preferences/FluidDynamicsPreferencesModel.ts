/**
 * FluidDynamicsPreferencesModel.ts
 *
 * Model for the simulation-specific preferences shown in Preferences →
 * Simulation. Each preference Property takes its initial value from the
 * corresponding query parameter in fluidDynamicsQueryParameters.
 */

import { BooleanProperty } from "scenerystack/axon";
import type { Tandem } from "scenerystack/tandem";
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

  public constructor(tandem?: Tandem) {
    this.highQualitySolverProperty = new BooleanProperty(
      fluidDynamicsQueryParameters.highQualitySolver,
      tandem ? { tandem: tandem.createTandem("highQualitySolverProperty") } : undefined,
    );
  }

  public reset(): void {
    this.highQualitySolverProperty.reset();
  }
}

FluidDynamicsNamespace.register("FluidDynamicsPreferencesModel", FluidDynamicsPreferencesModel);
