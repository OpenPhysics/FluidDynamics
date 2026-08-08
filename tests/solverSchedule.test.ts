/**
 * Tests for how hard the iterative solves are made to work.
 *
 * The viscous solve's sweep count and over-relaxation factor are derived from
 * α = νΔt/h² rather than pinned, which is what stops the fine grids from being
 * quietly less viscous than the Reynolds-number readout claims. Getting that
 * arithmetic wrong is invisible — the sim still runs, it is just solving a
 * different problem than the one on the label — so it is pinned here.
 *
 * The `diffusionOmega` formula is also evaluated, in the same closed form, by
 * shaders/diffuse.wgsl. These tests check the CPU half against the textbook
 * definition it is a simplification of; the WGSL half is a transcription of the
 * same three lines.
 */

import { describe, expect, it } from "vitest";
import { FluidGridSpec } from "../src/common/gpu/FluidGridSpec.js";
import {
  diffusionAlpha,
  diffusionConvergenceRate,
  diffusionOmega,
  diffusionSweeps,
} from "../src/common/gpu/solverSchedule.js";
import {
  DIFFUSION_RESIDUAL_TOLERANCE,
  DIFFUSION_SKIP_ALPHA,
  DIFFUSION_SWEEPS_MAX,
  MAX_PHYSICS_DT,
  VISCOSITY_DEFAULT,
  VISCOSITY_RANGE,
} from "../src/FluidDynamicsConstants.js";

/** Young's formula, written out, for the Jacobi radius of the viscous system. */
function textbookOmega(alpha: number): number {
  const jacobiRadius = (4 * alpha) / (1 + 4 * alpha);
  return 2 / (1 + Math.sqrt(1 - jacobiRadius * jacobiRadius));
}

const ALPHAS = [0, 1e-6, 1e-3, 0.01, 0.08, 0.273, 1, 5, 17.5, 27.3, 200, 1747];

describe("diffusionAlpha", () => {
  it("is νΔt/h²", () => {
    expect(diffusionAlpha(1e-3, 1 / 60, 1 / 128)).toBeCloseTo((1e-3 * (1 / 60)) / (1 / 128) ** 2, 9);
  });

  it("grows with the square of the resolution, which is why a fixed sweep count could not work", () => {
    const standard = diffusionAlpha(
      VISCOSITY_DEFAULT,
      MAX_PHYSICS_DT,
      FluidGridSpec.forResolution("standard").cellSize,
    );
    const ultra = diffusionAlpha(VISCOSITY_DEFAULT, MAX_PHYSICS_DT, FluidGridSpec.forResolution("ultraFine").cellSize);

    // Eight times the linear resolution, sixty-four times the stiffness.
    expect(ultra / standard).toBeCloseTo(64, 6);
  });

  it("is zero when the sim is paused", () => {
    expect(diffusionAlpha(VISCOSITY_DEFAULT, 0, 1 / 128)).toBe(0);
  });
});

describe("diffusionOmega", () => {
  it("agrees with Young's formula at every stiffness", () => {
    for (const alpha of ALPHAS) {
      expect(diffusionOmega(alpha), `α = ${alpha}`).toBeCloseTo(textbookOmega(alpha), 9);
    }
  });

  it("stays inside the convergent range (1, 2)", () => {
    for (const alpha of ALPHAS) {
      expect(diffusionOmega(alpha), `α = ${alpha}`).toBeGreaterThanOrEqual(1);
      expect(diffusionOmega(alpha), `α = ${alpha}`).toBeLessThan(2);
    }
  });

  it("collapses to Gauss–Seidel when the system is the identity", () => {
    expect(diffusionOmega(0)).toBe(1);
  });

  it("rises with stiffness", () => {
    const sorted = [...ALPHAS].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(diffusionOmega(sorted[i] ?? 0)).toBeGreaterThanOrEqual(diffusionOmega(sorted[i - 1] ?? 0));
    }
  });
});

