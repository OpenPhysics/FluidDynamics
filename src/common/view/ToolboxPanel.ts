/**
 * ToolboxPanel.ts
 *
 * Home of the measurement tools, and everything they need to move in and out
 * of it.
 *
 * The panel itself is a small FluidDynamicsPanel at the bottom-left holding
 * two focusable icons. Pressing an icon when its tool is hidden takes the tool
 * out — at the pointer, with the drag forwarded so the press becomes a drag of
 * the tool itself (the same forwarding MeasuringTapeNode.startBaseDrag()
 * exists to provide). A forwarded press is released as part of the icon's own
 * gesture and never delivers the tool's drag-end callback, so a take-out can
 * never read as "dropped straight back on the toolbox" — no guard flags
 * needed. Pressing the icon while the tool is out puts it back, which is also
 * the keyboard-only path. Ending a genuine drag of a tool over the panel puts
 * it back too.
 *
 * The tool nodes this class creates are deliberately NOT children of the
 * panel: they belong among the ScreenView's topmost children so they float
 * above the control panel and readouts while in use. FluidScreenView adds them
 * as siblings; this class exposes them as public fields for exactly that.
 *
 * Tool state (visibility and positions) lives in FluidModel, so Reset All
 * returns both tools to the toolbox without any view-side reset code.
 */

import { Property } from "scenerystack/axon";
import { type Bounds2, Vector2 } from "scenerystack/dot";
import { Shape } from "scenerystack/kite";
import type { ModelViewTransform2 } from "scenerystack/phetcommon";
import { HBox, Node, Path, PressListener, type PressListenerEvent, Rectangle } from "scenerystack/scenery";
import { MeasuringTapeNode, type MeasuringTapeUnits } from "scenerystack/scenery-phet";
import {
  RULER_HEIGHT_PX,
  RULER_INSETS_PX,
  RULER_LENGTH_M,
  TAPE_TAKEOUT_OFFSET_PX,
  TOOL_DRAG_MARGIN_M,
  TOOLBOX_ICON_SPACING,
  TOOLBOX_RETURN_TOLERANCE_PX,
} from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";
import { FluidDynamicsPanel, type FluidDynamicsPanelOptions } from "../FluidDynamicsPanel.js";
import type { FluidModel } from "../model/FluidModel.js";
import { FluidRulerNode } from "./FluidRulerNode.js";

type SelfOptions = {
  /** The field's model↔view transform — metres to the shared screen frame. */
  readonly modelViewTransform: ModelViewTransform2;

  /** Where tools may go, in view (layout) coordinates. */
  readonly screenViewBounds: Bounds2;

  /** Converts a global pointer position to the shared view (layout) frame. */
  readonly globalToViewPoint: (globalPoint: Vector2) => Vector2;
};

export type ToolboxPanelOptions = SelfOptions & FluidDynamicsPanelOptions;

/** Where the tape's base and tip may sit while it is out, in model metres. */
function createTapeDragBounds(modelViewTransform: ModelViewTransform2, screenViewBounds: Bounds2): Bounds2 {
  const margin = TOOL_DRAG_MARGIN_M * Math.abs(modelViewTransform.modelToViewDeltaX(1));
  return modelViewTransform.viewToModelBounds(screenViewBounds.eroded(margin));
}

export class ToolboxPanel extends FluidDynamicsPanel {
  /** The tape, once taken out. A ScreenView-level sibling, not a child here. */
  public readonly measuringTapeNode: MeasuringTapeNode;

  /** The ruler, once taken out. A ScreenView-level sibling, not a child here. */
  public readonly rulerNode: FluidRulerNode;

  /** Icon nodes, exposed for the ScreenView's pdomOrder. */
  public readonly tapeIconNode: Node;
  public readonly rulerIconNode: Node;

  private readonly model: FluidModel;
  private readonly modelViewTransform: ModelViewTransform2;
  private readonly globalToViewPoint: (globalPoint: Vector2) => Vector2;
  private readonly tapeDragBounds: Bounds2;

