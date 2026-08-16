/**
 * FluidRulerNode.ts
 *
 * A draggable 1-metre ruler over the field.
 *
 * scenery-phet's RulerNode is purely visual — it draws ticks and labels and
 * nothing else — so this wrapper owns everything RulerNode leaves to the sim:
 * pointer dragging, keyboard dragging, the focusable parallel-DOM element, and
 * the constraint that keeps the whole ruler on screen. The pattern follows
 * ObstacleHandleNode, whose position Property lives in the model in metres and
 * whose listeners convert through the shared modelViewTransform.
 *
 * The ruler's own scale is honest: its length and tick spacing are computed
 * from the transform, so one ruler metre is exactly one channel metre at any
 * field size. Labels are in centimetres (0–100) because two-decimal metres are
 * harder to read against the dye than integer centimetres.
 */

import { Property } from "scenerystack/axon";
import { Bounds2, Vector2, type Vector2Property } from "scenerystack/dot";
import { optionize } from "scenerystack/phet-core";
import type { ModelViewTransform2 } from "scenerystack/phetcommon";
import {
  DragListener,
  KeyboardDragListener,
  Node,
  type NodeOptions,
  type PressListenerEvent,
} from "scenerystack/scenery";
import { PhetFont, RulerNode } from "scenerystack/scenery-phet";
import { Tandem } from "scenerystack/tandem";
import {
  RULER_HEIGHT_PX,
  RULER_INSETS_PX,
  RULER_KEYBOARD_SPEED_MPS,
  RULER_LENGTH_M,
  RULER_MAJOR_TICK_M,
  RULER_MINOR_TICKS_PER_MAJOR,
  TOOL_DRAG_MARGIN_M,
} from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";

type SelfOptions = {
  /**
   * Called when a drag of the ruler ends — pointer or keyboard — so the
   * toolbox can test whether it was dropped back in.
   */
  readonly onDragEnded?: (() => void) | null;
};

export type FluidRulerNodeOptions = SelfOptions & NodeOptions;

export class FluidRulerNode extends Node {
  /** Where the ruler's centre may go, in model metres. Shared with the toolbox. */
  public readonly dragBounds: Bounds2;

  private readonly dragListener: DragListener;
  private readonly disposeFluidRulerNode: () => void;

  /**
   * @param centerProperty       ruler centre, in metres from the channel's lower-left corner
   * @param modelViewTransform   the field's model↔view transform
   * @param screenViewBounds     where the ruler may go, in view (layout) coordinates
   */
  public constructor(
    centerProperty: Vector2Property,
    modelViewTransform: ModelViewTransform2,
    screenViewBounds: Bounds2,
    providedOptions?: FluidRulerNodeOptions,
  ) {
    const a11y = StringManager.getInstance().getFluidA11yStrings();
    const onDragEnded = providedOptions?.onDragEnded ?? null;

    // The ruler's dimensions come from the transform rather than a pixel
    // constant, so the ticks can never drift out of step with the channel.
    const scale = Math.abs(modelViewTransform.modelToViewDeltaX(1));
    const rulerWidth = Math.abs(modelViewTransform.modelToViewDeltaX(RULER_LENGTH_M));
    const majorTickWidth = Math.abs(modelViewTransform.modelToViewDeltaX(RULER_MAJOR_TICK_M));
    const majorTickLabels = Array.from(
      { length: Math.floor(RULER_LENGTH_M / RULER_MAJOR_TICK_M) + 1 },
      (_, index) => `${Math.round(index * RULER_MAJOR_TICK_M * 100)}`,
    );
    const tickFont = new PhetFont(14);

    const options = optionize<FluidRulerNodeOptions, SelfOptions, NodeOptions>()(
      {
        onDragEnded: null,
        tagName: "div",
        focusable: true,
        accessibleName: a11y.rulerNameStringProperty,
        accessibleHelpText: a11y.rulerHelpTextStringProperty,
        children: [
          new RulerNode(rulerWidth, RULER_HEIGHT_PX, majorTickWidth, majorTickLabels, "cm", {
            insetsWidth: RULER_INSETS_PX,
            minorTicksPerMajorTick: RULER_MINOR_TICKS_PER_MAJOR,
            majorTickFont: tickFont,
            unitsFont: tickFont,
            tandem: Tandem.OPTIONAL,
            center: Vector2.ZERO,
          }),
        ],
      },
      providedOptions,
    );
    super(options);

    // Constrain the centre so the whole ruler stays on screen: shrink the view
    // bounds by half the ruler on each side, then express what is left in model
    // metres. The listeners want a Property; it never changes value.
    const halfWidth = rulerWidth / 2 + RULER_INSETS_PX;
    const halfHeight = RULER_HEIGHT_PX / 2 + TOOL_DRAG_MARGIN_M * scale;
    this.dragBounds = modelViewTransform.viewToModelBounds(
      new Bounds2(
        screenViewBounds.minX + halfWidth,
        screenViewBounds.minY + halfHeight,
        screenViewBounds.maxX - halfWidth,
        screenViewBounds.maxY - halfHeight,
      ),
    );
    const dragBoundsProperty = new Property(this.dragBounds);

    const positionListener = (centre: Vector2): void => {
      this.center = modelViewTransform.modelToViewPosition(centre);
    };
    centerProperty.link(positionListener);

    this.dragListener = new DragListener({
      targetNode: this,
      transform: modelViewTransform,
      positionProperty: centerProperty,
      dragBoundsProperty,
      end: () => onDragEnded?.(),
    });
    this.addInputListener(this.dragListener);

    const keyboardListener = new KeyboardDragListener({
      transform: modelViewTransform,
      positionProperty: centerProperty,
      dragBoundsProperty,
      dragSpeed: RULER_KEYBOARD_SPEED_MPS,
      shiftDragSpeed: RULER_KEYBOARD_SPEED_MPS / 4,
      end: () => onDragEnded?.(),
    });
    this.addInputListener(keyboardListener);

    this.disposeFluidRulerNode = () => {
      this.removeInputListener(keyboardListener);
      keyboardListener.dispose();
      this.removeInputListener(this.dragListener);
      this.dragListener.dispose();
      centerProperty.unlink(positionListener);
      dragBoundsProperty.dispose();
    };
  }

  /**
   * Hands an in-progress pointer press to the ruler, so a drag started on the
   * toolbox icon continues as a drag of the ruler itself. The same forwarding
   * MeasuringTapeNode.startBaseDrag() performs for the tape.
   */
  public startDrag(event: PressListenerEvent): void {
    this.dragListener.press(event, this);
  }

  public override dispose(): void {
    this.disposeFluidRulerNode();
    super.dispose();
  }
}