describe("diffusionConvergenceRate", () => {
  it("beats the Jacobi rate it replaced, by more the stiffer the system is", () => {
    for (const alpha of [0.273, 1, 17.5, 27.3]) {
      const jacobi = (4 * alpha) / (1 + 4 * alpha);
      expect(diffusionConvergenceRate(alpha), `α = ${alpha}`).toBeLessThan(jacobi);
    }

    // The case that motivated the change: the default viscosity on the finest
    // grid, where twelve Jacobi sweeps removed almost none of the error.
    const alpha = diffusionAlpha(VISCOSITY_DEFAULT, MAX_PHYSICS_DT, FluidGridSpec.forResolution("ultraFine").cellSize);
    const jacobiAfter12 = ((4 * alpha) / (1 + 4 * alpha)) ** 12;
    const sorAfter12 = diffusionConvergenceRate(alpha) ** 12;

    expect(jacobiAfter12).toBeGreaterThan(0.5);
    expect(sorAfter12).toBeLessThan(0.05);
  });
});

describe("diffusionSweeps", () => {
  it("skips the solve entirely when every sweep would be the identity", () => {
    expect(diffusionSweeps(0)).toBe(0);
    expect(diffusionSweeps(DIFFUSION_SKIP_ALPHA / 2)).toBe(0);
    expect(diffusionSweeps(Number.NaN)).toBe(0);
  });

  it("runs at least one sweep as soon as the solve does anything", () => {
    expect(diffusionSweeps(DIFFUSION_SKIP_ALPHA)).toBeGreaterThanOrEqual(1);
  });

  it("never exceeds the cap, however stiff the system gets", () => {
    for (const alpha of ALPHAS) {
      expect(diffusionSweeps(alpha), `α = ${alpha}`).toBeLessThanOrEqual(DIFFUSION_SWEEPS_MAX);
    }
    expect(diffusionSweeps(1e9)).toBe(DIFFUSION_SWEEPS_MAX);
  });

  it("asks for enough sweeps to reach the tolerance whenever the cap allows it", () => {
    for (const alpha of ALPHAS) {
      const sweeps = diffusionSweeps(alpha);
      if (sweeps === 0 || sweeps === DIFFUSION_SWEEPS_MAX) {
        continue;
      }
      expect(diffusionConvergenceRate(alpha) ** sweeps, `α = ${alpha}`).toBeLessThanOrEqual(
        DIFFUSION_RESIDUAL_TOLERANCE,
      );
      // …and not one sweep more than it needs.
      expect(diffusionConvergenceRate(alpha) ** (sweeps - 1), `α = ${alpha} is not overspent`).toBeGreaterThan(
        DIFFUSION_RESIDUAL_TOLERANCE,
      );
    }
  });

  it("asks for more sweeps as the system stiffens", () => {
    const sorted = [...ALPHAS].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(diffusionSweeps(sorted[i] ?? 0)).toBeGreaterThanOrEqual(diffusionSweeps(sorted[i - 1] ?? 0));
    }
  });

  it("costs less than the twelve fixed sweeps it replaced at the settings both screens open on", () => {
    const cellSize = FluidGridSpec.forResolution("standard").cellSize;
    const sweeps = diffusionSweeps(diffusionAlpha(VISCOSITY_DEFAULT, MAX_PHYSICS_DT, cellSize));

    // Each sweep is a red dispatch and a black one, plus the seeding dispatch.
    expect(2 * sweeps + 1).toBeLessThan(12);
  });

  it("stays bounded across the whole parameter space the sliders can reach", () => {
    for (const resolution of ["standard", "fine", "veryFine", "ultraFine"] as const) {
      const cellSize = FluidGridSpec.forResolution(resolution).cellSize;
      for (const viscosity of [VISCOSITY_RANGE.min, VISCOSITY_DEFAULT, VISCOSITY_RANGE.max]) {
        const sweeps = diffusionSweeps(diffusionAlpha(viscosity, MAX_PHYSICS_DT, cellSize));
        expect(sweeps, `${resolution} at ν = ${viscosity}`).toBeGreaterThanOrEqual(1);
        expect(sweeps, `${resolution} at ν = ${viscosity}`).toBeLessThanOrEqual(DIFFUSION_SWEEPS_MAX);
      }
    }
  });
});
