/**
 * ObstacleShape.ts
 *
 * The body the flow has to get around.
 *
 * Each shape is evaluated as a signed distance function in the WGSL shaders
 * rather than rasterized into a mask texture, so the obstacle can be dragged and
 * resized with no GPU resource churn — only a uniform changes. The numeric codes
 * below are what gets written into that uniform, so they must agree with the
 * `obstacleShape` branch in shaders/obstacle.wgsl.
 *
 * `erasableSyntaxOnly` rules out a TS enum, so this is an as-const union.
 */

export const OBSTACLE_SHAPES = ["none", "cylinder", "plate", "airfoil", "ellipse"] as const;

export type ObstacleShape = (typeof OBSTACLE_SHAPES)[number];

/**
 * The shapes the Lab screen offers. The ellipse at zero focal separation *is*
 * the disk, so offering "cylinder" beside it would be the same body twice; the
 * Intro screen keeps the cylinder, which it never lets the learner change.
 */
export const LAB_OBSTACLE_SHAPES = ["none", "ellipse", "plate", "airfoil"] as const;

/**
 * Numeric code for a shape, as written into the uniform buffer.
 *
 * The index in OBSTACLE_SHAPES is the code; going through this function rather
 * than `indexOf` at the call site keeps the contract with the shader explicit
 * and gives the unit test one place to pin.
 */
export function obstacleShapeCode(shape: ObstacleShape): number {
  return OBSTACLE_SHAPES.indexOf(shape);
}
