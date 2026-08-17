/**
 * ToolboxPanel.ts
 *
 * Home of the measurement tools, and everything they need to move in and out
 * of it.
 *
 * The panel itself is a small FluidDynamicsPanel at the bottom-left holding
 * two icons, each a <button> so Enter and Space reach the PressListener below
 * (see createTapeIcon). Pressing an icon when its tool is hidden takes the tool
 * out — at the pointer, with the drag forwarded so the press becomes a drag of
 * the tool itself (the same forwarding MeasuringTapeNode.startBaseDrag()
 * exists to provide). A keyboard press has no pointer to place the tool under
 * and no gesture to forward, so it places the tool at its default position
 * instead; see isKeyboardActivation. Pressing the icon while the tool is out
 * puts it back, which is the keyboard put-away path. Ending a genuine drag of a
 * tool over the panel puts it back too.
 *
 * Three things make that hand-off work, and each is easy to undo by accident:
 *
 *   - The icons' PressListeners are `attach: false`. PressListener attaches
 *     itself to the pointer *before* it runs the press callback, and both
 *     DragListener and PressListener refuse to press a pointer that another
 *     listener has attached. An attaching icon listener therefore swallows the
 *     take-out silently: the tool appears at the pointer and then sits there,
 *     because nothing is following the pointer at all.
 *   - The take-out offsets are small, so the tool comes out *under* the hand.
 *     A forwarded drag keeps whatever offset the take-out established, for the
 *     whole gesture — the offset is not a one-frame placement.
 *   - Because the tool comes out under the hand, and the hand is over the
 *     toolbox, the drag that took it out always ends over the toolbox. A
 *     one-shot origin per tool (tapeTakeOutOrigin / rulerTakeOutOrigin)
 *     swallows the return test for exactly that drag, and doubles as the
 *     click-versus-drag test: a press that never travelled parks the tool at
 *     its default position rather than leaving it draped over the toolbox.
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
import {
  FocusManager,
  HBox,
  Node,
  Path,
  PressListener,
  type PressListenerEvent,
  Rectangle,
} from "scenerystack/scenery";
import { MeasuringTapeNode, type MeasuringTapeUnits } from "scenerystack/scenery-phet";
import FluidDynamicsColors from "../../FluidDynamicsColors.js";
import {
  RULER_ICON_HEIGHT_PX,
  RULER_ICON_TICK_COUNT,
  RULER_ICON_TICK_INSET_PX,
  RULER_ICON_TICK_LENGTH_PX,
  RULER_ICON_TICK_SPACING_PX,
  RULER_ICON_WIDTH_PX,
  RULER_POSITION_DEFAULT,
  RULER_TAKEOUT_GRAB_FRACTION,
  TAPE_BASE_DEFAULT,
  TAPE_TAKEOUT_OFFSET_PX,
  TAPE_TAKEOUT_SPAN_M,
  TAPE_TIP_DEFAULT,
  TOOL_DRAG_MARGIN_M,
  TOOL_TAKEOUT_CLICK_SLOP_PX,
  TOOLBOX_ICON_SPACING,
  TOOLBOX_ICON_TOUCH_DILATION_PX,
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

/**
 * Whether this press came from the keyboard rather than from a real pointer.
 *
 * It matters because the take-out gesture forwards the press to the tool's own
 * drag listener, and a drag begun on the PDOM pointer has no pointer-up to end
 * it — the tool would stay welded to the pointer for the rest of the session.
 * The keyboard paths below place the tool instead of dragging it.
 */
