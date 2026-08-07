/**
 * IntroModel.ts
 *
 * Model for the Intro screen: flow past a fixed cylinder, with a single control.
 *
 * The Intro screen exists to make one relationship visible — raise the flow
 * speed and the wake goes from smooth, to a periodic Kármán vortex street, to
 * turbulent. Everything that would dilute that (viscosity, obstacle shape and
 * position, visualization mode, grid resolution) is left at its default here and
 * exposed on the Lab screen instead. They are still real Properties on the
 * shared FluidModel, so the view and the solver treat both screens identically.
 */
import type { TModel } from "scenerystack/joist";
import { FluidModel } from "../../common/model/FluidModel.js";
import { TimeModel } from "../../common/TimeModel.js";
import type { FluidDynamicsPreferencesModel } from "../../preferences/FluidDynamicsPreferencesModel.js";

export class IntroModel implements TModel {
  /** Flow parameters. Only flowSpeedProperty is exposed to the learner here. */
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

  /**
   * Steps the model forward by dt seconds.
   *
   * Only the clock advances here. The fluid state lives in GPU textures and is
   * advanced by WebGPUFluidEngine from the view's step, which is the only place
   * with access to a device — see doc/implementation-notes.md.
   */
  public step(dt: number): void {
    this.timer.step(dt);
  }

  public dispose(): void {
    this.timer.dispose();
    this.fluid.dispose();
  }
}
