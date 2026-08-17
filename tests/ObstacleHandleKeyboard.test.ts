/**
 * Pins the contract between the handles' key bindings and the keyboard-help
 * dialog.
 *
 * Most of that contract holds by construction: FluidKeyboardHelpContent builds
 * its rows from these same HotkeyData objects, so a row cannot claim a key the
 * listener does not have. What construction does *not* guarantee is the other
 * direction — that every key the listener responds to is described somewhere,
 * and that every binding carries a label for the row to show. Both are easy to
 * break by adding a key to one list and forgetting the other, which is the
 * failure this file exists to catch.
 */

import { describe, expect, it } from "vitest";
import { HANDLE_HOTKEY_DATA, HANDLE_KEYS, keyboardStep } from "../src/common/view/ObstacleHandleKeyboard.js";
import { HANDLE_KEYBOARD_STEP_FACTOR } from "../src/FluidDynamicsConstants.js";

const ALL_HOTKEY_DATA = Object.values(HANDLE_HOTKEY_DATA);

describe("handle hotkey data", () => {
  it("gives every binding a keyboard-help label, so no row can render blank", () => {
    for (const [name, data] of Object.entries(HANDLE_HOTKEY_DATA)) {
      expect(data.keyboardHelpDialogLabelStringProperty, `${name} has no help label`).not.toBeNull();
      expect(data.keyboardHelpDialogLabelStringProperty?.value, `${name}'s help label is empty`).toBeTruthy();
    }
  });

  it("documents every key the listener responds to", () => {
    for (const key of HANDLE_KEYS) {
      const documented = ALL_HOTKEY_DATA.some((data) => data.hasKeyStroke(key));
      expect(documented, `${key} fires the listener but appears in no HotkeyData`).toBe(true);
    }
  });

  it("binds every documented key, so the dialog cannot promise a key that does nothing", () => {
    const bound = new Set<string>(HANDLE_KEYS);
    for (const [name, data] of Object.entries(HANDLE_HOTKEY_DATA)) {
      for (const keyProperty of data.keyStringProperties) {
        expect(bound.has(keyProperty.value), `${name} documents ${keyProperty.value}, which nothing binds`).toBe(true);
      }
    }
  });

  it("covers each arrow with both a plain and a shifted binding", () => {
    for (const arrow of ["arrowUp", "arrowDown", "arrowLeft", "arrowRight"]) {
      expect(HANDLE_KEYS, `${arrow} is not bound`).toContain(arrow);
      // Spelled out separately because a listener bound to "arrowUp" alone does
      // not fire while shift is held — modifiers suppress unmodified combos.
      expect(HANDLE_KEYS, `shift+${arrow} is not bound`).toContain(`shift+${arrow}`);
    }
  });
});

describe("keyboardStep", () => {
  it("returns the base step when shift is not held", () => {
    expect(keyboardStep(0.01, false)).toBe(0.01);
  });

  it("divides by the shared factor when shift is held", () => {
    expect(keyboardStep(0.01, true)).toBeCloseTo(0.01 / HANDLE_KEYBOARD_STEP_FACTOR, 12);
  });

  it("makes the fine step strictly smaller, whatever the factor is set to", () => {
    expect(keyboardStep(1, true)).toBeLessThan(keyboardStep(1, false));
  });
});
