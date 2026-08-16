/**
 * Tests for the CPU/GPU uniform layout contract.
 *
 * WebGPU validates buffer sizes but not struct layouts: if the offsets in
 * FluidUniforms.ts drift from the SimUniforms declaration in common.wgsl, every
 * shader reads a shifted field and the failure looks like a physics bug rather
 * than a plumbing bug. These tests pin both sides of the contract.
 */

import { describe, expect, it } from "vitest";
import { FluidGridSpec } from "../src/common/gpu/FluidGridSpec.js";
import {
  FluidUniforms,
  type FluidUniformValues,
  UNIFORM_BUFFER_SIZE,
  UNIFORM_FLOAT_COUNT,
  UNIFORM_OFFSETS,
} from "../src/common/gpu/FluidUniforms.js";
import commonWGSL from "../src/common/gpu/shaders/common.wgsl?raw";

/** A fully-populated value set with a distinct number in every scalar field. */
function sampleValues(): FluidUniformValues {
  return {
    dyeColorA: [0.1, 0.2, 0.3, 0.4],
    dyeColorB: [0.5, 0.6, 0.7, 0.8],
    domainWidth: 2,
    domainHeight: 1,
    obstacleCenterX: 0.5,
    obstacleCenterY: 0.25,
    pointerX: 1.5,
    pointerY: 0.75,
    pointerDeltaX: -0.125,
    pointerDeltaY: 0.0625,
    dt: 1 / 60,
    viscosity: 1e-3,
    vorticity: 18,
    dyeDissipation: 0.75,
    inflowSpeed: 0.6,
    obstacleRadius: 0.075,
    obstacleShape: 1,
    obstacleAngle: 0.25,
    obstacleFocalRadius: 0.05,
    airfoilThickness: 0.12,
    visualization: 2,
    pointerActive: true,
    pointerRadius: 0.05,
    velocityScale: 3,
    time: 12.5,
  };
}

/**
 * Member names of the SimUniforms struct, in declaration order, read from the
 * WGSL source. Comment lines and blank lines are skipped; each member line looks
 * like `  name : type,`.
 */
function wgslStructMembers(): string[] {
  const match = commonWGSL.match(/struct SimUniforms \{([\s\S]*?)\n\}/);
  expect(match).not.toBeNull();
  const body = match?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line) => {
      const member = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
      expect(member, `unparsed struct line: ${line}`).not.toBeNull();
      return member?.[1] ?? "";
    });
}

describe("FluidUniforms layout", () => {
  it("keeps the buffer a multiple of 16 bytes, as WGSL struct alignment requires", () => {
    expect(UNIFORM_BUFFER_SIZE % 16).toBe(0);
    expect(UNIFORM_FLOAT_COUNT).toBe(UNIFORM_BUFFER_SIZE / 4);
  });

  it("matches the SimUniforms declaration in common.wgsl member for member", () => {
    expect(wgslStructMembers()).toEqual(Object.keys(UNIFORM_OFFSETS));
  });

  it("aligns vec4 members to 16 bytes and vec2 members to 8", () => {
    for (const name of ["dyeColorA", "dyeColorB"] as const) {
      expect(UNIFORM_OFFSETS[name] * 4, `${name} is a vec4`).toBe(Math.ceil((UNIFORM_OFFSETS[name] * 4) / 16) * 16);
    }
    for (const name of [
      "domainSize",
      "texelSize",
      "gridSize",
      "obstacleCenter",
      "pointerPos",
      "pointerDelta",
    ] as const) {
      expect((UNIFORM_OFFSETS[name] * 4) % 8, `${name} is a vec2`).toBe(0);
    }
  });

  it("leaves no gaps and no overlaps between members", () => {
    const vec4Members = new Set(["dyeColorA", "dyeColorB"]);
    const vec2Members = new Set([
      "domainSize",
      "texelSize",
      "gridSize",
      "obstacleCenter",
      "pointerPos",
      "pointerDelta",
    ]);

    let expectedIndex = 0;
    for (const [name, index] of Object.entries(UNIFORM_OFFSETS)) {
      expect(index, `${name} starts where the previous member ends`).toBe(expectedIndex);
      expectedIndex += vec4Members.has(name) ? 4 : vec2Members.has(name) ? 2 : 1;
    }
    // The members stop before the buffer does: the struct's own alignment (16,
    // from its vec4s) rounds 140 bytes of members up to the 144-byte buffer,
    // and only that round-up may sit between the last member and the end.
    expect(expectedIndex, "members are contiguous from the start").toBeLessThanOrEqual(UNIFORM_FLOAT_COUNT);
    expect(Math.ceil(expectedIndex / 4) * 4, "the buffer is the members rounded up to the struct's alignment").toBe(
      UNIFORM_FLOAT_COUNT,
    );
  });

  it("leaves the tail round-up unwritten and zero", () => {
    const data = new FluidUniforms().pack(sampleValues(), new FluidGridSpec(256, 128));
    const lastIndex = UNIFORM_OFFSETS.time + 1;
    expect(Array.from(data.slice(lastIndex, UNIFORM_FLOAT_COUNT))).toEqual(
      new Array(UNIFORM_FLOAT_COUNT - lastIndex).fill(0),
    );
  });
});

