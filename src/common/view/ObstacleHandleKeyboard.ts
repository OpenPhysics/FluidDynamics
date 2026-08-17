/**
 * ObstacleHandleKeyboard.ts
 *
 * Keyboard support for the obstacle's shaping handles, and the single source of
 * truth for what those keys are.
 *
 * The translation handle can use KeyboardDragListener, which drives a position
 * Property directly. The size, angle, focal and thickness handles each change
 * two quantities from one knob with custom arithmetic, so they share the
 * KeyboardListener built here instead.
 *
 * ── Why the bindings are HotkeyData ───────────────────────────────────────────
 * Every binding below is declared once as a HotkeyData and read twice: by
 * {@link createArrowKeyListener} to build the listener, and by
 * *KeyboardHelpContent.ts to build the dialog rows (via
 * KeyboardHelpSectionRow.fromHotkeyData). A binding therefore cannot appear in
 * the sim without appearing in the help dialog, or drift from what the dialog
 * claims. It also puts the keys in SceneryStack's hotkey registry, where they
 * are checked against the global shortcuts.
 *
 * ── Shift ─────────────────────────────────────────────────────────────────────
 * Shift makes a step finer. It has to be spelled out as its own key string:
 * a KeyboardListener registered for "arrowUp" alone does NOT fire when shift is
 * also down, because modifier keys suppress unmodified combinations.
 */

import { HotkeyData, KeyboardListener, type OneKeyStroke } from "scenerystack/scenery";
import { HANDLE_KEYBOARD_STEP_FACTOR } from "../../FluidDynamicsConstants.js";
import { StringManager } from "../../i18n/StringManager.js";

/** The repo these bindings belong to, for `binder` documentation output. */
const REPO_NAME = "fluid-dynamics";

const keyboardHelp = StringManager.getInstance().getKeyboardHelpStrings();

/**
 * Bindings for the handles, grouped by what they *mean* rather than by which
 * node owns them: the size knob's ↑/↓ resizes, the focus knob's ↑/↓ stretches,
 * and the thickness knob's ↑/↓ thickens. Same keys, three different sentences
 * in the help dialog.
 */
export const HANDLE_HOTKEY_DATA = {
  resize: new HotkeyData({
    keys: ["arrowUp", "arrowDown"],
    keyboardHelpDialogLabelStringProperty: keyboardHelp.resizeStringProperty,
    repoName: REPO_NAME,
  }),

  tilt: new HotkeyData({
    keys: ["arrowLeft", "arrowRight"],
    keyboardHelpDialogLabelStringProperty: keyboardHelp.tiltStringProperty,
    repoName: REPO_NAME,
  }),

  stretchEllipse: new HotkeyData({
    keys: ["arrowUp", "arrowDown"],
    keyboardHelpDialogLabelStringProperty: keyboardHelp.stretchEllipseStringProperty,
    repoName: REPO_NAME,
  }),

  rotateEllipse: new HotkeyData({
    keys: ["arrowLeft", "arrowRight"],
    keyboardHelpDialogLabelStringProperty: keyboardHelp.rotateEllipseStringProperty,
    repoName: REPO_NAME,
  }),

  airfoilThickness: new HotkeyData({
    keys: ["arrowUp", "arrowDown"],
    keyboardHelpDialogLabelStringProperty: keyboardHelp.airfoilThicknessStringProperty,
    repoName: REPO_NAME,
  }),

  smallerSteps: new HotkeyData({
    keys: ["shift+arrowUp", "shift+arrowDown", "shift+arrowLeft", "shift+arrowRight"],
    keyboardHelpDialogLabelStringProperty: keyboardHelp.smallerStepsStringProperty,
    repoName: REPO_NAME,
  }),
} as const;

/**
 * Every key string a handle listener responds to: the four arrows, plus the
 * four shifted arrows that make each step finer.
 */
export const HANDLE_KEYS = [
  "arrowUp",
  "arrowDown",
  "arrowLeft",
  "arrowRight",
  "shift+arrowUp",
  "shift+arrowDown",
  "shift+arrowLeft",
  "shift+arrowRight",
] as const satisfies readonly OneKeyStroke[];

export type ArrowKeyActions = {
  readonly up: (fine: boolean) => void;
  readonly down: (fine: boolean) => void;
  readonly left: (fine: boolean) => void;
  readonly right: (fine: boolean) => void;
};

/**
 * Builds the listener that maps the four arrow keys onto the given actions.
 * `fine` is true while Shift is held.
 *
 * The caller owns the returned listener: add it with `addInputListener` and
 * dispose it (after `removeInputListener`) when the node goes away.
 *
 * `fireOnHold` is on so a held arrow key sweeps the value the way the
 * KeyboardDragListener on the translation handle does, rather than stepping
 * once per physical keypress.
 */
export function createArrowKeyListener(actions: ArrowKeyActions): KeyboardListener<typeof HANDLE_KEYS> {
  return new KeyboardListener({
    keys: HANDLE_KEYS,
    fireOnHold: true,
    fire: (_event, keysPressed) => {
      const fine = keysPressed.startsWith("shift+");
      if (keysPressed.endsWith("arrowUp")) {
        actions.up(fine);
      } else if (keysPressed.endsWith("arrowDown")) {
        actions.down(fine);
      } else if (keysPressed.endsWith("arrowLeft")) {
        actions.left(fine);
      } else {
        actions.right(fine);
      }
    },
  });
}

/** The step to apply for one keypress, honouring the Shift modifier. */
export function keyboardStep(baseStep: number, fine: boolean): number {
  return fine ? baseStep / HANDLE_KEYBOARD_STEP_FACTOR : baseStep;
}
