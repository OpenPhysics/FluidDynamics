/**
 * Engine integration test — does the solver actually behave like a fluid?
 *
 * The whole fluid state lives in GPU textures, so none of it is reachable from
 * Vitest. This test drives the real engine in a real browser through
 * tests/harness/engine.html (served and transpiled by the Vite dev server), runs
 * actual compute passes, and reads the rendered frame back with
 * WebGPUFluidEngine.readDisplayPixels().
 *
 * ── Requirements ──────────────────────────────────────────────────────────────
 * A WebGPU adapter. Chromium needs `--enable-unsafe-webgpu --enable-features=Vulkan`
 * on Linux; playwright.config.ts passes them. Where no adapter is available the
 * tests skip rather than fail, since that is also the configuration in which the
 * sim correctly shows its "WebGPU is not available" message.
 *
 * Presentation is disabled in the harness: some headless environments lose the
 * device the moment a WebGPU canvas is presented, while compute and offscreen
 * rendering work correctly.
 */

import { expect, type Page, test } from "@playwright/test";

const WIDTH = 2048;
const HEIGHT = 1024;

/** One rendered frame, with pixel access in the field's own orientation. */
class Frame {
  private readonly bytes: Uint8Array;
  private readonly redOffset: number;
  private readonly blueOffset: number;

  public constructor(bytes: number[], format: string) {
    this.bytes = Uint8Array.from(bytes);
    // getPreferredCanvasFormat is bgra8unorm on most desktops, so channel order
    // cannot be assumed.
    this.redOffset = format === "bgra8unorm" ? 2 : 0;
    this.blueOffset = format === "bgra8unorm" ? 0 : 2;
  }

  /**
   * @param u - 0 at the inflow edge, 1 at the outflow edge
   * @param v - 0 at the bottom wall, 1 at the top wall
   */
  public at(u: number, v: number): { r: number; g: number; b: number } {
    const x = Math.min(WIDTH - 1, Math.max(0, Math.round(u * (WIDTH - 1))));
    // Row 0 of the readback is the top of the image, which is v = 1.
    const y = Math.min(HEIGHT - 1, Math.max(0, Math.round((1 - v) * (HEIGHT - 1))));
    const i = (y * WIDTH + x) * 4;
    return {
      r: this.bytes[i + this.redOffset] ?? 0,
      g: this.bytes[i + 1] ?? 0,
      b: this.bytes[i + this.blueOffset] ?? 0,
    };
  }

  public brightness(u: number, v: number): number {
    const { r, g, b } = this.at(u, v);
    return (r + g + b) / 3;
  }

  /** Mean brightness down a vertical line, used to find where the wake is. */
  public columnBrightness(u: number, samples = 64): number {
    let total = 0;
    for (let i = 0; i < samples; i++) {
      total += this.brightness(u, (i + 0.5) / samples);
    }
    return total / samples;
  }
}

type Harness = {
  start: (resolution?: string) => Promise<{ ok: boolean; reason?: string; format?: string }>;
  run: (steps: number, dt: number, overrides?: Record<string, unknown>) => { running: boolean; time: number };
  pixels: () => Promise<number[]>;
  reset: () => void;
  dispose: () => void;
};

declare global {
  interface Window {
    harness: Harness;
    harnessReady?: boolean;
  }
}

async function startEngine(page: Page): Promise<string | null> {
  await page.goto("/tests/harness/engine.html");
  await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 30_000 });
  const result = await page.evaluate(() => window.harness.start());
  return result.ok ? (result.format ?? "rgba8unorm") : null;
}

async function render(page: Page, format: string, steps: number, overrides: Record<string, unknown>): Promise<Frame> {
  const status = await page.evaluate(
    ([s, o]) => window.harness.run(s as number, 1 / 60, o as Record<string, unknown>),
    [steps, overrides] as const,
  );
  expect(status.running, "the device survived the run").toBe(true);
  return new Frame(await page.evaluate(() => window.harness.pixels()), format);
}

