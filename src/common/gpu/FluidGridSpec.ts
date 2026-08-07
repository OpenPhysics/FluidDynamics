/**
 * FluidGridSpec.ts
 *
 * The solver's grid geometry, and the arithmetic that turns it into compute
 * dispatch sizes and model-space conversions.
 *
 * Kept free of any GPU or scenery dependency so it can be unit-tested directly:
 * off-by-one errors in dispatch counts are silent on the GPU (a strip of cells
 * simply never updates), so they need to be caught by a test rather than by eye.
 */

import {
  CHANNEL_HEIGHT_M,
  CHANNEL_WIDTH_M,
  GRID_HEIGHT_DEFAULT,
  GRID_HEIGHT_FINE,
  GRID_WIDTH_DEFAULT,
  GRID_WIDTH_FINE,
  WORKGROUP_SIZE,
} from "../../FluidDynamicsConstants.js";

/** Selectable solver resolutions. `erasableSyntaxOnly` rules out a TS enum. */
export const GRID_RESOLUTIONS = ["standard", "fine"] as const;

export type GridResolution = (typeof GRID_RESOLUTIONS)[number];

export class FluidGridSpec {
  /** Grid width in cells. */
  public readonly width: number;

  /** Grid height in cells. */
  public readonly height: number;

  /** Cell edge length in metres. Square cells — width/height match the channel aspect. */
  public readonly cellSize: number;

  public constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cellSize = CHANNEL_WIDTH_M / width;
  }

  /** The grid for a named resolution. */
  public static forResolution(resolution: GridResolution): FluidGridSpec {
    return resolution === "fine"
      ? new FluidGridSpec(GRID_WIDTH_FINE, GRID_HEIGHT_FINE)
      : new FluidGridSpec(GRID_WIDTH_DEFAULT, GRID_HEIGHT_DEFAULT);
  }

  /**
   * Workgroups to dispatch to cover every cell exactly once.
   *
   * Rounded up, so the shader must guard against invocations past the grid edge
   * — the last workgroup in each direction is only partly in bounds whenever the
   * grid is not a multiple of WORKGROUP_SIZE.
   */
  public get dispatchX(): number {
    return Math.ceil(this.width / WORKGROUP_SIZE);
  }

  public get dispatchY(): number {
    return Math.ceil(this.height / WORKGROUP_SIZE);
  }

  /** Total cells, i.e. the number of texels in each field texture. */
  public get cellCount(): number {
    return this.width * this.height;
  }

  /** 1/width, 1/height — the texel step used for finite differences in WGSL. */
  public get texelWidth(): number {
    return 1 / this.width;
  }

  public get texelHeight(): number {
    return 1 / this.height;
  }

  /**
   * Converts a point in metres from the channel's lower-left corner into
   * normalized texture coordinates (0..1 across the grid).
   *
   * Note that the two axes have different scales, so this must not be used on a
   * length: an isotropic radius in metres becomes an ellipse in uv. Shader-side
   * geometry (the obstacle SDF, splat radii) therefore works in metres, using
   * the domain size passed in the uniforms to convert uv back to metres.
   */
  public metresToUV(xMetres: number, yMetres: number): { readonly u: number; readonly v: number } {
    return { u: xMetres / CHANNEL_WIDTH_M, v: yMetres / CHANNEL_HEIGHT_M };
  }
}
