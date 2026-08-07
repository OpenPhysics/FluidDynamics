/**
 * LabModel.ts
 *
 * Model for the Lab screen: the same solver, with every parameter exposed.
 *
 * Identical in structure to IntroModel — the difference between the two screens
 * is entirely in which Properties the view builds controls for. Each screen owns
 * its own FluidModel instance (the fleet default), so changing the viscosity in
 * the Lab does not disturb the Intro screen's flow.
 */
import type { TModel } from "scenerystack/joist";
import { FluidModel } from "../../common/model/FluidModel.js";
import { TimeModel } from "../../common/TimeModel.js";
import type { FluidDynamicsPreferencesModel } from "../../preferences/FluidDynamicsPreferencesModel.js";

export class LabModel implements TModel {
  /** Flow parameters. All of them are exposed to the learner on this screen. */
  public readonly fluid = new FluidModel();

  /** Play/pause and elapsed time. Starts playing — a paused fluid shows nothing. */
  public readonly timer = new TimeModel(true);

  public constructor(preferences: FluidDynamicsPreferencesModel) {
    // Solver accuracy is a preference rather than a screen control, so the model
    // subscribes to it here instead of owning it.
    this.fluid.attachSolverQuality(preferences.highQualitySolverProperty);
  }

  public reset(): void {
    this.fluid.reset();
    this.timer.reset();
  }

  /** Advances the clock; the GPU solver is stepped from the view. */
  public step(dt: number): void {
    this.timer.step(dt);
  }

  public dispose(): void {
    this.timer.dispose();
    this.fluid.dispose();
  }
}
