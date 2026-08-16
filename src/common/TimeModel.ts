/**
 * TimeModel.ts
 *
 * A reusable, composable timing model for simulations that need play/pause and
 * elapsed-time tracking. Compose it into your screen model rather than
 * extending it.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   // In YourModel.ts
 *   import { TimeModel } from "../../common/TimeModel.js";
 *
 *   export class YourModel implements TModel {
 *     public readonly timer = new TimeModel();
 *
 *     public step( dt: number ): void {
 *       this.timer.step( dt );
 *       // use this.timer.timeProperty.value for physics calculations
 *     }
 *
 *     public reset(): void {
 *       this.timer.reset();
 *       // reset other state …
 *     }
 *   }
 *
 * ── View wiring ───────────────────────────────────────────────────────────────
 *
 *   SceneryStack ships a TimeControlNode that binds directly to isPlayingProperty:
 *
 *   import { TimeControlNode } from "scenerystack/scenery-phet";
 *
 *   const timeControl = new TimeControlNode( model.timer.isPlayingProperty, {
 *     playPauseStepButtonOptions: {
 *       stepForwardButtonOptions: {
 *         listener: () => model.step( 1 / 60 ),
 *       },
 *     },
 *   });
 *
 * ── Start paused vs. playing ──────────────────────────────────────────────────
 *
 *   new TimeModel()           // starts paused  (most physics sims)
 *   new TimeModel( true )     // starts playing  (continuous animations)
 */

import { BooleanProperty, EnumerationProperty, NumberProperty } from "scenerystack/axon";
import { TimeSpeed } from "scenerystack/scenery-phet";

/** Selectable speeds, in radio-group display order. */
export const TIME_SPEEDS: TimeSpeed[] = [TimeSpeed.SLOW, TimeSpeed.NORMAL, TimeSpeed.FAST];

/** Simulation seconds advanced per wall-clock second, per playback speed. */
export function timeSpeedMultiplier(speed: TimeSpeed): number {
  switch (speed) {
    case TimeSpeed.SLOW:
      return 0.25;
    case TimeSpeed.FAST:
      return 2;
    default:
      return 1; // TimeSpeed.NORMAL
  }
}

export class TimeModel {
  /** Whether the simulation clock is running. Bind to TimeControlNode. */
  public readonly isPlayingProperty: BooleanProperty;

  /** Playback speed. Bind to TimeControlNode's speed radio group. */
  public readonly timeSpeedProperty: EnumerationProperty<TimeSpeed>;

  /** Elapsed simulation time in seconds. Resets to 0 on reset(). */
  public readonly timeProperty: NumberProperty;

  public constructor(initiallyPlaying = false) {
    this.isPlayingProperty = new BooleanProperty(initiallyPlaying);
    this.timeSpeedProperty = new EnumerationProperty(TimeSpeed.NORMAL, { enumeration: TimeSpeed.enumeration });
    this.timeProperty = new NumberProperty(0, { units: "s" });
  }

  /**
   * Advance the simulation clock by dt seconds of wall-clock time, scaled by the
   * current playback speed. Call this from your model's step() method.
   */
  public step(dt: number): void {
    if (this.isPlayingProperty.value) {
      this.timeProperty.value += dt * timeSpeedMultiplier(this.timeSpeedProperty.value);
    }
  }

  /** Resets clock and playback state to their initial values. */
  public reset(): void {
    this.isPlayingProperty.reset();
    this.timeSpeedProperty.reset();
    this.timeProperty.reset();
  }

  /** Call when the model is no longer needed to free AXON listeners. */
  public dispose(): void {
    this.isPlayingProperty.dispose();
    this.timeSpeedProperty.dispose();
    this.timeProperty.dispose();
  }
}