test.describe("WebGPU fluid engine", () => {
  // The solver runs hundreds of steps per case; the default 30 s is not enough
  // on a software rasterizer.
  test.setTimeout(180_000);

  test("dye is carried downstream and around a cylinder", async ({ page }) => {
    const format = await startEngine(page);
    test.skip(format === null, "no WebGPU adapter available");
    if (format === null) {
      return;
    }

    const frame = await render(page, format, 240, { inflowSpeed: 1, viscosity: 1e-3 });

    // Dye is injected at the inflow, so the upstream edge must be coloured.
    expect(frame.brightness(0.02, 0.5), "dye at the inflow").toBeGreaterThan(20);

    // …and advection must have carried it well past the obstacle.
    expect(frame.brightness(0.85, 0.2), "dye downstream").toBeGreaterThan(20);

    // The obstacle is drawn as a dark solid body at the centre of the channel.
    const body = frame.brightness(0.25, 0.5);
    const beside = frame.brightness(0.25, 0.1);
    expect(body, "the obstacle is darker than the free stream").toBeLessThan(beside);
  });

  test("the wake is steady at low Reynolds number and unsteady at high", async ({ page }) => {
    const format = await startEngine(page);
    test.skip(format === null, "no WebGPU adapter available");
    if (format === null) {
      return;
    }

    // This is the sim's central claim, so it is the thing most worth pinning:
    // below the shedding threshold the wake settles to a steady state and stops
    // changing, and above it the vortex street makes the wake change forever.
    //
    // Measured directly as how much the picture moves between two frames a third
    // of a second apart, in the vorticity view — which isolates the wake from
    // the uniform free stream around it.
    const unsteadiness = async (settleSteps: number, overrides: Record<string, unknown>): Promise<number> => {
      const before = await render(page, format, settleSteps, { ...overrides, visualization: 2 });
      const after = await render(page, format, 20, { ...overrides, visualization: 2 });

      let total = 0;
      let samples = 0;
      // The wake region: downstream of the obstacle, spanning the channel.
      for (let i = 0; i <= 20; i++) {
        const u = 0.35 + i * 0.03;
        for (let j = 0; j <= 10; j++) {
          const v = 0.25 + j * 0.05;
          total += Math.abs(before.brightness(u, v) - after.brightness(u, v));
          samples++;
        }
      }
      return total / samples;
    };

    // Re ≈ 4.5, firmly in the creeping regime. Long enough to settle: at
    // 0.3 m/s the fluid crosses the 2 m channel in about 7 seconds.
    await page.evaluate(() => window.harness.reset());
    const steady = await unsteadiness(600, { inflowSpeed: 0.3, viscosity: 1e-2 });

    // Re ≈ 150, well past the shedding threshold.
    await page.evaluate(() => window.harness.reset());
    const shedding = await unsteadiness(600, { inflowSpeed: 1, viscosity: 1e-3 });

    expect(steady, "the low-Reynolds wake has settled").toBeLessThan(3);
    expect(shedding, "the vortex street keeps the wake moving").toBeGreaterThan(steady * 3);
  });

  test("reset returns the field to a channel with no dye", async ({ page }) => {
    const format = await startEngine(page);
    test.skip(format === null, "no WebGPU adapter available");
    if (format === null) {
      return;
    }

    const before = await render(page, format, 120, { inflowSpeed: 1 });
    expect(before.columnBrightness(0.6), "dye reached mid-channel").toBeGreaterThan(10);

    await page.evaluate(() => window.harness.reset());
    // A single zero-length step re-renders without advancing the fluid.
    const after = await render(page, format, 1, { inflowSpeed: 1 });

    // Only the freshly injected inflow strip should carry dye.
    expect(after.columnBrightness(0.6), "downstream is clear after reset").toBeLessThan(
      before.columnBrightness(0.6) / 2,
    );
  });

  test("every visualization mode renders something", async ({ page }) => {
    const format = await startEngine(page);
    test.skip(format === null, "no WebGPU adapter available");
    if (format === null) {
      return;
    }

    await render(page, format, 240, { inflowSpeed: 1 });

    for (const visualization of [0, 1, 2, 3]) {
      const frame = await render(page, format, 1, { inflowSpeed: 1, visualization });
      // Every mode must put non-background colour somewhere in the wake region.
      const wake = frame.columnBrightness(0.45);
      expect(wake, `visualization ${visualization} is not blank`).toBeGreaterThan(2);
    }
  });

  test("every obstacle shape blocks the flow", async ({ page }) => {
    const format = await startEngine(page);
    test.skip(format === null, "no WebGPU adapter available");
    if (format === null) {
      return;
    }

    // Shape codes come from ObstacleShape.ts: 1 cylinder, 2 plate, 3 airfoil.
    for (const obstacleShape of [1, 2, 3]) {
      await page.evaluate(() => window.harness.reset());
      const frame = await render(page, format, 180, { inflowSpeed: 1, obstacleShape, visualization: 1 });

      // In the speed view the body is dark (no-slip) and the flow accelerating
      // past its shoulders is bright.
      const body = frame.brightness(0.25, 0.5);
      const shoulder = frame.brightness(0.25, 0.62);
      expect(shoulder, `shape ${obstacleShape} accelerates the flow past it`).toBeGreaterThan(body);
    }
  });

  test("with no obstacle the flow stays uniform across the channel", async ({ page }) => {
    const format = await startEngine(page);
    test.skip(format === null, "no WebGPU adapter available");
    if (format === null) {
      return;
    }

    const frame = await render(page, format, 240, { inflowSpeed: 1, obstacleShape: 0, visualization: 1 });

    // Speed view: with nothing to flow around, every column reads the same.
    const centre = frame.brightness(0.5, 0.5);
    for (const v of [0.25, 0.35, 0.65, 0.75]) {
      expect(Math.abs(frame.brightness(0.5, v) - centre), `uniform at v=${v}`).toBeLessThan(20);
    }
  });
});
