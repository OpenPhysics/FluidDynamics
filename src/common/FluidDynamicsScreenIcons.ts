/**
 * FluidDynamicsScreenIcons.ts
 *
 * Programmatic home-screen / navigation-bar icons, drawn on the standard PhET
 * 548 × 373 canvas.
 *
 * Each icon shows the flow its screen is about: the Intro icon has streamlines
 * parting smoothly around a cylinder and closing behind it, the Lab icon has the
 * same cylinder with a Kármán vortex street behind it. Both are hand-drawn
 * Béziers rather than a rendered frame of the solver — an icon has to be legible
 * at 40 px in a navigation bar, which a real dye field is not, and rendering one
 * would mean spinning up a GPUDevice before the sim has started.
 */
import { Shape } from "scenerystack/kite";
import { Circle, Node, Path, Rectangle } from "scenerystack/scenery";
import { ScreenIcon } from "scenerystack/sim";
import FluidDynamicsColors from "../FluidDynamicsColors.js";

const W = 548;
const H = 373;

/** Centre of the cylinder, matching the model's default obstacle position. */
const BODY_X = W * 0.3;
const BODY_Y = H * 0.5;
const BODY_R = H * 0.11;

function background(): Rectangle {
  return new Rectangle(0, 0, W, H, { fill: FluidDynamicsColors.backgroundColorProperty });
}

function body(): Circle {
  return new Circle(BODY_R, {
    centerX: BODY_X,
    centerY: BODY_Y,
    fill: FluidDynamicsColors.panelBackgroundColorProperty,
    stroke: FluidDynamicsColors.textColorProperty,
    lineWidth: 3,
  });
}

function iconFrom(content: Node): ScreenIcon {
  return new ScreenIcon(content, {
    maxIconWidthProportion: 1,
    maxIconHeightProportion: 1,
    fill: FluidDynamicsColors.backgroundColorProperty,
  });
}

/**
 * A streamline that parts around the body and rejoins downstream. `offset` is
 * the line's distance from the centreline at the inflow, signed.
 */
function streamline(offset: number): Path {
  const y = BODY_Y + offset;
  // How far the line is pushed aside, falling off with distance from the body.
  const deflection = (BODY_R * 1.5 * Math.sign(offset)) / (1 + (offset / BODY_R) ** 2);

  const shape = new Shape()
    .moveTo(0, y)
    .lineTo(BODY_X - BODY_R * 2.4, y)
    .cubicCurveTo(BODY_X - BODY_R, y, BODY_X - BODY_R, y + deflection, BODY_X, y + deflection)
    .cubicCurveTo(BODY_X + BODY_R, y + deflection, BODY_X + BODY_R, y, BODY_X + BODY_R * 2.4, y)
    .lineTo(W, y);

  return new Path(shape, {
    stroke: offset < 0 ? FluidDynamicsColors.dyeColorBProperty : FluidDynamicsColors.dyeColorAProperty,
    lineWidth: 9,
  });
}

/** One vortex of the street: a spiral of the given handedness. */
function vortex(centerX: number, centerY: number, clockwise: boolean): Path {
  const shape = new Shape();
  const turns = 1.75;
  const maxRadius = H * 0.13;
  const steps = 48;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = (clockwise ? -1 : 1) * t * turns * 2 * Math.PI;
    const radius = maxRadius * t;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    if (i === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  }

  return new Path(shape, {
    stroke: clockwise ? FluidDynamicsColors.dyeColorAProperty : FluidDynamicsColors.dyeColorBProperty,
    lineWidth: 8,
  });
}

/** Intro: smooth, attached flow past a cylinder. */
export function createIntroIcon(): ScreenIcon {
  return iconFrom(
    new Node({
      children: [background(), ...[-3, -2, -1, 1, 2, 3].map((n) => streamline(n * BODY_R * 0.85)), body()],
    }),
  );
}

/** Lab: the same cylinder, now shedding a Kármán vortex street. */
export function createLabIcon(): ScreenIcon {
  const inflow = [-3, -2, 2, 3].map((n) => streamline(n * BODY_R * 0.95));

  // Alternating sign, alternating side of the centreline — the defining
  // geometry of a vortex street.
  const street = [0, 1, 2].map((i) =>
    vortex(BODY_X + BODY_R * (3 + i * 3.2), BODY_Y + (i % 2 === 0 ? -1 : 1) * BODY_R * 1.1, i % 2 === 0),
  );

  return iconFrom(new Node({ children: [background(), ...inflow, ...street, body()] }));
}
