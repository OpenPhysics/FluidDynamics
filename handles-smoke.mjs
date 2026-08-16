// handles-smoke.mjs
//
// Ad-hoc Playwright verification of the obstacle's direct-manipulation handles,
// in the same spirit as tools-smoke.mjs. Run with the dev server up:
//
//   npm run dev          # note the port Vite prints
//   node handles-smoke.mjs http://localhost:PORT
//
// Checks, per screen: the size/angle sliders are gone, the handle knobs are in
// the parallel DOM (and hidden exactly when their shape is not active), arrow
// keys and mouse drags change the canvas without page errors, and every shape
// (ellipse, plate, airfoil) renders. Screenshots land in test-results/handles/.

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL = `${process.argv[2] ?? "http://localhost:5179"}/`.replace(/\/+$/, "/");
const OUT = "test-results/handles";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const failures = [];
const pageErrors = [];
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};
page.on("pageerror", (err) => pageErrors.push(err.message));

// ── PDOM helpers ─────────────────────────────────────────────────────────────
// Knob hit areas are focusable divs whose accessible name is their text
// content, with the help text in the following sibling paragraph. Returns the
// unhidden knobs present on screen.
const knobs = () =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div[data-focusable="true"]')) {
      if (el.closest("[hidden]") !== null) continue;
      const help = (el.nextElementSibling?.textContent ?? "").trim();
      if (!help) continue;
      out.push({ name: (el.textContent ?? "").trim(), help: help.slice(0, 40), id: el.id });
    }
    return out;
  });

const focusKnob = async (helpPrefix) => {
  const list = await knobs();
  const knob = list.find((k) => k.help.startsWith(helpPrefix));
  if (!knob) throw new Error(`no knob with help starting "${helpPrefix}"`);
  await page.evaluate((id) => document.getElementById(id)?.focus(), knob.id);
};

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

// Mean absolute per-channel difference over the whole frame, as a 0..1
// fraction. With the sim paused this isolates obstacle changes from dye
// advection.
const fieldDiff = async (a, b) => {
  const dataA = `data:image/png;base64,${a.toString("base64")}`;
  const dataB = `data:image/png;base64,${b.toString("base64")}`;
  return page.evaluate(
    async ([urlA, urlB]) => {
      const load = (url) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext("2d").drawImage(img, 0, 0);
            resolve(canvas.getContext("2d").getImageData(0, 0, img.width, img.height).data);
          };
          img.src = url;
        });
      const [px, qx] = await Promise.all([load(urlA), load(urlB)]);
      let sum = 0;
      const n = Math.min(px.length, qx.length);
      for (let i = 0; i < n; i++) sum += Math.abs(px[i] - qx[i]);
      return sum / (n * 255);
    },
    [dataA, dataB],
  );
};

// The sim's ScreenView is 1024×618 letterboxed into the 1280×800 viewport at
// scale 1.25, with the 772.5px-tall content centred vertically.
const toPage = (x, y) => ({ x: x * 1.25, y: y * 1.25 + (800 - 618 * 1.25) / 2 });
const modelToPage = (mx, my) => toPage(20 + mx * 350, 70 + (1 - my) * 350);
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(400);
};
// Click a PDOM control by its exact text — the same synthetic activation a
// screen reader sends, which scenery handles exactly like a real press.
const clickByText = (text, role) =>
  page.evaluate(
    ([needle, wantedRole]) => {
      const matches = [...document.querySelectorAll(wantedRole ? `[role="${wantedRole}"], ${wantedRole}` : "[data-focusable='true'], button")]
        .filter((el) => !el.hidden && !(el.closest("[hidden]") !== null))
        .filter((el) => (el.textContent ?? "").trim().startsWith(needle));
      if (matches.length === 0) return false;
      matches[0].click();
      return true;
    },
    [text, role ?? null],
  );

const pause = async () => {
  await clickByText("Pause");
  await page.waitForTimeout(300);
};

// ── Lab screen ───────────────────────────────────────────────────────────────
await page.goto(`${URL}?initialScreen=2`);
await page.waitForTimeout(6000);

check("lab loads without page errors", pageErrors.length === 0);

const sliders = await page.evaluate(() =>
  [...document.querySelectorAll("input[aria-valuenow]")].map((el) => {
    const label = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby") ?? "";
    const ids = label.split(/\s+/).filter(Boolean);
    return ids.length
      ? ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
      : label;
  }),
);
check("lab has exactly the flow-speed and viscosity sliders", JSON.stringify(sliders) === JSON.stringify(["Flow Speed", "Viscosity"]));

await pause();
let labKnobs = await knobs();
check("lab shows position, size-angle and two focus knobs", (() => {
  const names = labKnobs.map((k) => k.help);
  return (
    names.filter((h) => h.startsWith("Drag to move")).length === 1 &&
    names.filter((h) => h.startsWith("Drag the knob toward")).length === 1 &&
    names.filter((h) => h.startsWith("Drag a focus")).length === 2 &&
    names.filter((h) => h.startsWith("Drag the knob up")).length === 0 // airfoil not active
  );
})());
await shot("lab-ellipse-default");

