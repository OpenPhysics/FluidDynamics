/**
 * ObstacleHandleNode.ts
 *
 * An invisible grab handle over the obstacle, so it can be dragged.
 *
 * The body itself is drawn by the display shader from the same signed distance
 * function the solver uses for its no-slip condition — drawing it a second time
 * in Scenery would risk the picture and the physics disagreeing. So this node
 * contributes no visible fill of its own; it exists to own the hit area, the
 * focus highlight and the keyboard interaction.
 *
 * It sits above FluidFieldNode in z-order, which is what keeps a press on the
 * obstacle from being read as a press on the fluid.
 */

import { Multilink, type NumberProperty, Property } from "scenerystack/axon";
import type { Bounds2, Vector2Property } from "scenerystack/dot";
import { type EmptySelfOptions, optionize } from "scenerystack/phet-core";
import type { ModelViewTransform2 } from "scenerystack/phetcommon";
import { Circle, type CircleOptions, DragListener, KeyboardDragListener } from "scenerystack/scenery";
import { OBSTACLE_DRAG_BOUNDS_M, OBSTACLE_KEYBOARD_SPEED_MPS } from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";

export type ObstacleHandleNodeOptions = CircleOptions;

export class ObstacleHandleNode extends Circle {
  private readonly disposeObstacleHandleNode: () => void;

  public constructor(
    centerProperty: Vector2Property,
    diameterProperty: NumberProperty,
    modelViewTransform: ModelViewTransform2,
    providedOptions?: ObstacleHandleNodeOptions,
  ) {
    const a11y = StringManager.getInstance().getFluidA11yStrings();

    const options = optionize<ObstacleHandleNodeOptions, EmptySelfOptions, CircleOptions>()(
      {
        // Transparent rather than invisible: an invisible Node is removed from
        // the parallel DOM and can be neither focused nor hit-tested.
        fill: "rgba(0,0,0,0)",
        cursor: "pointer",
        tagName: "div",
        focusable: true,
        accessibleName: a11y.obstacleHandleStringProperty,
        accessibleHelpText: a11y.obstacleHandleHelpTextStringProperty,
      },
      providedOptions,
    );
    super(1, options);

    // Keeping the obstacle clear of the inflow, outflow and walls is a physical
    // constraint, not a cosmetic one: a body overlapping the inflow strip would
    // fight the boundary condition that forces the velocity there, and one
    // against a wall has no room for a wake.
    const dragBoundsProperty = new Property<Bounds2 | null>(OBSTACLE_DRAG_BOUNDS_M);

    const positionListener = Multilink.multilink([centerProperty, diameterProperty], (centre, diameter) => {
      this.center = modelViewTransform.modelToViewPosition(centre);
      // The handle covers the body's bounding circle, which is the right grab
      // area for all three shapes: the plate is thinner and the airfoil longer,
      // but both fit inside it, and neither gains from a pixel-exact hit area.
      this.radius = Math.abs(modelViewTransform.modelToViewDeltaX(diameter / 2));
    });

    const dragListener = new DragListener({
      targetNode: this,
      transform: modelViewTransform,
      positionProperty: centerProperty,
      dragBoundsProperty,
    });
    this.addInputListener(dragListener);

    // Keyboard equivalent, without which the obstacle is unusable without a
    // pointer. Speeds are in model metres per second, so they do not depend on
    // how large the field happens to be drawn.
    const keyboardListener = new KeyboardDragListener({
      transform: modelViewTransform,
      positionProperty: centerProperty,
      dragBoundsProperty,
      dragSpeed: OBSTACLE_KEYBOARD_SPEED_MPS,
      shiftDragSpeed: OBSTACLE_KEYBOARD_SPEED_MPS / 4,
    });
    this.addInputListener(keyboardListener);

    this.disposeObstacleHandleNode = () => {
      this.removeInputListener(keyboardListener);
      keyboardListener.dispose();
      this.removeInputListener(dragListener);
      dragListener.dispose();
      positionListener.dispose();
      dragBoundsProperty.dispose();
    };
  }

  public override dispose(): void {
    this.disposeObstacleHandleNode();
    super.dispose();
  }
}