  private readonly tapeUnitsProperty: Property<MeasuringTapeUnits>;
  private readonly disposeToolboxPanel: () => void;

  public constructor(model: FluidModel, providedOptions: ToolboxPanelOptions) {
    const { modelViewTransform, screenViewBounds, globalToViewPoint, ...panelOptions } = providedOptions;

    const tapeIcon = createTapeIcon();
    const rulerIcon = createRulerIcon();

    super(
      new HBox({
        children: [tapeIcon, rulerIcon],
        spacing: TOOLBOX_ICON_SPACING,
        align: "center",
      }),
      panelOptions,
    );

    this.model = model;
    this.modelViewTransform = modelViewTransform;
    this.globalToViewPoint = globalToViewPoint;
    this.tapeDragBounds = createTapeDragBounds(modelViewTransform, screenViewBounds);
    this.tapeIconNode = tapeIcon;
    this.rulerIconNode = rulerIcon;

    // Metres only, like every other readout in the sim; two decimals give
    // centimetre precision, which is what the ruler's ticks show.
    this.tapeUnitsProperty = new Property<MeasuringTapeUnits>({ name: "m", multiplier: 1 });

    // The tape brings its own pointer + keyboard dragging and its own
    // parallel-DOM labels for the base and the tip, so all this class adds is
    // where it may go and what happens when a drag of it ends over the toolbox.
    this.measuringTapeNode = new MeasuringTapeNode(this.tapeUnitsProperty, {
      basePositionProperty: model.tapeBasePositionProperty,
      tipPositionProperty: model.tapeTipPositionProperty,
      modelViewTransform,
      dragBounds: this.tapeDragBounds,
      significantFigures: 2,
      baseDragEnded: () => this.considerTapeReturn(model.tapeBasePositionProperty.value),
      tipDragListenerOptions: {
        end: () => this.considerTapeReturn(model.tapeTipPositionProperty.value),
      },
    });

    this.rulerNode = new FluidRulerNode(model.rulerPositionProperty, modelViewTransform, screenViewBounds, {
      onDragEnded: () => this.considerRulerReturn(),
    });

    // Visibility is deliberately NOT linked here. The tools are added to the
    // scene graph by FluidScreenView after this constructor returns, and a node
    // that is invisible at the moment it is added never populates its
    // pdomDisplays — its parallel-DOM content then stays hidden forever, no
    // matter how its `visible` toggles later. The ScreenView links visibility
    // once the nodes are in the tree, so the first hide travels the path every
    // later show retracees.

    const tapeIconListener = new PressListener({
      press: (event: PressListenerEvent) => this.pressTapeIcon(event),
    });
    tapeIcon.addInputListener(tapeIconListener);
    const rulerIconListener = new PressListener({
      press: (event: PressListenerEvent) => this.pressRulerIcon(event),
    });
    rulerIcon.addInputListener(rulerIconListener);

    this.disposeToolboxPanel = () => {
      rulerIcon.removeInputListener(rulerIconListener);
      rulerIconListener.dispose();
      tapeIcon.removeInputListener(tapeIconListener);
      tapeIconListener.dispose();
      this.rulerNode.dispose();
      this.measuringTapeNode.dispose();
      this.tapeUnitsProperty.dispose();
    };
  }

  /** Icon press: take the tape out under the pointer, or put it away. */
  private pressTapeIcon(event: PressListenerEvent): void {
    if (this.model.measuringTapeVisibleProperty.value) {
      this.model.measuringTapeVisibleProperty.value = false;
      return;
    }
    const base = this.modelViewTransform.viewToModelPosition(
      this.globalToViewPoint(event.pointer.point).plus(TAPE_TAKEOUT_OFFSET_PX),
    );
    const tip = base.plus(new Vector2(0.55, 0.3));
    this.model.tapeBasePositionProperty.value = this.tapeDragBounds.getConstrainedPoint(base);
    this.model.tapeTipPositionProperty.value = this.tapeDragBounds.getConstrainedPoint(tip);
    this.model.measuringTapeVisibleProperty.value = true;
    this.measuringTapeNode.startBaseDrag(event);
  }

