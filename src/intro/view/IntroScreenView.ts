/**
 * IntroScreenView.ts
 *
 * The Intro screen: flow past a fixed cylinder, with one control.
 *
 * Layout, stepping and accessibility all come from FluidScreenView; the only
 * thing decided here is that the full control set is withheld. That is the whole
 * design of the screen — a learner should be able to move one slider and watch
 * the wake go from smooth, to a periodic vortex street, to turbulent, without
 * six other parameters competing for the explanation.
 */

import { combineOptions } from "scenerystack/phet-core";
import type { ScreenViewOptions } from "scenerystack/sim";
import { FluidScreenView, type FluidScreenViewOptions } from "../../common/view/FluidScreenView.js";
import { createFluidDescriptionProperty } from "../../common/view/fluidDescription.js";
import type { IntroModel } from "../model/IntroModel.js";
import { IntroScreenSummaryContent } from "./IntroScreenSummaryContent.js";

export type IntroScreenViewOptions = ScreenViewOptions;

export class IntroScreenView extends FluidScreenView {
  public constructor(model: IntroModel, providedOptions?: IntroScreenViewOptions) {
    // One description Property serves both the field's accessible paragraph and
    // the screen summary's live "current details", so the two cannot drift.
    const descriptionProperty = createFluidDescriptionProperty(model.fluid);

    // combineOptions rather than optionize: this class adds no options of its
    // own, it only supplies defaults for the base class's.
    const options = combineOptions<FluidScreenViewOptions>(
      {
        screenSummaryContent: new IntroScreenSummaryContent(descriptionProperty),
        showFullControls: false,
      },
      providedOptions,
    );

    super(model.fluid, model.timer, descriptionProperty, options);
  }
}
