/**
 * ObstacleHandleKeyboard.ts
 *
 * Keyboard support for the obstacle's handles.
 *
 * The translation handle can use KeyboardDragListener, which drives a
 * position Property. The size, angle, focal and thickness handles change
 * several quantities from one knob with custom arithmetic, so they share this
 * small arrow-key listener instead: each arrow invokes a callback, Shift
 * makes the step finer, and the keypress is consumed so it neither scrolls
 * the page nor reaches another control.
 */

import { KeyboardUtils, type SceneryEvent, type TInputListener } from "scenerystack/scenery";
import { HANDLE_KEYBOARD_STEP_FACTOR } from "../../FluidDynamicsConstants.js";

export type ArrowKeyActions = {
  readonly up: (fine: boolean) => void;
  readonly down: (fine: boolean) => void;
  readonly left: (fine: boolean) => void;
  readonly right: (fine: boolean) => void;
};

/**
 * Builds a scenery input listener that maps the four arrow keys onto the
 * given actions. `fine` is true while Shift is held.
 */
export function createArrowKeyListener(actions: ArrowKeyActions): TInputListener {
  return {
    keydown: (event: SceneryEvent<KeyboardEvent>) => {
      const domEvent = event.domEvent;
      if (domEvent === null || !KeyboardUtils.isArrowKey(domEvent)) {
        return;
      }
      const fine = domEvent.shiftKey;
      const code = KeyboardUtils.getEventCode(domEvent);
      if (code === KeyboardUtils.KEY_UP_ARROW) {
        actions.up(fine);
      } else if (code === KeyboardUtils.KEY_DOWN_ARROW) {
        actions.down(fine);
      } else if (code === KeyboardUtils.KEY_LEFT_ARROW) {
        actions.left(fine);
      } else if (code === KeyboardUtils.KEY_RIGHT_ARROW) {
        actions.right(fine);
      }
      event.handle(); // consumed: no scrolling, no double-handling
    },
  };
}

/** The step to apply for one keypress, honouring the Shift modifier. */
export function keyboardStep(baseStep: number, fine: boolean): number {
  return fine ? baseStep / HANDLE_KEYBOARD_STEP_FACTOR : baseStep;
}
