/**
 * IntroScreenSummaryContent.ts
 *
 * The accessible screen summary read by screen readers. It appears at the top of
 * the parallel DOM and gives a non-visual user a way to orient themselves and to
 * re-read the simulation's current state at any time.
 *
 * `currentDetailsContent` is the live description built by
 * common/view/fluidDescription.ts — the same Property the fluid field uses as
 * its accessible paragraph, so the summary and the field always agree about what
 * the flow is doing.
 */
import type { TReadOnlyProperty } from "scenerystack/axon";
import { ScreenSummaryContent } from "scenerystack/sim";
import { StringManager } from "../../i18n/StringManager.js";

export class IntroScreenSummaryContent extends ScreenSummaryContent {
  public constructor(fluidDescriptionProperty: TReadOnlyProperty<string>) {
    const a11y = StringManager.getInstance().getIntroA11yStrings();

    super({
      playAreaContent: a11y.screenSummary.playAreaStringProperty,
      controlAreaContent: a11y.screenSummary.controlAreaStringProperty,
      currentDetailsContent: fluidDescriptionProperty,
      interactionHintContent: a11y.screenSummary.interactionHintStringProperty,
    });
  }
}
