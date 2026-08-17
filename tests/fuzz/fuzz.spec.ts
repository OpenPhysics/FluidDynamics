/**
 * Optional Playwright fuzz smoke.
 *
 * Two runs: the pointer fuzz (`?fuzz`) and the keyboard fuzz (`?fuzzBoard`).
 * Both carry `&ea`, so a failed assertion is a failed test rather than a line
 * nobody reads.
 *
 * The keyboard run is not redundant with the pointer one. It is what exercises
 * the parallel DOM — where a CSP that blocks Scenery's inline `onclick`
 * handler shows up as a console error on every button activation, and the
 * pointer fuzz never touches those elements at all.
 *
 * Usage:
 *   npm run test:fuzz
 *   npm run test:fuzz:quick
 *   FUZZ_SEED=12345 npm run test:fuzz
 */

import { expect, type Page, test } from "@playwright/test";

const FUZZ_DURATION: number = parseInt(process.env["FUZZ_DURATION"] || "15", 10) * 1000;
const FUZZ_SEED: string = process.env["FUZZ_SEED"] || Math.floor(Math.random() * 1_000_000).toString();
const FUZZ_RATE: string = process.env["FUZZ_RATE"] || "100";
const FUZZ_POINTERS: string = process.env["FUZZ_POINTERS"] || "1";

interface ConsoleMessage {
  type: string;
  text: string;
  location: string;
  timestamp: number;
}

const FUZZ_MODES: readonly { readonly name: string; readonly query: string }[] = [
  { name: "pointer fuzz", query: `fuzz&fuzzRate=${FUZZ_RATE}&fuzzPointers=${FUZZ_POINTERS}` },
  { name: "keyboard fuzz", query: "fuzzBoard" },
];

test.describe("Fuzz Testing", () => {
  for (const mode of FUZZ_MODES) {
    test(`${mode.name} should run without console errors`, async ({ page }) => {
      await runFuzz(page, `/?${mode.query}&ea&randomSeed=${FUZZ_SEED}`);
    });
  }
});

async function runFuzz(page: Page, fuzzUrl: string): Promise<void> {
  const errors: ConsoleMessage[] = [];
  const assertions: ConsoleMessage[] = [];
  const startTime = Date.now();

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    const location = msg.location();
    const timestamp = Date.now() - startTime;
    const message: ConsoleMessage = {
      type,
      text,
      location: `${location.url}:${location.lineNumber}:${location.columnNumber}`,
      timestamp,
    };
    if (type === "error") {
      errors.push(message);
    } else if (text.includes("Assertion failed") || text.includes("AssertionError")) {
      assertions.push(message);
    }
  });

  page.on("pageerror", (error) => {
    errors.push({
      type: "pageerror",
      text: error.message,
      location: error.stack || "unknown",
      timestamp: Date.now() - startTime,
    });
  });

  await page.goto(fuzzUrl);
  await page.waitForSelector("#sim", { timeout: 30_000 });

  const checkInterval = 2000;
  let elapsed = 0;
  while (elapsed < FUZZ_DURATION) {
    const waitTime = Math.min(checkInterval, FUZZ_DURATION - elapsed);
    await page.waitForTimeout(waitTime);
    elapsed += waitTime;
    try {
      await page.evaluate(() => window.document.hasFocus);
    } catch {
      break;
    }
  }

  expect(
    errors.map((e) => e.text),
    `Found ${errors.length} console errors`,
  ).toEqual([]);
  expect(
    assertions.map((a) => a.text),
    `Found ${assertions.length} assertion failures`,
  ).toEqual([]);
}
