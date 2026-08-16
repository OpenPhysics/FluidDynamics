/**
 * FluidControlPanel.ts
 *
 * The control panel, shared by both screens.
 *
 * Which controls appear is an option rather than a subclass: the Intro and Lab
 * screens run the identical solver over the identical FluidModel, and differ
 * only in how much of it they expose. Intro shows flow speed alone, so the one
 * relationship it is about — speed up the flow and the wake goes unstable —
 * is not competing with the other sliders.
 *
 * The obstacle's size and angle of attack are deliberately absent from this
 * panel: they are direct-manipulation quantities, changed by dragging the
 * handles on the body itself (see ObstacleSizeAngleHandleNode and friends),
 * and a slider duplicating them would be a second, competing interface.
 *
 * Sliders are hand-laid-out (label and value on one line, track below) rather
 * than NumberControls. A NumberControl carries a title, arrow buttons and a
 * number display and runs about 70 px tall; the panel's controls do not fit
 * beside a 350 px field, and the arrow buttons buy nothing for parameters that
 * are explored by sweeping rather than by setting an exact value.
 *
 * Vortex detail, dye fade and grid resolution used to live here; all three are
 * display/quality knobs rather than physics controls, so they were promoted to
 * Preferences → Simulation (see FluidDynamicsPreferencesNode).
 */

