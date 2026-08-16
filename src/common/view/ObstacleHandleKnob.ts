/**
 * ObstacleHandleKnob.ts
 *
 * The visible grip shared by the obstacle's handles.
 *
 * The body is drawn by the display shader (see ObstacleHandleNode for why
 * Scenery never draws it), so a handle can only mark itself: a small dot with
 * a dark rim so it reads on both the dark body and the bright dye field. The
 * dot is deliberately tiny — it sits on the body's outline and must not cover
 * flow the learner is looking at — so the hit area is an invisible larger
 * circle around it, which is also the focusable node carrying the keyboard
 * interaction.
 */

import type { TReadOnlyProperty } from "scenerystack/axon";
import { Circle } from "scenerystack/scenery";
import FluidDynamicsColors from "../../FluidDynamicsColors.js";

/** View radius of the visible dot, in screen pixels. */
const DOT_RADIUS = 6;

/** View radius of the invisible hit area around the dot, in screen pixels. */
const HIT_RADIUS = 14;

/**
 * The invisible hit/focus circle. The caller adds its input listeners here,
 * then the visible dot as a child. Accessibility names are supplied here
 * because every handle knob answers to a different description.
 */
export function createKnobHitArea(
  accessibleName: TReadOnlyProperty<string>,
  accessibleHelpText: TReadOnlyProperty<string>,
): Circle {
  return new Circle(HIT_RADIUS, {
    // Transparent rather than invisible: an invisible Node is removed from the
    // parallel DOM and can be neither focused nor hit-tested.
    fill: "rgba(0,0,0,0)",
    cursor: "pointer",
    tagName: "div",
    focusable: true,
    accessibleName,
    accessibleHelpText,
  });
}

/** The visible dot, centered in its hit area. */
export function createKnobDot(): Circle {
  return new Circle(DOT_RADIUS, {
    fill: FluidDynamicsColors.accentColorProperty,
    stroke: "rgba(10, 11, 16, 0.85)",
    lineWidth: 2,
    pickable: false,
  });
}
