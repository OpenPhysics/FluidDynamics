/**
 * FluidScreenView.ts
 *
 * Layout and wiring shared by both screens.
 *
 * The Intro and Lab screens run the same solver over the same model and differ
 * only in how many of its parameters they expose, so the arrangement — field on
 * the left, readout beneath it, controls in a column on the right, time controls
 * and Reset All along the bottom — is defined once here. Each screen supplies
 * its own screen-summary content and sets `showFullControls`.
 *
 * ── Stepping ──────────────────────────────────────────────────────────────────
 * step() advances the GPU solver and nothing else. joist already steps the
 * active screen's model, so calling model.step() here would run the clock twice
 * as fast.
 */

import type { TReadOnlyProperty } from "scenerystack/axon";
import { optionize } from "scenerystack/phet-core";
import { Node } from "scenerystack/scenery";
import { ResetAllButton, TimeControlNode } from "scenerystack/scenery-phet";
import { ScreenView, type ScreenViewOptions } from "scenerystack/sim";
import { CONTROL_PANEL_WIDTH, FIELD_VIEW_BOUNDS, SCREEN_VIEW_MARGIN } from "../../FluidDynamicsConstants.js";
import {
  FLAT_PLAY_PAUSE_STEP_BUTTON_OPTIONS,
  FLAT_RESET_ALL_BUTTON_OPTIONS,
  TIME_CONTROL_SPEED_RADIO_OPTIONS,
} from "../FluidDynamicsButtonOptions.js";
import type { FluidModel } from "../model/FluidModel.js";
import { TIME_SPEEDS, type TimeModel } from "../TimeModel.js";
import { FlowReadoutNode } from "./FlowReadoutNode.js";
import { FluidControlPanel } from "./FluidControlPanel.js";
import { FluidFieldNode } from "./FluidFieldNode.js";
import { ObstacleHandleNode } from "./ObstacleHandleNode.js";
import { ToolboxPanel } from "./ToolboxPanel.js";
import { WebGPUUnavailableNode } from "./WebGPUUnavailableNode.js";

type SelfOptions = {
  /** Show viscosity, obstacle, visualization and grid controls (the Lab screen). */
  readonly showFullControls?: boolean;
};

export type FluidScreenViewOptions = SelfOptions & ScreenViewOptions;

export class FluidScreenView extends ScreenView {
  /** Live description of the flow, shared with the screen summary. */
  public readonly fluidDescriptionProperty: TReadOnlyProperty<string>;

  private readonly fluidFieldNode: FluidFieldNode;
  private readonly disposers: (() => void)[] = [];

