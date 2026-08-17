/**
 * IntroKeyboardHelpContent.ts
 *
 * Content for the keyboard-help dialog (the "?" button in the navigation bar).
 *
 * The Intro screen's obstacle is a cylinder, which has no chord to tilt, no foci
 * to pull and no thickness to change, and its panel holds one slider and no
 * combo box — so both of FluidKeyboardHelpContent's optional groups are off.
 * Everything else (resizing the body, dragging it and the tools, the sliders,
 * the time controls) is identical to the Lab screen and documented there.
 */

import { FluidKeyboardHelpContent } from "../../common/view/FluidKeyboardHelpContent.js";

export class IntroKeyboardHelpContent extends FluidKeyboardHelpContent {
  public constructor() {
    super({ showShapingControls: false, showComboBoxControls: false });
  }
}
