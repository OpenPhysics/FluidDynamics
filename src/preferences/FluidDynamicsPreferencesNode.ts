/**
 * FluidDynamicsPreferencesNode.ts
 *
 * Custom preferences UI shown in Preferences → Simulation. Controls are bound
 * to FluidDynamicsPreferencesModel Properties (whose initial values come from
 * fluidDynamicsQueryParameters).
 */

import { Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { Checkbox } from "scenerystack/sun";
import type { Tandem } from "scenerystack/tandem";
import FluidDynamicsColors from "../FluidDynamicsColors.js";
import FluidDynamicsNamespace from "../FluidDynamicsNamespace.js";
import { StringManager } from "../i18n/StringManager.js";
import type { FluidDynamicsPreferencesModel } from "./FluidDynamicsPreferencesModel.js";

export class FluidDynamicsPreferencesNode extends VBox {
  public constructor(preferencesModel: FluidDynamicsPreferencesModel, tandem?: Tandem) {
    const prefStrings = StringManager.getInstance().getPreferences();

    // The Preferences dialog is always white, so use the dark "light control surface"
    // colors (readable on white in both default and projector profiles), not textColorProperty
    // (which is near-white in default mode and would be invisible on the white dialog).
    const header = new Text(prefStrings.titleStringProperty, {
      font: new PhetFont({ size: 18, weight: "bold" }),
      fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
    });

    const exampleToggleCheckbox = new Checkbox(
      preferencesModel.exampleToggleProperty,
      new Text(prefStrings.exampleToggleStringProperty, {
        font: new PhetFont(14),
        fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
      }),
      {
        checkboxColor: FluidDynamicsColors.controlSurfaceTextColorProperty,
        checkboxColorBackground: FluidDynamicsColors.controlSurfaceColorProperty,
        spacing: 8,
        ...(tandem && { tandem: tandem.createTandem("exampleToggleCheckbox") }),
      },
    );

    super({
      align: "left",
      spacing: 12,
      children: [header, exampleToggleCheckbox],
    });
  }
}

FluidDynamicsNamespace.register("FluidDynamicsPreferencesNode", FluidDynamicsPreferencesNode);