describe("FluidUniforms packing", () => {
  it("writes every value at its declared offset", () => {
    const grid = new FluidGridSpec(256, 128);
    const values = sampleValues();
    const data = new FluidUniforms().pack(values, grid);

    expect(Array.from(data.slice(UNIFORM_OFFSETS.dyeColorA, UNIFORM_OFFSETS.dyeColorA + 4))).toEqual(
      [0.1, 0.2, 0.3, 0.4].map(Math.fround),
    );
    expect(Array.from(data.slice(UNIFORM_OFFSETS.dyeColorB, UNIFORM_OFFSETS.dyeColorB + 4))).toEqual(
      [0.5, 0.6, 0.7, 0.8].map(Math.fround),
    );

    expect(data[UNIFORM_OFFSETS.domainSize]).toBe(2);
    expect(data[UNIFORM_OFFSETS.domainSize + 1]).toBe(1);
    expect(data[UNIFORM_OFFSETS.obstacleCenter]).toBe(0.5);
    expect(data[UNIFORM_OFFSETS.obstacleCenter + 1]).toBe(0.25);
    expect(data[UNIFORM_OFFSETS.pointerPos]).toBe(1.5);
    expect(data[UNIFORM_OFFSETS.pointerPos + 1]).toBe(0.75);
    expect(data[UNIFORM_OFFSETS.pointerDelta]).toBe(-0.125);
    expect(data[UNIFORM_OFFSETS.pointerDelta + 1]).toBe(0.0625);
    expect(data[UNIFORM_OFFSETS.vorticity]).toBe(18);
    expect(data[UNIFORM_OFFSETS.obstacleShape]).toBe(1);
    expect(data[UNIFORM_OFFSETS.obstacleAngle]).toBe(0.25);
    expect(data[UNIFORM_OFFSETS.obstacleFocalRadius]).toBe(Math.fround(0.05));
    expect(data[UNIFORM_OFFSETS.airfoilThickness]).toBe(Math.fround(0.12));
    expect(data[UNIFORM_OFFSETS.visualization]).toBe(2);
    expect(data[UNIFORM_OFFSETS.velocityScale]).toBe(3);
    expect(data[UNIFORM_OFFSETS.time]).toBe(12.5);
  });

  it("takes grid-derived values from the spec, not the caller", () => {
    const grid = new FluidGridSpec(512, 256);
    const data = new FluidUniforms().pack(sampleValues(), grid);

    expect(data[UNIFORM_OFFSETS.gridSize]).toBe(512);
    expect(data[UNIFORM_OFFSETS.gridSize + 1]).toBe(256);
    expect(data[UNIFORM_OFFSETS.texelSize]).toBe(1 / 512);
    expect(data[UNIFORM_OFFSETS.texelSize + 1]).toBe(1 / 256);
  });

  it("encodes pointerActive as 1 or 0", () => {
    const grid = new FluidGridSpec(256, 128);
    const uniforms = new FluidUniforms();

    expect(uniforms.pack({ ...sampleValues(), pointerActive: true }, grid)[UNIFORM_OFFSETS.pointerActive]).toBe(1);
    expect(uniforms.pack({ ...sampleValues(), pointerActive: false }, grid)[UNIFORM_OFFSETS.pointerActive]).toBe(0);
  });

  it("reuses one staging array rather than allocating per frame", () => {
    const grid = new FluidGridSpec(256, 128);
    const uniforms = new FluidUniforms();

    expect(uniforms.pack(sampleValues(), grid)).toBe(uniforms.data);
    expect(uniforms.pack(sampleValues(), grid)).toBe(uniforms.data);
  });
});
