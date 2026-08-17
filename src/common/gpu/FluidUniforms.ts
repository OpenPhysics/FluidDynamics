/**
 * FluidUniforms.ts
 *
 * CPU-side mirror of the `SimUniforms` struct in shaders/common.wgsl.
 *
 * WebGPU does no layout checking: if the offsets here drift from the struct
 * there, every shader silently reads the wrong field and the simulation
 * misbehaves in ways that look like a physics bug. So this module owns the
 * offsets explicitly, and tests/FluidUniforms.test.ts asserts that the member
 * order in the WGSL source still matches.
 *
 * ── Layout ────────────────────────────────────────────────────────────────────
 * WGSL uniform layout rules: f32 aligns to 4, vec2<f32> to 8, vec4<f32> to 16,
 * and a struct's size is rounded up to its own alignment. Members are declared
 * widest-first so none of them needs implicit padding:
 *
 *   byte  0   dyeColorA      vec4  (align 16)
 *   byte 16   dyeColorB      vec4
 *   byte 32   domainSize     vec2  (align 8)
 *   byte 40   texelSize      vec2
 *   byte 48   gridSize       vec2
 *   byte 56   obstacleCenter vec2
 *   byte 64   pointerPos     vec2
 *   byte 72   pointerDelta   vec2
 *   byte 80   dt             f32   (align 4)
 *   …         fifteen more f32, the last of which is `tracerEmitBatch`
 *   byte 144  end            — a multiple of 16, as the struct's alignment requires
 *
 * The members happen to fill the buffer exactly. They need not: the size only
 * has to be at least the struct's own rounded-up size and itself a multiple of
 * 16, so a member added here may leave a few unwritten bytes of round-up at the
 * end, as one did before `tracerEmitBatch` closed the gap.
 */

import type { FluidGridSpec } from "./FluidGridSpec.js";

/** Size of the uniform buffer in bytes. Must stay a multiple of 16. */
export const UNIFORM_BUFFER_SIZE = 144;

/** Size of the uniform buffer in 32-bit words. */
export const UNIFORM_FLOAT_COUNT = UNIFORM_BUFFER_SIZE / 4;

/**
 * Index of each member in the Float32Array staging buffer (byte offset / 4).
 * Vector members give the index of their first component.
 *
 * Key order is the member order in the WGSL struct, and the test relies on that.
 */
export const UNIFORM_OFFSETS = {
  dyeColorA: 0,
  dyeColorB: 4,
  domainSize: 8,
  texelSize: 10,
  gridSize: 12,
  obstacleCenter: 14,
  pointerPos: 16,
  pointerDelta: 18,
  dt: 20,
  viscosity: 21,
  vorticity: 22,
  dyeDissipation: 23,
  inflowSpeed: 24,
  obstacleRadius: 25,
  obstacleShape: 26,
  obstacleAngle: 27,
  obstacleFocalRadius: 28,
  airfoilThickness: 29,
  visualization: 30,
  pointerActive: 31,
  pointerRadius: 32,
  velocityScale: 33,
  time: 34,
  tracerEmitBatch: 35,
} as const;

/** Everything the shaders need to know about one simulation step. */
export type FluidUniformValues = {
  readonly dyeColorA: readonly [number, number, number, number];
  readonly dyeColorB: readonly [number, number, number, number];
  readonly domainWidth: number;
  readonly domainHeight: number;
  readonly obstacleCenterX: number;
  readonly obstacleCenterY: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly pointerDeltaX: number;
  readonly pointerDeltaY: number;
  readonly dt: number;
  readonly viscosity: number;
  readonly vorticity: number;
  readonly dyeDissipation: number;
  readonly inflowSpeed: number;
  readonly obstacleRadius: number;
  readonly obstacleShape: number;
  /** Angle of attack in radians; see FluidModel.obstacleAngle. */
  readonly obstacleAngle: number;
  /** Ellipse focal half-separation in metres; see FluidModel.obstacleFocalRadiusProperty. */
  readonly obstacleFocalRadius: number;
  /** Airfoil thickness as a fraction of chord; see FluidModel.airfoilThicknessProperty. */
  readonly airfoilThickness: number;
  readonly visualization: number;
  readonly pointerActive: boolean;
  readonly pointerRadius: number;
  readonly velocityScale: number;
  /** Elapsed simulation time in seconds; seeds the inflow perturbation. */
  readonly time: number;
  /**
   * Column of tracer dots released at the inlet this step, or NO_TRACER_RELEASE.
   * Owned by the engine's release clock rather than by the view — see
   * tracerSchedule.ts.
   */
  readonly tracerEmitBatch: number;
};

/**
 * Owns the staging Float32Array written to the GPU each frame.
 *
 * One allocation for the life of the engine: `pack()` overwrites in place, so a
 * 60 fps solver does not generate 60 garbage arrays per second.
 */
export class FluidUniforms {
  /** The staging buffer. Pass directly to GPUQueue.writeBuffer. */
  public readonly data: Float32Array;

  public constructor() {
    this.data = new Float32Array(UNIFORM_FLOAT_COUNT);
  }

  /**
   * Writes one frame's values into the staging buffer.
   *
   * Grid-derived values (gridSize, texelSize) come from the spec rather than the
   * caller, so they cannot disagree with the textures that were allocated.
   */
  public pack(values: FluidUniformValues, grid: FluidGridSpec): Float32Array {
    const d = this.data;
    const o = UNIFORM_OFFSETS;

    d.set(values.dyeColorA, o.dyeColorA);
    d.set(values.dyeColorB, o.dyeColorB);

    d[o.domainSize] = values.domainWidth;
    d[o.domainSize + 1] = values.domainHeight;

    d[o.texelSize] = grid.texelWidth;
    d[o.texelSize + 1] = grid.texelHeight;

    d[o.gridSize] = grid.width;
    d[o.gridSize + 1] = grid.height;

    d[o.obstacleCenter] = values.obstacleCenterX;
    d[o.obstacleCenter + 1] = values.obstacleCenterY;

    d[o.pointerPos] = values.pointerX;
    d[o.pointerPos + 1] = values.pointerY;

    d[o.pointerDelta] = values.pointerDeltaX;
    d[o.pointerDelta + 1] = values.pointerDeltaY;

    d[o.dt] = values.dt;
    d[o.viscosity] = values.viscosity;
    d[o.vorticity] = values.vorticity;
    d[o.dyeDissipation] = values.dyeDissipation;
    d[o.inflowSpeed] = values.inflowSpeed;
    d[o.obstacleRadius] = values.obstacleRadius;
    d[o.obstacleShape] = values.obstacleShape;
    d[o.obstacleAngle] = values.obstacleAngle;
    d[o.obstacleFocalRadius] = values.obstacleFocalRadius;
    d[o.airfoilThickness] = values.airfoilThickness;
    d[o.visualization] = values.visualization;
    d[o.pointerActive] = values.pointerActive ? 1 : 0;
    d[o.pointerRadius] = values.pointerRadius;
    d[o.velocityScale] = values.velocityScale;
    d[o.time] = values.time;
    d[o.tracerEmitBatch] = values.tracerEmitBatch;

    return d;
  }
}
