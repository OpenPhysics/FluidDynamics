import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL = "http://localhost:5199/";
const OUT = "test-results/tools-smoke";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const failures = [];
const pageErrors = [];
const log = (msg) => console.log(msg);
const check = (name, ok) => {
  log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};
page.on("pageerror", (err) => pageErrors.push(err.message));

// ── helpers ──────────────────────────────────────────────────────────────────
const centers = () =>
  page.evaluate(() => {
    const d = globalThis.__toolsDebug[0];
    const c = (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    return {
      tapeIcon: c(d.toolboxPanel.tapeIconNode.globalBounds),
      rulerIcon: c(d.toolboxPanel.rulerIconNode.globalBounds),
      toolbox: c(d.toolboxPanel.globalBounds),
      model: d.model,
      rulerPosition: { x: d.model.rulerPositionProperty.value.x, y: d.model.rulerPositionProperty.value.y },
    };
  });

const pdom = () =>
  page.evaluate(() => ({
    tapeOut: [...document.querySelectorAll("div")]
      .filter((x) => x.getAttribute("aria-label")?.includes("Tape"))
      .some((x) => !x.hasAttribute("hidden")),
    rulerOut: [...document.querySelectorAll("div")]
      .filter((x) => x.textContent?.trim() === "Ruler")
      .filter((x) => x.parentElement?.textContent.includes("Drag to move the ruler"))
      .some((x) => !x.hasAttribute("hidden")),
  }));

const modelState = () =>
  page.evaluate(() => ({
    tape: globalThis.__toolsDebug[0].model.measuringTapeVisibleProperty.value,
    ruler: globalThis.__toolsDebug[0].model.rulerVisibleProperty.value,
  }));

const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
};

// ── launch to the Intro screen ──────────────────────────────────────────────
await page.goto(URL);
await page.waitForTimeout(5000);
await page.getByRole("button", { name: "Intro Screen" }).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);

let C = await centers();
log(`tape icon at (${C.tapeIcon.x.toFixed(0)},${C.tapeIcon.y.toFixed(0)}), ruler icon at (${C.rulerIcon.x.toFixed(0)},${C.rulerIcon.y.toFixed(0)})`);

// ── tape: drag out, stretch, return ─────────────────────────────────────────
await drag(C.tapeIcon, { x: 450, y: 300 });
let m = await modelState();
let p = await pdom();
check("tape out (model + PDOM) after dragging its icon", m.tape && p.tapeOut);
await page.screenshot({ path: `${OUT}/02-tape-out.png` });

// The tip is the tape child that owns input listeners; its global bounds are the grab area.
const tipPoint = async () =>
  page.evaluate(() => {
    const t = globalThis.__toolsDebug[0].tapeNode;
    const tip = t.children.find((c) => c.getInputListeners().length > 0);
    const b = tip.globalBounds;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  });

const tip1 = await tipPoint();
await drag(tip1, { x: tip1.x + 90, y: tip1.y - 70 });
await page.screenshot({ path: `${OUT}/03-tape-stretched.png` });

// Return it by dropping the tip on the toolbox.
const tip2 = await tipPoint();
await drag(tip2, C.toolbox);
m = await modelState();
p = await pdom();
check("tape returned after dropping its tip on the toolbox", !m.tape && !p.tapeOut);
await page.screenshot({ path: `${OUT}/04-tape-returned.png` });

// ── tape: click the icon (no movement) toggles out, click again toggles in ──
await page.mouse.click(C.tapeIcon.x, C.tapeIcon.y);
await page.waitForTimeout(500);
m = await modelState();
p = await pdom();
check("tape out after a plain click on the icon", m.tape && p.tapeOut);
await page.mouse.click(C.tapeIcon.x, C.tapeIcon.y);
await page.waitForTimeout(500);
m = await modelState();
p = await pdom();
check("tape in after a second click on the icon", !m.tape && !p.tapeOut);

// ── ruler: drag out, keyboard-move, drag back ───────────────────────────────
C = await centers();
await drag(C.rulerIcon, { x: 420, y: 200 });
m = await modelState();
p = await pdom();
check("ruler out (model + PDOM) after dragging its icon", m.ruler && p.rulerOut);
await page.screenshot({ path: `${OUT}/05-ruler-out.png` });

const rulerCenter = await page.evaluate(() => {
  const d = globalThis.__toolsDebug[0];
  const b = d.rulerNode.globalBounds;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, minX: b.minX };
});
log(`ruler centre after take-out: (${rulerCenter.x.toFixed(0)},${rulerCenter.y.toFixed(0)})`);

// keyboard: focus the tool's PDOM element and arrow it sideways
await page.evaluate(() => {
  const el = [...document.querySelectorAll("div")]
    .filter((x) => x.textContent?.trim() === "Ruler")
    .find((x) => !x.hasAttribute("hidden") && x.parentElement?.textContent.includes("Drag to move the ruler"));
  el?.focus();
});
await page.waitForTimeout(300);
const before = await centers();
for (const key of ["ArrowRight", "ArrowRight", "ArrowUp"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);
const after = await centers();
const moved = after.rulerPosition.x > before.rulerPosition.x + 0.02 && after.rulerPosition.y > before.rulerPosition.y + 0.02;
check(`ruler keyboard-drag moved it (${before.rulerPosition.x.toFixed(2)},${before.rulerPosition.y.toFixed(2)}) → (${after.rulerPosition.x.toFixed(2)},${after.rulerPosition.y.toFixed(2)})`, moved);
await page.screenshot({ path: `${OUT}/06-ruler-keyboard-moved.png` });

// drag it back onto the toolbox
const rulerNow = await page.evaluate(() => {
  const b = globalThis.__toolsDebug[0].rulerNode.globalBounds;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
});
await drag(rulerNow, C.toolbox);
m = await modelState();
p = await pdom();
check("ruler returned after being dropped on the toolbox", !m.ruler && !p.rulerOut);
await page.screenshot({ path: `${OUT}/07-ruler-returned.png` });

// ── Reset All puts any tool back ─────────────────────────────────────────────
C = await centers();
await page.mouse.click(C.tapeIcon.x, C.tapeIcon.y);
await page.mouse.click(C.rulerIcon.x, C.rulerIcon.y);
await page.waitForTimeout(400);
m = await modelState();
check("both tools out before Reset All", m.tape && m.ruler);
await page.getByRole("button", { name: /Reset All/i }).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
m = await modelState();
p = await pdom();
check("Reset All returns both tools to the toolbox", !m.tape && !m.ruler && !p.tapeOut && !p.rulerOut);
await page.screenshot({ path: `${OUT}/08-after-reset-all.png` });

check("no page errors during the run", pageErrors.length === 0);
if (pageErrors.length > 0) log(`page errors: ${pageErrors.join(" | ")}`);

await browser.close();
log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECKS FAILED: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);