  /** Icon press: take the ruler out beside the pointer, or put it away. */
  private pressRulerIcon(event: PressListenerEvent): void {
    if (this.model.rulerVisibleProperty.value) {
      this.model.rulerVisibleProperty.value = false;
      return;
    }
    const scale = Math.abs(this.modelViewTransform.modelToViewDeltaX(1));
    const offsetView = new Vector2((RULER_LENGTH_M * scale) / 2 + RULER_INSETS_PX + 16, -(RULER_HEIGHT_PX + 24));
    const centre = this.modelViewTransform.viewToModelPosition(
      this.globalToViewPoint(event.pointer.point).plus(offsetView),
    );
    this.model.rulerPositionProperty.value = this.rulerNode.dragBounds.getConstrainedPoint(centre);
    this.model.rulerVisibleProperty.value = true;
    this.rulerNode.startDrag(event);
  }

  /** Drag end over the toolbox puts the tape away. */
  private considerTapeReturn(grabModelPoint: Vector2): void {
    if (this.returnBounds.containsPoint(this.modelViewTransform.modelToViewPosition(grabModelPoint))) {
      this.model.measuringTapeVisibleProperty.value = false;
    }
  }

  /** Drag end over the toolbox puts the ruler away. */
  private considerRulerReturn(): void {
    // Intersection rather than containment: the ruler is wider than the
    // toolbox, and its drag bounds keep its centre from ever reaching the
    // panel, so "dropped on the toolbox" has to mean "overlapping it".
    const rulerViewBounds = this.parent.globalToLocalBounds(this.rulerNode.globalBounds);
    if (this.returnBounds.intersectsBounds(rulerViewBounds)) {
      this.model.rulerVisibleProperty.value = false;
    }
  }

  /**
   * The panel's footprint in the shared view frame, with slack for a drop.
   * Computed through the global frame — this panel and the tools are siblings
   * under the ScreenView, whose scale maps that frame onto the page.
   */
  private get returnBounds(): Bounds2 {
    return this.parent.globalToLocalBounds(this.globalBounds).dilated(TOOLBOX_RETURN_TOLERANCE_PX);
  }

  public override dispose(): void {
    this.disposeToolboxPanel();
    super.dispose();
  }
}

/** A small tape for the toolbox, from the component's own icon factory. */
function createTapeIcon(): Node {
  const a11y = StringManager.getInstance().getFluidA11yStrings();
  return new Node({
    children: [MeasuringTapeNode.createIcon()],
    cursor: "pointer",
    tagName: "div",
    focusable: true,
    accessibleName: a11y.toolboxTapeNameStringProperty,
    accessibleHelpText: a11y.toolboxTapeHelpTextStringProperty,
  });
}

/** A small ruler for the toolbox, hand-drawn in the screen-icons house style. */
function createRulerIcon(): Node {
  const a11y = StringManager.getInstance().getFluidA11yStrings();
  const width = 52;
  const height = 26;
  const ticks = new Shape();
  for (let i = 0; i <= 5; i++) {
    const x = 6 + i * 8;
    ticks.moveTo(x, 0).lineTo(x, 9);
    ticks.moveTo(x, height).lineTo(x, height - 9);
  }
  return new Node({
    children: [
      new Rectangle(0, 0, width, height, { fill: "rgb(236, 225, 113)", stroke: "black", lineWidth: 1 }),
      new Path(ticks, { stroke: "black", lineWidth: 1 }),
    ],
    cursor: "pointer",
    tagName: "div",
    focusable: true,
    accessibleName: a11y.toolboxRulerNameStringProperty,
    accessibleHelpText: a11y.toolboxRulerHelpTextStringProperty,
  });
}
