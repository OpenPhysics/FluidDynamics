// scalebar-smoke.mjs
//
// Ad-hoc Playwright verification of the FluidScaleBarNode, in the same spirit
// as handles-smoke.mjs. Run with the dev server up:
//
//   npm run dev          # note the port Vite prints
//   node scalebar-smoke.mjs http://localhost:PORT
//
// Screenshots the Intro screen, the Lab screen and the French locale, so the
// bar's placement on the readout row and its label can be checked by eye.
// Results land in test-results/scalebar/.

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL = `${process.argv[2] ?? "http://localhost:5173"}/`.replace(/\/+$/, "/");
const OUT = "test-results/scalebar";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto(URL);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/intro.png` });

await page.click('button:has-text("Lab")');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/lab.png` });

await page.goto(`${URL}?locale=fr`);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/intro-fr.png` });

await browser.close();

if (pageErrors.length > 0) {
  console.log("FAIL page errors:");
  for (const err of pageErrors) console.log(`  ${err}`);
  process.exit(1);
}
console.log("PASS screenshots written to test-results/scalebar/");
