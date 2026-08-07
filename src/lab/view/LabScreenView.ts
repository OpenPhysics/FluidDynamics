/**
 * LabScreenView.ts
 *
 * The Lab screen: the same solver, with every parameter exposed.
 *
 * Differs from the Intro screen only in `showFullControls`, which adds the
 * viscosity, obstacle size, vortex-detail and dye-fade sliders, the obstacle
 * shape, visualization and grid pickers, and a draggable obstacle.
 */

import { combineOptions } from "scenerystack/phet-core";
import type { ScreenViewOptions } from "scenerystack/sim";
import { FluidScreenView, type FluidScreenViewOptions } from "../../common/view/FluidScreenView.js";
import { createFluidDescriptionProperty } from "../../common/view/fluidDescription.js";
import type { LabModel } from "../model/LabModel.js";
import { LabScreenSummaryContent } from "./LabScreenSummaryContent.js";

export type LabScreenViewOptions = ScreenViewOptions;

export class LabScreenView extends FluidScreenView {
  public constructor(model: LabModel, providedOptions?: LabScreenViewOptions) {
    const descriptionProperty = createFluidDescriptionProperty(model.fluid);

    // combineOptions rather than optionize: this class adds no options of its
    // own, it only supplies defaults for the base class's.
    const options = combineOptions<FluidScreenViewOptions>(
      {
        screenSummaryContent: new LabScreenSummaryContent(descriptionProperty),
        showFullControls: true,
      },
      providedOptions,
    );

    super(model.fluid, model.timer, descriptionProperty, options);
  }
}