  public constructor(
    model: FluidModel,
    timer: TimeModel,
    fluidDescriptionProperty: TReadOnlyProperty<string>,
    providedOptions: FluidScreenViewOptions,
  ) {
    const options = optionize<FluidScreenViewOptions, SelfOptions, ScreenViewOptions>()(
      { showFullControls: false },
      providedOptions,
    );
    super(options);

    this.fluidDescriptionProperty = fluidDescriptionProperty;

    // ── Fluid field ───────────────────────────────────────────────────────────
    // The solver needs a GPUDevice, which arrives asynchronously. Until it does,
    // the field paints nothing and the unavailable message stays hidden, so a
    // successful start never flashes an error.
    this.fluidFieldNode = new FluidFieldNode(
      model,
      timer.isPlayingProperty,
      timer.timeSpeedProperty,
      FIELD_VIEW_BOUNDS,
      {
        accessibleParagraph: fluidDescriptionProperty,
      },
    );
    this.addChild(this.fluidFieldNode);

    // Above the field, so a press on the body moves it instead of stirring the
    // fluid. Only on the Lab screen: the Intro screen is about one variable.
    const obstacleHandle = options.showFullControls
      ? new ObstacleHandleNode(
          model.obstacleCenterProperty,
          model.obstacleDiameterProperty,
          this.fluidFieldNode.modelViewTransform,
        )
      : null;
    if (obstacleHandle !== null) {
      this.addChild(obstacleHandle);
    }

    this.addChild(new WebGPUUnavailableNode(this.fluidFieldNode.gpuUnavailableReasonProperty, FIELD_VIEW_BOUNDS));

    // ── Reynolds number and regime ────────────────────────────────────────────
    const readout = new FlowReadoutNode(model, {
      left: FIELD_VIEW_BOUNDS.minX,
      top: FIELD_VIEW_BOUNDS.maxY + 14,
    });
    this.addChild(readout);

    // ── Controls ──────────────────────────────────────────────────────────────
    // The combo-box list has to be drawn above everything else, so it lives in a
    // dedicated parent added last.
    const comboBoxListParent = new Node();

    const controlPanel = new FluidControlPanel(model, comboBoxListParent, {
      showFullControls: options.showFullControls,
      minWidth: CONTROL_PANEL_WIDTH,
      right: this.layoutBounds.maxX - SCREEN_VIEW_MARGIN,
      top: FIELD_VIEW_BOUNDS.minY,
    });
    this.addChild(controlPanel);

    const timeControl = new TimeControlNode(timer.isPlayingProperty, {
      timeSpeedProperty: timer.timeSpeedProperty,
      timeSpeeds: TIME_SPEEDS,
      ...TIME_CONTROL_SPEED_RADIO_OPTIONS,
      playPauseStepButtonOptions: {
        ...FLAT_PLAY_PAUSE_STEP_BUTTON_OPTIONS,
        stepForwardButtonOptions: {
          listener: () => {
            timer.step(1 / 60);
            this.fluidFieldNode.stepOnce(1 / 60);
          },
        },
      },
      centerX: FIELD_VIEW_BOUNDS.centerX,
      bottom: this.layoutBounds.maxY - SCREEN_VIEW_MARGIN,
    });
    this.addChild(timeControl);

    const resetAllButton = new ResetAllButton({
      ...FLAT_RESET_ALL_BUTTON_OPTIONS,
      listener: () => {
        model.reset();
        timer.reset();
        this.reset();
      },
      right: this.layoutBounds.maxX - SCREEN_VIEW_MARGIN,
      bottom: this.layoutBounds.maxY - SCREEN_VIEW_MARGIN,
    });
    this.addChild(resetAllButton);

    // ── Measurement tools ────────────────────────────────────────────────────
    // The toolbox is a panel like any other; the tools it owns are not its
    // children but siblings added here, so a ruler dragged across the control
    // panel floats above it rather than sliding underneath.
    const toolboxPanel = new ToolboxPanel(model, {
      modelViewTransform: this.fluidFieldNode.modelViewTransform,
      screenViewBounds: this.layoutBounds,
      globalToViewPoint: (globalPoint) => this.globalToLocalPoint(globalPoint),
      left: FIELD_VIEW_BOUNDS.minX,
      bottom: this.layoutBounds.maxY - SCREEN_VIEW_MARGIN,
    });
    this.addChild(toolboxPanel);
    this.addChild(toolboxPanel.measuringTapeNode);
    this.addChild(toolboxPanel.rulerNode);

    // Linked only now that the tools are in the scene graph: a node that is
    // already invisible when it is added never populates its pdomDisplays, and
    // its parallel-DOM content stays hidden for good. The links fire
    // immediately (tools start in the toolbox), hiding through the same path
    // every later show retraces.
    const tapeVisibleListener = (visible: boolean): void => {
      toolboxPanel.measuringTapeNode.visible = visible;
    };
    model.measuringTapeVisibleProperty.link(tapeVisibleListener);
    const rulerVisibleListener = (visible: boolean): void => {
      toolboxPanel.rulerNode.visible = visible;
    };
    model.rulerVisibleProperty.link(rulerVisibleListener);

    this.addChild(comboBoxListParent);

    // ── Keyboard / reading traversal order ────────────────────────────────────
    // Explicit and independent of z-order: the field first (it is the thing the
    // screen is about), then the obstacle, then the toolbox and any tools out
    // of it, then the controls top to bottom, with the time controls and Reset
    // All last.
    this.addChild(
      new Node({
        pdomOrder: [
          this.fluidFieldNode,
          obstacleHandle,
          toolboxPanel.tapeIconNode,
          toolboxPanel.rulerIconNode,
          toolboxPanel.measuringTapeNode,
          toolboxPanel.rulerNode,
          ...controlPanel.controlsInOrder,
          timeControl,
          resetAllButton,
        ],
      }),
    );

    this.disposers.push(() => {
      model.rulerVisibleProperty.unlink(rulerVisibleListener);
      model.measuringTapeVisibleProperty.unlink(tapeVisibleListener);
      toolboxPanel.dispose();
      controlPanel.dispose();
      readout.dispose();
      obstacleHandle?.dispose();
      this.fluidFieldNode.dispose();
    });
  }

  /** Resets view-side state. The model is reset by the caller. */
  public reset(): void {
    this.fluidFieldNode.reset();
  }

  /**
   * Advances the GPU solver. Deliberately does not step the model: joist already
   * does that for the active screen.
   */
  public override step(dt: number): void {
    this.fluidFieldNode.update(dt);
  }

  /**
   * Releases the subscriptions the screen created.
   *
   * Does not call super.dispose(): joist's ScreenView is intentionally
   * non-disposable, and its setPDOMOrder override throws during ParallelDOM
   * teardown. The subscription surface is what fuzz and unit tests need
   * released; the ScreenView shell itself lives as long as the sim.
   */
  public override dispose(): void {
    for (const disposer of this.disposers.splice(0)) {
      disposer();
    }
  }
}