import { DerivedProperty, type NumberProperty, type Property, type TReadOnlyProperty } from "scenerystack/axon";
import { Dimension2, type Range } from "scenerystack/dot";
import { optionize } from "scenerystack/phet-core";
import { StringUtils } from "scenerystack/phetcommon";
import { HBox, type Node, Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { ComboBox, HSlider } from "scenerystack/sun";
import FluidDynamicsColors from "../../FluidDynamicsColors.js";
import {
  CONTROL_LABEL_FONT_SIZE,
  CONTROL_PANEL_WIDTH,
  FLOW_SPEED_RANGE,
  VISCOSITY_RANGE,
} from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";
import { FLUID_DYNAMICS_COMBO_BOX_OPTIONS, LIGHT_SURFACE_TEXT_FILL } from "../FluidDynamicsButtonOptions.js";
import { FluidDynamicsPanel, type FluidDynamicsPanelOptions } from "../FluidDynamicsPanel.js";
import type { FluidModel } from "../model/FluidModel.js";
import { LAB_OBSTACLE_SHAPES, type ObstacleShape } from "../model/ObstacleShape.js";
import { VISUALIZATION_MODES, type VisualizationMode } from "../model/VisualizationMode.js";

type SelfOptions = {
  /** Viscosity, obstacle shape and the visualization picker. */
  readonly showFullControls?: boolean;
};

export type FluidControlPanelOptions = SelfOptions & FluidDynamicsPanelOptions;

export class FluidControlPanel extends FluidDynamicsPanel {
  /** Every interactive node, in the order a keyboard user should reach them. */
  public readonly controlsInOrder: Node[];

  private readonly disposeFluidControlPanel: () => void;

  public constructor(model: FluidModel, listParent: Node, providedOptions?: FluidControlPanelOptions) {
    const options = optionize<FluidControlPanelOptions, SelfOptions, FluidDynamicsPanelOptions>()(
      { showFullControls: false },
      providedOptions,
    );

    const strings = StringManager.getInstance().getFluidStrings();
    const a11y = StringManager.getInstance().getFluidA11yStrings();

    // Written out rather than looked up by key, so adding a member to any of the
    // as-const unions in common/model/ fails to compile until it has a label.
    const shapeLabels: Record<ObstacleShape, TReadOnlyProperty<string>> = {
      none: strings.shapes.noneStringProperty,
      cylinder: strings.shapes.cylinderStringProperty,
      plate: strings.shapes.plateStringProperty,
      airfoil: strings.shapes.airfoilStringProperty,
      ellipse: strings.shapes.ellipseStringProperty,
    };
    const visualizationLabels: Record<VisualizationMode, TReadOnlyProperty<string>> = {
      dye: strings.visualizations.dyeStringProperty,
      speed: strings.visualizations.speedStringProperty,
      vorticity: strings.visualizations.vorticityStringProperty,
      pressure: strings.visualizations.pressureStringProperty,
    };
    const disposers: (() => void)[] = [];
    const controls: Node[] = [];

    const slider = (
      property: NumberProperty,
      range: Range,
      label: TReadOnlyProperty<string>,
      valuePattern: TReadOnlyProperty<string>,
      decimals: number,
      accessibleName: TReadOnlyProperty<string>,
      accessibleHelpText?: TReadOnlyProperty<string>,
    ): Node => {
      const built = createSlider(property, range, label, valuePattern, decimals, accessibleName, accessibleHelpText);
      disposers.push(built.dispose);
      controls.push(built.slider);
      return built.node;
    };

    const children: Node[] = [
      slider(
        model.flowSpeedProperty,
        FLOW_SPEED_RANGE,
        strings.controls.flowSpeedStringProperty,
        strings.controls.speedValuePatternStringProperty,
        2,
        a11y.flowSpeedStringProperty,
        a11y.flowSpeedHelpTextStringProperty,
      ),
    ];

    if (options.showFullControls) {
      children.push(
        slider(
          model.kinematicViscosityProperty,
          VISCOSITY_RANGE,
          strings.controls.viscosityStringProperty,
          strings.controls.viscosityValuePatternStringProperty,
          4,
          a11y.viscosityStringProperty,
          a11y.viscosityHelpTextStringProperty,
        ),
      );

      const shapeBox = createComboBox<ObstacleShape>(
        model.obstacleShapeProperty,
        LAB_OBSTACLE_SHAPES,
        (shape) => shapeLabels[shape],
        strings.controls.obstacleShapeStringProperty,
        a11y.obstacleShapeStringProperty,
        listParent,
      );
      const visualizationBox = createComboBox<VisualizationMode>(
        model.visualizationModeProperty,
        VISUALIZATION_MODES,
        (mode) => visualizationLabels[mode],
        strings.controls.visualizationStringProperty,
        a11y.visualizationStringProperty,
        listParent,
      );

      for (const box of [shapeBox, visualizationBox]) {
        children.push(box.node);
        controls.push(box.comboBox);
        disposers.push(box.dispose);
      }
    }

    super(new VBox({ children, spacing: 12, align: "left", stretch: true }), options);

    this.controlsInOrder = controls;
    this.disposeFluidControlPanel = () => {
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
    };
  }

  public override dispose(): void {
    this.disposeFluidControlPanel();
    super.dispose();
  }
}

/** A label-and-value line above a slider track. */
function createSlider(
  property: NumberProperty,
  range: Range,
  label: TReadOnlyProperty<string>,
  valuePattern: TReadOnlyProperty<string>,
  decimals: number,
  accessibleName: TReadOnlyProperty<string>,
  accessibleHelpText?: TReadOnlyProperty<string>,
): { node: Node; slider: Node; dispose: () => void } {
  const valueStringProperty = new DerivedProperty([property, valuePattern], (value, pattern) =>
    StringUtils.fillIn(pattern, { value: value.toFixed(decimals) }),
  );

  const labelText = new Text(label, {
    font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
    fill: FluidDynamicsColors.textColorProperty,
    maxWidth: CONTROL_PANEL_WIDTH * 0.6,
  });
  const valueText = new Text(valueStringProperty, {
    font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
    fill: FluidDynamicsColors.accentColorProperty,
    maxWidth: CONTROL_PANEL_WIDTH * 0.4,
  });

  const slider = new HSlider(property, range, {
    trackSize: SLIDER_TRACK_SIZE,
    thumbSize: SLIDER_THUMB_SIZE,
    accessibleName,
    ...(accessibleHelpText !== undefined && { accessibleHelpText }),
    // Twenty steps across the range: fine enough to explore a transition,
    // coarse enough that holding an arrow key crosses the range in a second.
    keyboardStep: range.getLength() / 20,
    shiftKeyboardStep: range.getLength() / 100,
    pageKeyboardStep: range.getLength() / 5,
  });

  const node = new VBox({
    spacing: 4,
    align: "left",
    stretch: true,
    children: [
      new HBox({ children: [labelText, valueText], spacing: 8, justify: "spaceBetween", stretch: true }),
      slider,
    ],
  });

  return {
    node,
    slider,
    dispose: () => {
      slider.dispose();
      valueText.dispose();
      labelText.dispose();
      valueStringProperty.dispose();
    },
  };
}

/** A labelled combo box over an as-const union of model values. */
function createComboBox<T extends string>(
  property: Property<T>,
  values: readonly T[],
  labelFor: (value: T) => TReadOnlyProperty<string>,
  label: TReadOnlyProperty<string>,
  accessibleName: TReadOnlyProperty<string>,
  listParent: Node,
): { node: Node; comboBox: Node; dispose: () => void } {
  const itemTexts: Text[] = [];

  const comboBox = new ComboBox(
    property,
    values.map((value) => {
      const text = new Text(labelFor(value), {
        font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
        // The combo box's list is a light surface in both color profiles, so its
        // item labels must use the dark light-surface fill, not the panel fill.
        fill: LIGHT_SURFACE_TEXT_FILL,
      });
      itemTexts.push(text);
      return { value, createNode: () => text };
    }),
    listParent,
    { ...FLUID_DYNAMICS_COMBO_BOX_OPTIONS, accessibleName },
  );

  const labelText = new Text(label, {
    font: new PhetFont(CONTROL_LABEL_FONT_SIZE),
    fill: FluidDynamicsColors.textColorProperty,
    maxWidth: CONTROL_PANEL_WIDTH * 0.5,
  });

  return {
    node: new HBox({ children: [labelText, comboBox], spacing: 8, justify: "spaceBetween", stretch: true }),
    comboBox,
    dispose: () => {
      comboBox.dispose();
      labelText.dispose();
      for (const text of itemTexts) {
        text.dispose();
      }
    },
  };
}

const SLIDER_TRACK_SIZE = new Dimension2(CONTROL_PANEL_WIDTH - 48, 4);
const SLIDER_THUMB_SIZE = new Dimension2(14, 26);
