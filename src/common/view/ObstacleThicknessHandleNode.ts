/**
 * ObstacleThicknessHandleNode.ts
 *
 * The knob on the airfoil's thickest point, which drags the body between slim
 * and stout. Collapsed toward the chord it flattens the section toward a
 * plate — the airfoil's version of the ellipse's focus collapsing to a disk.
 *
 * The knob rides the upper surface at the station where the NACA thickness
 * distribution peaks, so it always sits exactly on the surface the learner is
 * stretching. Dragging projects the pointer onto the chord's normal axis, so
 * sweeping along the chord does nothing.
 *
 * Shown on the Lab screen only, while the shape is the airfoil.
 */

import { Multilink, type NumberProperty } from "scenerystack/axon";
import { Vector2, type Vector2Property } from "scenerystack/dot";
import type { ModelViewTransform2 } from "scenerystack/phetcommon";
import { DragListener, Node } from "scenerystack/scenery";
import {
  AIRFOIL_MAX_THICKNESS_STATION,
  AIRFOIL_THICKNESS_RANGE,
  THICKNESS_KEYBOARD_STEP,
} from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";
import { nacaHalfThickness } from "../model/ObstacleGeometry.js";
import { createArrowKeyListener, keyboardStep } from "./ObstacleHandleKeyboard.js";
import { createKnobDot, createKnobHitArea } from "./ObstacleHandleKnob.js";

export class ObstacleThicknessHandleNode extends Node {
  private readonly disposeObstacleThicknessHandleNode: () => void;

  public constructor(
    centerProperty: Vector2Property,
    diameterProperty: NumberProperty,
    thicknessProperty: NumberProperty,
    angleOfAttackProperty: NumberProperty,
    modelViewTransform: ModelViewTransform2,
  ) {
    super();

    const a11y = StringManager.getInstance().getFluidA11yStrings();
    const knob = createKnobHitArea(a11y.thicknessHandleStringProperty, a11y.thicknessHandleHelpTextStringProperty);
    knob.addChild(createKnobDot());
    this.addChild(knob);

    const positionListener = Multilink.multilink(
      [centerProperty, diameterProperty, thicknessProperty, angleOfAttackProperty],
      (centre, diameter, thickness, angleDeg) => {
        const alpha = (angleDeg * Math.PI) / 180;
        const chord = diameter;
        const local = new Vector2(
          (AIRFOIL_MAX_THICKNESS_STATION - 0.5) * chord,
          nacaHalfThickness(thickness, AIRFOIL_MAX_THICKNESS_STATION) * chord,
        );
        // The shader's chord frame is rotated by −α going back to world
        // coordinates (its toChordFrame rotates by +α), matching
        // ObstacleSizeAngleHandleNode's leading-edge placement.
        const worldOffset = new Vector2(
          local.x * Math.cos(alpha) + local.y * Math.sin(alpha),
          -local.x * Math.sin(alpha) + local.y * Math.cos(alpha),
        );
        knob.center = modelViewTransform
          .modelToViewPosition(centre)
          .plus(modelViewTransform.modelToViewDelta(worldOffset));
      },
    );

    const applyThickness = (globalPoint: Vector2): void => {
      const modelPoint = modelViewTransform.viewToModelPosition(this.globalToLocalPoint(globalPoint));
      const offset = modelPoint.minus(centerProperty.value);
      const alpha = (angleOfAttackProperty.value * Math.PI) / 180;
      // Into the chord frame (same rotation as the shader's toChordFrame);
      // only the normal component matters.
      const localNormal = offset.x * Math.sin(alpha) + offset.y * Math.cos(alpha);
      const chord = diameterProperty.value;
      const thickness = Math.abs(localNormal) / (chord * nacaHalfThickness(1, AIRFOIL_MAX_THICKNESS_STATION));
      thicknessProperty.value = AIRFOIL_THICKNESS_RANGE.constrainValue(thickness);
    };

    const dragListener = new DragListener({
      targetNode: knob,
      drag: (event) => {
        applyThickness(event.pointer.point);
      },
    });
    knob.addInputListener(dragListener);

    const keyListener = createArrowKeyListener({
      up: (fine) => {
        thicknessProperty.value = AIRFOIL_THICKNESS_RANGE.constrainValue(
          thicknessProperty.value + keyboardStep(THICKNESS_KEYBOARD_STEP, fine),
        );
      },
      down: (fine) => {
        thicknessProperty.value = AIRFOIL_THICKNESS_RANGE.constrainValue(
          thicknessProperty.value - keyboardStep(THICKNESS_KEYBOARD_STEP, fine),
        );
      },
      // The thickness has no use for sideways arrows, but consuming them keeps
      // focus from wandering off mid-interaction.
      // biome-ignore lint/suspicious/noEmptyBlockStatements: consuming the key is the whole point
      left: () => {},
      // biome-ignore lint/suspicious/noEmptyBlockStatements: consuming the key is the whole point
      right: () => {},
    });
    knob.addInputListener(keyListener);

    this.disposeObstacleThicknessHandleNode = () => {
      knob.removeInputListener(keyListener);
      knob.removeInputListener(dragListener);
      dragListener.dispose();
      positionListener.dispose();
    };
  }

  public override dispose(): void {
    this.disposeObstacleThicknessHandleNode();
    super.dispose();
  }
}