function isKeyboardActivation(event: PressListenerEvent): boolean {
  return event.pointer.type === "pdom";
}

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

  /** Where the ruler's centre goes relative to a pointer taking it out, in view px. */
  private readonly rulerTakeOutOffsetPx: Vector2;

  /** How far a take-out has to travel to be a drag rather than a click, in metres. */
  private readonly takeOutClickSlopM: number;

  /** Where a take-out placed the tool, for as long as that gesture is in flight. */
  private tapeTakeOutOrigin: Vector2 | null = null;
  private rulerTakeOutOrigin: Vector2 | null = null;

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
      // Only the base can put the tape away. The tip is how the learner reaches
      // out to what they are measuring, and something worth measuring can sit
      // over the toolbox — a tip dropped there must not vanish the whole tape.
      baseDragEnded: () => this.endTapeDrag(),
    });

    this.rulerNode = new FluidRulerNode(model.rulerPositionProperty, modelViewTransform, screenViewBounds, {
      onDragEnded: () => this.endRulerDrag(),
    });

    // The pointer should land on the ruler's body when it comes out, so the
    // grab point is a fraction of the ruler's own size rather than a guess in
    // pixels — the ruler is as wide as one channel metre, whatever that is here.
    const rulerLocalBounds = this.rulerNode.localBounds;
    this.rulerTakeOutOffsetPx = new Vector2(
      (0.5 - RULER_TAKEOUT_GRAB_FRACTION.x) * rulerLocalBounds.width,
      (0.5 - RULER_TAKEOUT_GRAB_FRACTION.y) * rulerLocalBounds.height,
    );
    this.takeOutClickSlopM = TOOL_TAKEOUT_CLICK_SLOP_PX / Math.abs(modelViewTransform.modelToViewDeltaX(1));

    // Visibility is deliberately NOT linked here. The tools are added to the
    // scene graph by FluidScreenView after this constructor returns, and a node
    // that is invisible at the moment it is added never populates its
    // pdomDisplays — its parallel-DOM content then stays hidden forever, no
    // matter how its `visible` toggles later. The ScreenView links visibility
    // once the nodes are in the tree, so the first hide travels the path every
    // later show retracees.

    // attach: false is load bearing — see the take-out notes at the top of the
    // file. An attaching listener here silently costs the sim its drag-out.
    const tapeIconListener = new PressListener({
      attach: false,
      press: (event: PressListenerEvent) => this.pressTapeIcon(event),
    });
    tapeIcon.addInputListener(tapeIconListener);
    const rulerIconListener = new PressListener({
      attach: false,
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
    if (
      this.measuringTapeNode.isBaseUserControlledProperty.value ||
      this.measuringTapeNode.isTipUserControlledProperty.value
    ) {
      // A second finger on the icon must not put away a tape the first one is
      // still dragging — the drag would carry on with nothing to show for it.
      return;
    }
    if (this.model.measuringTapeVisibleProperty.value) {
      this.putTapeAway();
      return;
    }
    if (isKeyboardActivation(event)) {
      // No pointer to place the tape under, and no gesture to hand it to: put
      // it where Reset All would, out in the channel where it is useful, and
      // let the learner take over with the tape's own keyboard dragging.
      this.placeTapeAtDefault();
      this.model.measuringTapeVisibleProperty.value = true;
      return;
    }
    const base = this.tapeDragBounds.getConstrainedPoint(
      this.modelViewTransform.viewToModelPosition(
        this.globalToViewPoint(event.pointer.point).plus(TAPE_TAKEOUT_OFFSET_PX),
      ),
    );
    this.model.tapeBasePositionProperty.value = base;
    this.model.tapeTipPositionProperty.value = this.tapeDragBounds.getConstrainedPoint(base.plus(TAPE_TAKEOUT_SPAN_M));
    this.model.measuringTapeVisibleProperty.value = true;

    this.measuringTapeNode.startBaseDrag(event);
    if (this.measuringTapeNode.isBaseUserControlledProperty.value) {
      this.tapeTakeOutOrigin = base;
    } else {
      // The tape refused the press (another listener owns the pointer). No drag
      // and no drag end are coming, so leave it where the keyboard path would
      // rather than face down on the toolbox it was pulled from.
      this.placeTapeAtDefault();
    }
  }

  /** Icon press: take the ruler out under the pointer, or put it away. */
  private pressRulerIcon(event: PressListenerEvent): void {
    if (this.rulerNode.isDragging) {
      return; // as for the tape: a second finger must not cancel a live drag
    }
    if (this.model.rulerVisibleProperty.value) {
      this.putRulerAway();
      return;
    }
    if (isKeyboardActivation(event)) {
      // As for the tape: place it, do not hand it a drag.
      this.model.rulerPositionProperty.value = RULER_POSITION_DEFAULT;
      this.model.rulerVisibleProperty.value = true;
      return;
    }
    const centre = this.rulerNode.dragBounds.getConstrainedPoint(
      this.modelViewTransform.viewToModelPosition(
        this.globalToViewPoint(event.pointer.point).plus(this.rulerTakeOutOffsetPx),
      ),
    );
    this.model.rulerPositionProperty.value = centre;
    this.model.rulerVisibleProperty.value = true;

    if (this.rulerNode.startDrag(event)) {
      this.rulerTakeOutOrigin = centre;
    } else {
      this.model.rulerPositionProperty.value = RULER_POSITION_DEFAULT;
    }
  }

  /**
   * End of a pointer or keyboard drag of the tape's base: put it away if it was
   * dropped on the toolbox, unless this was the drag that took it out.
   */
  private endTapeDrag(): void {
    const takeOutOrigin = this.tapeTakeOutOrigin;
    this.tapeTakeOutOrigin = null;
    if (takeOutOrigin) {
      if (this.model.tapeBasePositionProperty.value.distance(takeOutOrigin) < this.takeOutClickSlopM) {
        this.placeTapeAtDefault(); // a click, not a drag
      }
      return;
    }
    if (
      this.returnBounds.containsPoint(
        this.modelViewTransform.modelToViewPosition(this.model.tapeBasePositionProperty.value),
      )
    ) {
      this.putTapeAway();
    }
  }

  /** The same, for the ruler. */
  private endRulerDrag(): void {
    const takeOutOrigin = this.rulerTakeOutOrigin;
    this.rulerTakeOutOrigin = null;
    if (takeOutOrigin) {
      if (this.model.rulerPositionProperty.value.distance(takeOutOrigin) < this.takeOutClickSlopM) {
        this.model.rulerPositionProperty.value = RULER_POSITION_DEFAULT;
      }
      return;
    }
    const parent = this.parent;
    if (!parent) {
      return;
    }
    // Intersection rather than containment: the ruler is wider than the
    // toolbox, and its drag bounds keep its centre from ever reaching the
    // panel, so "dropped on the toolbox" has to mean "overlapping it".
    const rulerViewBounds = parent.globalToLocalBounds(this.rulerNode.globalBounds);
    if (this.returnBounds.intersectsBounds(rulerViewBounds)) {
      this.putRulerAway();
    }
  }

  /** Where the tape sits when it is placed rather than dragged out. */
  private placeTapeAtDefault(): void {
    this.model.tapeBasePositionProperty.value = TAPE_BASE_DEFAULT;
    this.model.tapeTipPositionProperty.value = TAPE_TIP_DEFAULT;
  }

  private putTapeAway(): void {
    this.hideTool(this.model.measuringTapeVisibleProperty, this.measuringTapeNode, this.tapeIconNode);
  }

  private putRulerAway(): void {
    this.hideTool(this.model.rulerVisibleProperty, this.rulerNode, this.rulerIconNode);
  }

  /**
   * Hides a tool, keeping the keyboard's place. Hiding the node that owns the
   * focused element leaves focus on the document body — dead arrow keys, and no
   * way back but Tab from the top — so focus follows the tool home to its icon.
   */
  private hideTool(visibleProperty: Property<boolean>, toolNode: Node, iconNode: Node): void {
    const focus = FocusManager.pdomFocus;
    const toolHadFocus = focus?.trail.containsNode(toolNode);
    visibleProperty.value = false;
    if (toolHadFocus) {
      iconNode.focus();
    }
  }

  /**
   * The panel's footprint in the shared view frame, with slack for a drop.
   * Computed through the global frame — this panel and the tools are siblings
   * under the ScreenView, whose scale maps that frame onto the page.
   */
  private get returnBounds(): Bounds2 {
    const parent = this.parent;
    return (parent ? parent.globalToLocalBounds(this.globalBounds) : this.bounds).dilated(TOOLBOX_RETURN_TOLERANCE_PX);
  }

  public override dispose(): void {
    this.disposeToolboxPanel();
    super.dispose();
  }
}

