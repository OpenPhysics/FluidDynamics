/**
 * VisualizationMode.ts
 *
 * Which field the display pass renders.
 *
 * Dye is the intuitive view — it is what a real dye-injection experiment looks
 * like. The other three expose what the dye only implies: `speed` shows the
 * acceleration around the obstacle's shoulders, `vorticity` makes the shear
 * layer and the individual shed vortices explicit (the clearest view of the
 * Kármán street), and `pressure` shows the low-pressure cores that drive them.
 *
 * The numeric codes are written into the uniform buffer and must agree with the
 * branch in shaders/display.wgsl.
 */

export const VISUALIZATION_MODES = ["dye", "speed", "vorticity", "pressure"] as const;

export type VisualizationMode = (typeof VISUALIZATION_MODES)[number];

/** Numeric code for a mode, as written into the uniform buffer. */
export function visualizationModeCode(mode: VisualizationMode): number {
  return VISUALIZATION_MODES.indexOf(mode);
}
