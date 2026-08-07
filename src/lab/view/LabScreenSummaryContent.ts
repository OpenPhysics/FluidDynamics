/**
 * LabScreenSummaryContent.ts
 *
 * The accessible screen summary for the Lab screen. Same structure as the Intro
 * screen's, with its own play-area and control-area text: the Lab screen has a
 * far larger control set to describe.
 */
import type { TReadOnlyProperty } from "scenerystack/axon";
import { ScreenSummaryContent } from "scenerystack/sim";
import { StringManager } from "../../i18n/StringManager.js";

export class LabScreenSummaryContent extends ScreenSummaryContent {
  public constructor(fluidDescriptionProperty: TReadOnlyProperty<string>) {
    const a11y = StringManager.getInstance().getLabA11yStrings();

    super({
      playAreaContent: a11y.screenSummary.playAreaStringProperty,
      controlAreaContent: a11y.screenSummary.controlAreaStringProperty,
      currentDetailsContent: fluidDescriptionProperty,
      interactionHintContent: a11y.screenSummary.interactionHintStringProperty,
    });
  }
}
