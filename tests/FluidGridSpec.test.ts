/**
 * Tests for the solver grid geometry.
 *
 * Dispatch arithmetic is worth pinning because getting it wrong is silent: too
 * few workgroups leaves a strip of cells frozen, which reads as a rendering
 * artefact rather than as an off-by-one.
 */

import { describe, expect, it } from "vitest";
import { FluidGridSpec, GRID_RESOLUTIONS } from "../src/common/gpu/FluidGridSpec.js";
import {
  CHANNEL_HEIGHT_M,
  CHANNEL_WIDTH_M,
  GRID_HEIGHT_DEFAULT,
  GRID_HEIGHT_FINE,
  GRID_HEIGHT_ULTRA_FINE,
  GRID_HEIGHT_VERY_FINE,
  GRID_WIDTH_DEFAULT,
  GRID_WIDTH_FINE,
  GRID_WIDTH_ULTRA_FINE,
  GRID_WIDTH_VERY_FINE,
  WORKGROUP_SIZE,
} from "../src/FluidDynamicsConstants.js";

describe("FluidGridSpec resolutions", () => {
  it("maps each named resolution to its grid", () => {
    const standard = FluidGridSpec.forResolution("standard");
    expect([standard.width, standard.height]).toEqual([GRID_WIDTH_DEFAULT, GRID_HEIGHT_DEFAULT]);

    const fine = FluidGridSpec.forResolution("fine");
    expect([fine.width, fine.height]).toEqual([GRID_WIDTH_FINE, GRID_HEIGHT_FINE]);

    const veryFine = FluidGridSpec.forResolution("veryFine");
    expect([veryFine.width, veryFine.height]).toEqual([GRID_WIDTH_VERY_FINE, GRID_HEIGHT_VERY_FINE]);

    const ultraFine = FluidGridSpec.forResolution("ultraFine");
    expect([ultraFine.width, ultraFine.height]).toEqual([GRID_WIDTH_ULTRA_FINE, GRID_HEIGHT_ULTRA_FINE]);
  });

  it("keeps cells square at every resolution, so dye is never stretched", () => {
    for (const resolution of GRID_RESOLUTIONS) {
      const grid = FluidGridSpec.forResolution(resolution);
      expect(grid.width / grid.height, resolution).toBeCloseTo(CHANNEL_WIDTH_M / CHANNEL_HEIGHT_M, 10);
      expect(CHANNEL_WIDTH_M / grid.width, resolution).toBeCloseTo(CHANNEL_HEIGHT_M / grid.height, 10);
    }
  });

  it("reports the cell size in metres", () => {
    expect(new FluidGridSpec(256, 128).cellSize).toBeCloseTo(CHANNEL_WIDTH_M / 256, 12);
  });
});

describe("FluidGridSpec dispatch", () => {
  it("covers an exactly-divisible grid with no spare workgroups", () => {
    const grid = new FluidGridSpec(256, 128);
    expect(grid.dispatchX).toBe(256 / WORKGROUP_SIZE);
    expect(grid.dispatchY).toBe(128 / WORKGROUP_SIZE);
  });

  it("rounds up so a ragged grid is still fully covered", () => {
    const grid = new FluidGridSpec(WORKGROUP_SIZE * 3 + 1, WORKGROUP_SIZE * 2 + 7);
    expect(grid.dispatchX).toBe(4);
    expect(grid.dispatchY).toBe(3);
    expect(grid.dispatchX * WORKGROUP_SIZE).toBeGreaterThanOrEqual(grid.width);
    expect(grid.dispatchY * WORKGROUP_SIZE).toBeGreaterThanOrEqual(grid.height);
  });

  it("never under-covers, for any grid size up to 600 cells", () => {
    for (let size = 1; size <= 600; size++) {
      const grid = new FluidGridSpec(size, size);
      expect(grid.dispatchX * WORKGROUP_SIZE, `width ${size}`).toBeGreaterThanOrEqual(size);
      expect((grid.dispatchX - 1) * WORKGROUP_SIZE, `width ${size} is not over-covered`).toBeLessThan(size);
    }
  });

  it("reports texel size and cell count", () => {
    const grid = new FluidGridSpec(256, 128);
    expect(grid.texelWidth).toBe(1 / 256);
    expect(grid.texelHeight).toBe(1 / 128);
    expect(grid.cellCount).toBe(256 * 128);
  });
});

describe("FluidGridSpec coordinates", () => {
  it("maps the channel corners to the unit square", () => {
    const grid = FluidGridSpec.forResolution("standard");
    expect(grid.metresToUV(0, 0)).toEqual({ u: 0, v: 0 });
    expect(grid.metresToUV(CHANNEL_WIDTH_M, CHANNEL_HEIGHT_M)).toEqual({ u: 1, v: 1 });
    expect(grid.metresToUV(CHANNEL_WIDTH_M / 2, CHANNEL_HEIGHT_M / 2)).toEqual({ u: 0.5, v: 0.5 });
  });
});