/**
 * A small tape for the toolbox, from the component's own icon factory.
 *
 * `tagName: "button"` is load bearing, not cosmetic. The take-out/put-back
 * gesture is a PressListener, and PressListener reaches the keyboard only
 * through the PDOM's `click` event — which the browser synthesizes from Enter
 * and Space for a <button> and never for a focusable <div>. A div here is
 * focusable, silent about its role, and inert on Enter, which is exactly what
 * the help text below promises it is not.
 */
function createTapeIcon(): Node {
  const a11y = StringManager.getInstance().getFluidA11yStrings();
  return withTouchTarget(
    new Node({
      children: [MeasuringTapeNode.createIcon()],
      cursor: "pointer",
      tagName: "button",
      // The icon is where a take-out gesture starts, so its parallel-DOM element
      // belongs over the icon rather than parked off-screen: an iOS VoiceOver tap
      // is dispatched at the element's position.
      positionInPDOM: true,
      accessibleName: a11y.toolboxTapeNameStringProperty,
      accessibleHelpText: a11y.toolboxTapeHelpTextStringProperty,
    }),
  );
}

/** A small ruler for the toolbox, hand-drawn in the screen-icons house style. */
function createRulerIcon(): Node {
  const a11y = StringManager.getInstance().getFluidA11yStrings();
  const ticks = new Shape();
  for (let i = 0; i < RULER_ICON_TICK_COUNT; i++) {
    const x = RULER_ICON_TICK_INSET_PX + i * RULER_ICON_TICK_SPACING_PX;
    ticks.moveTo(x, 0).lineTo(x, RULER_ICON_TICK_LENGTH_PX);
    ticks.moveTo(x, RULER_ICON_HEIGHT_PX).lineTo(x, RULER_ICON_HEIGHT_PX - RULER_ICON_TICK_LENGTH_PX);
  }
  return withTouchTarget(
    new Node({
      children: [
        new Rectangle(0, 0, RULER_ICON_WIDTH_PX, RULER_ICON_HEIGHT_PX, {
          fill: FluidDynamicsColors.rulerIconFillColorProperty,
          stroke: FluidDynamicsColors.rulerIconStrokeColorProperty,
          lineWidth: 1,
        }),
        new Path(ticks, { stroke: FluidDynamicsColors.rulerIconStrokeColorProperty, lineWidth: 1 }),
      ],
      cursor: "pointer",
      // A <button>, and positioned in the PDOM, for the same reasons as the tape
      // icon above.
      tagName: "button",
      positionInPDOM: true,
      accessibleName: a11y.toolboxRulerNameStringProperty,
      accessibleHelpText: a11y.toolboxRulerHelpTextStringProperty,
    }),
  );
}

/**
 * Gives an icon a touch area larger than the icon itself.
 *
 * The icons are drawn small so the toolbox stays out of the channel's way, which
 * leaves them below a comfortable finger target. The dilation is half the gap
 * between them, so two dilated icons meet rather than overlap and a press
 * between them still resolves to the one it is nearer.
 *
 * The area *follows* the bounds rather than being set once, which is load
 * bearing for the tape: `MeasuringTapeNode.createIcon()` builds a live tape,
 * then asynchronously rasterizes it and swaps in an `Image` with different
 * bounds. A touch area snapshotted at construction ends up floating up and to
 * the left of the icon it is supposed to cover — visible under
 * `?showPointerAreas`, and invisible to everything else.
 */
function withTouchTarget(icon: Node): Node {
  const updateTouchArea = (localBounds: Bounds2): void => {
    icon.touchArea = localBounds.isFinite() ? localBounds.dilated(TOOLBOX_ICON_TOUCH_DILATION_PX) : null;
  };
  icon.localBoundsProperty.link(updateTouchArea);
  icon.disposeEmitter.addListener(() => icon.localBoundsProperty.unlink(updateTouchArea));
  return icon;
}