// Focus knob keyboard: pull the foci apart -> the disk must become an ellipse.
const before = await page.screenshot();
for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowUp");
await page.waitForTimeout(400);
const afterFocal = await page.screenshot();
const focalDiff = await fieldDiff(before, afterFocal);
check("focus arrow keys stretch the body", focalDiff > 0.005);
await shot("lab-ellipse-stretched");

// Size/angle knob keyboard: grow, then tilt.
await focusKnob("Drag the knob toward");
for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowUp");
await page.waitForTimeout(400);
const afterGrow = await page.screenshot();
check("size arrow keys change the canvas", (await fieldDiff(afterFocal, afterGrow)) > 0.005);
await shot("lab-ellipse-grown");

// Mouse drag the leading-edge knob: from its page position (grown ellipse,
// D≈0.3, angle 0 after the focal pull is at the current angle) — drag the body
// nose up-left to resize+tilt in one gesture.
const grown = { x: 0.5, y: 0.5 };
const nose = modelToPage(0.5 - 0.18, 0.5 + 0.05);
await drag(nose, modelToPage(grown.x - 0.42, grown.y + 0.3));
await shot("lab-ellipse-mouse-dragged");
check("mouse drag of nose knob does not error", pageErrors.length === 0);

// Shape switching through the combo box.
const pickShape = async (name) => {
  check(`combo box opens (${name})`, await clickByText("Obstacle shape"));
  await page.waitForTimeout(400);
  check(`option ${name} clickable`, await clickByText(name, "li"));
  await page.waitForTimeout(600);
};

await pickShape("Flat Plate");
labKnobs = await knobs();
check("plate hides the focus and thickness knobs", (() => {
  const names = labKnobs.map((k) => k.help);
  return names.filter((h) => h.startsWith("Drag a focus")).length === 0 && names.filter((h) => h.startsWith("Drag the knob up")).length === 0;
})());
await shot("lab-plate");

await pickShape("Airfoil");
labKnobs = await knobs();
check("airfoil shows the thickness knob", labKnobs.filter((k) => k.help.startsWith("Drag the knob up")).length === 1);
await shot("lab-airfoil");

// Thickness knob keyboard: fatten the foil.
await focusKnob("Drag the knob up");
const foilBefore = await page.screenshot();
for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowUp");
await page.waitForTimeout(400);
check("thickness arrow keys change the canvas", (await fieldDiff(foilBefore, await page.screenshot())) > 0.005);
await shot("lab-airfoil-fatter");

await pickShape("Ellipse");
labKnobs = await knobs();
check("ellipse restores the focus knobs", labKnobs.filter((k) => k.help.startsWith("Drag a focus")).length === 2);

// Body translation by pressing the body itself (mouse press on the centre).
const centre = modelToPage(0.5, 0.5);
await drag(centre, modelToPage(0.75, 0.42));
await shot("lab-body-translated");
check("body translation drag does not error", pageErrors.length === 0);

// ── Intro screen ─────────────────────────────────────────────────────────────
await page.goto(`${URL}?initialScreen=1`);
await page.waitForTimeout(5000);
await pause();
const introKnobs = await knobs();
check("intro shows position and size-angle knobs only", (() => {
  const names = introKnobs.map((k) => k.help);
  return (
    names.filter((h) => h.startsWith("Drag to move")).length === 1 &&
    names.filter((h) => h.startsWith("Drag the knob toward")).length === 1 &&
    names.filter((h) => h.startsWith("Drag a focus")).length === 0 &&
    names.filter((h) => h.startsWith("Drag the knob up")).length === 0
  );
})());
await shot("intro-default");

const introBefore = await page.screenshot();
await focusKnob("Drag the knob toward");
for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowUp");
await page.waitForTimeout(400);
check("intro radius arrow keys change the canvas", (await fieldDiff(introBefore, await page.screenshot())) > 0.005);
await shot("intro-grown");

const introNose = modelToPage(0.5 - 0.0744, 0.5 + 0.0104);
await drag(introNose, modelToPage(0.5 - 0.25, 0.5 + 0.06));
await shot("intro-mouse-resized");
check("intro mouse resize does not error", pageErrors.length === 0);

// Reset All returns the body to its defaults (knob positions derived from the
// model, so this also exercises the reset path of the new properties).
await clickByText("Reset All");
await page.waitForTimeout(800);
await shot("intro-after-reset");
check("reset all does not error", pageErrors.length === 0);

check("no page errors across the whole run", pageErrors.length === 0);
if (pageErrors.length) console.log("page errors:", pageErrors);

await browser.close();
process.exit(failures.length ? 1 : 0);
