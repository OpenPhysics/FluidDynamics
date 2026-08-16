/**
 * FluidScaleBarNode.ts
 *
 * The map-legend scale bar at the end of the readout row: |—–—| 0.1 m.
 *
 * The field never zooms, so a fixed-length bar is always honest — but its
 * pixels are derived from the field's model-view transform (the same rule the
 * ruler's ticks follow), so it can never drift out of step with the channel
 * either. Purely decorative chrome: not pickable, and like the Reynolds
 * readout it carries no parallel-DOM content — a screen-reader user measures
 * with the ruler instead.
 */

import { DerivedProperty } from "scenerystack/axon";
import { type EmptySelfOptions, optionize } from "scenerystack/phet-core";
import { type ModelViewTransform2, StringUtils } from "scenerystack/phetcommon";
import { Line, Node, type NodeOptions, Text } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import FluidDynamicsColors from "../../FluidDynamicsColors.js";
import {
  CONTROL_LABEL_FONT_SIZE,
  SCALE_BAR_LABEL_GAP_PX,
  SCALE_BAR_LENGTH_M,
  SCALE_BAR_STROKE_WIDTH_PX,
  SCALE_BAR_TICK_HEIGHT_PX,
} from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";

export type FluidScaleBarNodeOptions = NodeOptions;

export class FluidScaleBarNode extends Node {
  private readonly disposeFluidScaleBarNode: () => void;

  /**
   * @param modelViewTransform   the field's model↔view transform
   */
  public constructor(modelViewTransform: ModelViewTransform2, providedOptions?: FluidScaleBarNodeOptions) {
    const strings = StringManager.getInstance().getFluidStrings();

    // The value follows the constant, so shortening the bar relabels it.
    const labelStringProperty = new DerivedProperty([strings.controls.scaleBarPatternStringProperty], (pattern) =>
      StringUtils.fillIn(pattern, { value: SCALE_BAR_LENGTH_M.toFixed(1) }),
    );
    const label = new Text(labelStringProperty, {
      font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
      fill: FluidDynamicsColors.textColorProperty,
    });

    const barLength = Math.abs(modelViewTransform.modelToViewDeltaX(SCALE_BAR_LENGTH_M));
    const strokeOptions = {
      stroke: FluidDynamicsColors.textColorProperty,
      lineWidth: SCALE_BAR_STROKE_WIDTH_PX,
    };
    const halfTick = SCALE_BAR_TICK_HEIGHT_PX / 2;

    const options = optionize<FluidScaleBarNodeOptions, EmptySelfOptions, NodeOptions>()(
      {
        pickable: false,
        children: [
          new Line(0, 0, barLength, 0, strokeOptions),
          new Line(0, -halfTick, 0, halfTick, strokeOptions),
          new Line(barLength, -halfTick, barLength, halfTick, strokeOptions),
          // Half height, so the bar reads as a scale rather than a stray dash.
          new Line(barLength / 2, -halfTick / 2, barLength / 2, halfTick / 2, strokeOptions),
          label,
        ],
      },
      providedOptions,
    );
    super(options);

    label.left = barLength + SCALE_BAR_LABEL_GAP_PX;
    label.centerY = 0;

    this.disposeFluidScaleBarNode = () => {
      label.dispose();
      labelStringProperty.dispose();
    };
  }

  public override dispose(): void {
    this.disposeFluidScaleBarNode();
    super.dispose();
  }
}
