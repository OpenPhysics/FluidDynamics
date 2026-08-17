/**
 * FluidDynamicsPreferencesNode.ts
 *
 * Custom preferences UI shown in Preferences → Simulation. Controls are bound
 * to FluidDynamicsPreferencesModel Properties (whose initial values come from
 * fluidDynamicsQueryParameters).
 */

import { DerivedProperty, type NumberProperty, type TReadOnlyProperty } from "scenerystack/axon";
import { Dimension2, type Range, toFixed } from "scenerystack/dot";
import { HBox, Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { Checkbox, HSlider, VerticalAquaRadioButtonGroup } from "scenerystack/sun";
import type { Tandem } from "scenerystack/tandem";
import { GRID_RESOLUTIONS, type GridResolution } from "../common/gpu/FluidGridSpec.js";
import FluidDynamicsColors from "../FluidDynamicsColors.js";
import {
  CONTROL_LABEL_FONT_SIZE,
  DYE_DISSIPATION_RANGE,
  PREFERENCE_SLIDER_TRACK_LENGTH_PX,
  PREFERENCES_HEADING_FONT_SIZE,
  SLIDER_THUMB_SIZE,
  SLIDER_THUMB_TOUCH_DILATION_X_PX,
  SLIDER_THUMB_TOUCH_DILATION_Y_PX,
  SLIDER_TRACK_HEIGHT_PX,
  VORTICITY_RANGE,
} from "../FluidDynamicsConstants.js";
import FluidDynamicsNamespace from "../FluidDynamicsNamespace.js";
import { StringManager } from "../i18n/StringManager.js";
import type { FluidDynamicsPreferencesModel } from "./FluidDynamicsPreferencesModel.js";

export class FluidDynamicsPreferencesNode extends VBox {
  public constructor(preferencesModel: FluidDynamicsPreferencesModel, tandem?: Tandem) {
    const prefStrings = StringManager.getInstance().getPreferences();
    const fluidStrings = StringManager.getInstance().getFluidStrings();
    const a11y = StringManager.getInstance().getFluidA11yStrings();

    // The Preferences dialog is always white, so use the dark "light control
    // surface" colors (readable on white in both default and projector
    // profiles), not textColorProperty (which is near-white in default mode and
    // would be invisible on the white dialog).
    const header = new Text(prefStrings.titleStringProperty, {
      font: new PhetFont({ size: PREFERENCES_HEADING_FONT_SIZE, weight: "bold" }),
      fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
    });

    const highQualitySolverCheckbox = new Checkbox(
      preferencesModel.highQualitySolverProperty,
      new Text(prefStrings.highQualitySolverStringProperty, {
        font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
        fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
      }),
      {
        checkboxColor: FluidDynamicsColors.controlSurfaceTextColorProperty,
        checkboxColorBackground: FluidDynamicsColors.controlSurfaceColorProperty,
        spacing: 8,
        ...(tandem && { tandem: tandem.createTandem("highQualitySolverCheckbox") }),
      },
    );

    // Both sliders are dimensionless, like their former panel-slider selves:
    // no unit to append, just the bare number.
    const vorticityBox = createPreferenceSlider(preferencesModel.vorticityProperty, VORTICITY_RANGE, 0, {
      label: prefStrings.vorticityStringProperty,
      accessibleName: a11y.vorticityStringProperty,
    });
    const dyeFadeBox = createPreferenceSlider(preferencesModel.dyeDissipationProperty, DYE_DISSIPATION_RANGE, 2, {
      label: prefStrings.dyeFadeStringProperty,
      accessibleName: a11y.dyeFadeStringProperty,
    });

    // Written out rather than looked up by key, so adding a member to the
    // as-const union in common/gpu/FluidGridSpec.ts fails to compile until it
    // has a label.
    const resolutionLabels: Record<GridResolution, TReadOnlyProperty<string>> = {
      standard: fluidStrings.resolutions.standardStringProperty,
      fine: fluidStrings.resolutions.fineStringProperty,
      veryFine: fluidStrings.resolutions.veryFineStringProperty,
      ultraFine: fluidStrings.resolutions.ultraFineStringProperty,
    };
    const resolutionGroup = new VerticalAquaRadioButtonGroup<GridResolution>(
      preferencesModel.gridResolutionProperty,
      GRID_RESOLUTIONS.map((resolution) => ({
        value: resolution,
        createNode: () =>
          new Text(resolutionLabels[resolution], {
            font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
            fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
          }),
      })),
      {
        accessibleName: a11y.resolutionStringProperty,
        spacing: 4,
        ...(tandem && { tandem: tandem.createTandem("resolutionRadioButtonGroup") }),
      },
    );
    const resolutionBox = new VBox({
      spacing: 4,
      align: "left",
      children: [
        new Text(prefStrings.gridResolutionStringProperty, {
          font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
          fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
        }),
        resolutionGroup,
      ],
    });

    super({
      align: "left",
      spacing: 12,
      children: [header, highQualitySolverCheckbox, vorticityBox, dyeFadeBox, resolutionBox],
      // Nothing built above is torn down, and that is deliberate rather than an
      // oversight: PreferencesModel calls createContent() once and the dialog it
      // builds lives as long as the sim, so there is no moment at which this
      // node would be disposed. Declaring it makes that a contract instead of a
      // reader's assumption — a stray dispose() now asserts rather than quietly
      // leaving the sliders' DerivedProperties listening to the preferences.
      isDisposable: false,
    });
  }
}

FluidDynamicsNamespace.register("FluidDynamicsPreferencesNode", FluidDynamicsPreferencesNode);

/** Options for {@link createPreferenceSlider}. */
type PreferenceSliderOptions = {
  label: TReadOnlyProperty<string>;
  accessibleName: TReadOnlyProperty<string>;
};

/**
 * A label-and-value line above a slider track, laid out like the panel sliders
 * these were promoted from. Dimensionless: the value shows as a bare number.
 */
function createPreferenceSlider(
  property: NumberProperty,
  range: Range,
  decimals: number,
  options: PreferenceSliderOptions,
): VBox {
  const valueStringProperty = new DerivedProperty([property], (value) => toFixed(value, decimals));

  const slider = new HSlider(property, range, {
    trackSize: PREFERENCE_SLIDER_TRACK_SIZE,
    thumbSize: SLIDER_THUMB_SIZE,
    // Same touch dilation as the panel sliders, for the same reason.
    thumbTouchAreaXDilation: SLIDER_THUMB_TOUCH_DILATION_X_PX,
    thumbTouchAreaYDilation: SLIDER_THUMB_TOUCH_DILATION_Y_PX,
    accessibleName: options.accessibleName,
    // Twenty steps across the range, matching the keyboard feel of the panel
    // sliders this was promoted from.
    keyboardStep: range.getLength() / 20,
    shiftKeyboardStep: range.getLength() / 100,
    pageKeyboardStep: range.getLength() / 5,
  });

  return new VBox({
    spacing: 4,
    align: "left",
    children: [
      new HBox({
        children: [
          new Text(options.label, {
            font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
            fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
          }),
          new Text(valueStringProperty, {
            font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
            fill: FluidDynamicsColors.controlSurfaceTextColorProperty,
          }),
        ],
        spacing: 8,
        justify: "spaceBetween",
      }),
      slider,
    ],
  });
}

const PREFERENCE_SLIDER_TRACK_SIZE = new Dimension2(PREFERENCE_SLIDER_TRACK_LENGTH_PX, SLIDER_TRACK_HEIGHT_PX);
