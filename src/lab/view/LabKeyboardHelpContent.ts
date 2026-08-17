/**
 * LabKeyboardHelpContent.ts
 *
 * Content for the keyboard-help dialog (the "?" button in the navigation bar).
 *
 * The Lab screen exposes every interaction the sim has, so both of
 * FluidKeyboardHelpContent's optional groups are on: the shaping handles
 * (tilt, the ellipse's foci, the airfoil's thickness) and the two combo boxes.
 */

import { FluidKeyboardHelpContent } from "../../common/view/FluidKeyboardHelpContent.js";

export class LabKeyboardHelpContent extends FluidKeyboardHelpContent {
  public constructor() {
    super({ showShapingControls: true, showComboBoxControls: true });
  }
}
