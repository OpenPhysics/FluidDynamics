/**
 * FluidDynamicsConstants.ts
 *
 * Central repository for every named numeric constant used across the
 * simulation. Bare numbers that carry semantic meaning (sizes, margins,
 * physics defaults, ranges) belong here rather than inline in model or view
 * code, so they are named, documented, and changed in one place.
 *
 * Conventions
 * ───────────
 *  - Physics / model values use SI units (metres, seconds, kilograms, …);
 *    note the unit in a comment on each value.
 *  - Layout / chrome values are in screen pixels.
 *  - Colour strings live in FluidDynamicsColors.ts, not here.
 *  - Computed expressions (e.g. `2 * Math.PI`) may stay inline.
 *
 * Remove the example constants below and replace them with the sim's own.
 */

import { Bounds2, Range, Vector2 } from "scenerystack/dot";
import FluidDynamicsNamespace from "./FluidDynamicsNamespace.js";

// ── Layout / chrome (screen pixels) ───────────────────────────────────────────

/** Margin between the screen edge and edge-anchored controls (e.g. Reset All). */
export const SCREEN_VIEW_MARGIN = 20;

/** Corner radius shared by control panels and dialogs. */
export const PANEL_CORNER_RADIUS = 6;

/**
 * The fluid field's rectangle in the 1024 × 618 ScreenView coordinate space.
 * Left-aligned and 2:1, leaving a control column on the right. The solver grid
 * has the same aspect ratio so the dye is never anisotropically stretched.
 */
export const FIELD_VIEW_BOUNDS = new Bounds2(20, 70, 720, 420);

/** Width of the control column to the right of the field, in screen pixels. */
export const CONTROL_PANEL_WIDTH = 264;

/** Font size for control labels and their value readouts. */
export const CONTROL_LABEL_FONT_SIZE = 14;

/** Font size for the Reynolds-number readout below the field. */
export const READOUT_FONT_SIZE = 17;

/** Title font size in the "WebGPU is not available" panel. */
export const WEBGPU_TITLE_FONT_SIZE = 20;

/** Body font size in the "WebGPU is not available" panel. */
export const WEBGPU_MESSAGE_FONT_SIZE = 15;

/** Wrap width for the "WebGPU is not available" message. */
export const WEBGPU_MESSAGE_MAX_WIDTH = 460;

// ── Fluid domain (SI units) ───────────────────────────────────────────────────

/** Width of the simulated channel, in metres. Matches FIELD_VIEW_BOUNDS' 2:1 aspect. */
export const CHANNEL_WIDTH_M = 2;

/** Height of the simulated channel, in metres. */
export const CHANNEL_HEIGHT_M = 1;

// ── Solver grid ───────────────────────────────────────────────────────────────

/** Default solver grid, in cells. 2:1 to match the channel, so cells stay square. */
export const GRID_WIDTH_DEFAULT = 256;
export const GRID_HEIGHT_DEFAULT = 128;

/** Higher-resolution grid, selectable on the Lab screen. */
export const GRID_WIDTH_FINE = 512;
export const GRID_HEIGHT_FINE = 256;

/**
 * Size of the canvas the solver renders into, in device pixels.
 *
 * Four times the standard grid's linear resolution: the display pass samples the
 * dye texture with a linear filter, so upscaling here costs one texture fetch
 * per pixel and removes the blockiness that a grid-sized canvas would show when
 * Scenery scales it up to the field's on-screen size.
 */
export const DISPLAY_CANVAS_WIDTH = 1024;
export const DISPLAY_CANVAS_HEIGHT = 512;

/**
 * Compute shader workgroup edge, in invocations. 8 × 8 = 64 invocations keeps
 * occupancy high on every tier of GPU without approaching the 256-invocation
 * per-workgroup limit that the WebGPU baseline guarantees.
 */
export const WORKGROUP_SIZE = 8;

/**
 * Jacobi iterations for the pressure Poisson solve. Below ~20 the velocity field
 * retains visible divergence (dye compresses and thins); above ~40 the cost is
 * real and the improvement is not visible.
 */
export const PRESSURE_ITERATIONS_DEFAULT = 30;

/** Iterations with the "higher solver accuracy" preference enabled. */
export const PRESSURE_ITERATIONS_HIGH = 50;

export const PRESSURE_ITERATIONS_RANGE = new Range(1, 200);

/** Jacobi iterations for the implicit viscous diffusion solve. */
export const DIFFUSION_ITERATIONS = 12;

// ── Time stepping ─────────────────────────────────────────────────────────────

/**
 * Largest physics step taken in one substep, in seconds. A tab that was
 * backgrounded reports a huge dt; without a clamp the semi-Lagrangian backtrace
 * would jump most of the channel in a single step and the wake would blow away.
 */
export const MAX_PHYSICS_DT = 1 / 60;

/** Upper bound on substeps per frame, so a long stall cannot lock up the GPU. */
export const MAX_SUBSTEPS_PER_FRAME = 3;

// ── Flow parameters (SI units) ────────────────────────────────────────────────

/** Inflow speed at the left boundary, in m/s. */
export const FLOW_SPEED_RANGE = new Range(0.05, 3);
export const FLOW_SPEED_DEFAULT = 0.6;

/**
 * Kinematic viscosity ν, in m²/s. The range brackets the interesting Reynolds
 * numbers for the default obstacle: at U = 1 m/s and D = 0.15 m, ν = 3e-4 gives
 * Re = 500 and ν = 1e-1 gives Re = 1.5. Combined with the speed range, the whole
 * span from creeping flow to a turbulent wake is reachable.
 *
 * The floor is 3e-4 rather than lower for a numerical reason: pressure lives on
 * the same grid points as velocity, and that collocated arrangement admits a
 * checkerboard pressure mode which nothing damps once the physical viscosity
 * gets small enough. Below roughly 3e-4 it shows up as speckle on the obstacle's
 * surface. Removing it properly would mean a staggered (MAC) grid.
 */
export const VISCOSITY_RANGE = new Range(3e-4, 1e-1);
export const VISCOSITY_DEFAULT = 1e-3;

/** Obstacle diameter D, in metres — the length scale in Re = U·D/ν. */
export const OBSTACLE_DIAMETER_RANGE = new Range(0.05, 0.35);
export const OBSTACLE_DIAMETER_DEFAULT = 0.15;

/**
 * Obstacle centre, in metres from the channel's lower-left corner. Placed a
 * quarter of the way downstream so there is inflow to develop upstream of it
 * and three quarters of the channel for the wake to form in.
 */
export const OBSTACLE_CENTER_DEFAULT = new Vector2(0.5, 0.5);

/**
 * Where the obstacle's centre may be dragged, in metres.
 *
 * Clear of the inflow strip on the left (a body overlapping it would fight the
 * boundary condition that forces the velocity there), clear of the outflow on
 * the right, and clear of both walls so there is always room for a wake.
 */
export const OBSTACLE_DRAG_BOUNDS_M = new Bounds2(0.25, 0.25, 1.2, 0.75);

/** How fast a held arrow key moves the obstacle, in metres per second. */
export const OBSTACLE_KEYBOARD_SPEED_MPS = 0.4;

/**
 * Vorticity-confinement strength, dimensionless.
 *
 * Semi-Lagrangian advection is stable but dissipative: it damps exactly the
 * small-scale vorticity that makes a vortex street legible. Confinement adds a
 * force along the vorticity gradient to restore it. This is a visual-fidelity
 * correction, not a term in the Navier–Stokes equations — see doc/model.md.
 */
export const VORTICITY_RANGE = new Range(0, 40);
export const VORTICITY_DEFAULT = 18;

/**
 * Radius of the impulse a pointer drag applies, in metres. Comparable to the
 * default obstacle so a drag is a meaningful disturbance rather than a pinprick.
 */
export const POINTER_RADIUS_M = 0.08;

/**
 * Fraction of dye remaining after one second.
 *
 * Close to 1 because dye has to survive its whole trip down the channel: at the
 * slowest inflow speed that trip takes more than ten seconds, and anything much
 * below 0.99 leaves the downstream half of the field black just where the wake
 * is most interesting. Its real job is to clear away dye the learner injected
 * with the pointer, not to fade the inflow bands.
 */
export const DYE_DISSIPATION_RANGE = new Range(0.9, 1);
export const DYE_DISSIPATION_DEFAULT = 0.99;

// ── Flow-regime thresholds (Reynolds number, dimensionless) ───────────────────
// Classical transition values for flow past a circular cylinder. See
// FlowRegime.ts for how they are applied and doc/model.md for their limits.

/** Below this the flow creeps around the obstacle with no separation. */
export const RE_SEPARATION = 5;

/** Onset of periodic vortex shedding — the Kármán street (a Hopf bifurcation). */
export const RE_SHEDDING_ONSET = 47;

/** Above this the shed vortices lose coherence and the wake reads as turbulent. */
export const RE_TURBULENT_ONSET = 200;

FluidDynamicsNamespace.register("FluidDynamicsConstants", {
  SCREEN_VIEW_MARGIN,
  PANEL_CORNER_RADIUS,
  FIELD_VIEW_BOUNDS,
  CONTROL_PANEL_WIDTH,
  CONTROL_LABEL_FONT_SIZE,
  READOUT_FONT_SIZE,
  WEBGPU_TITLE_FONT_SIZE,
  WEBGPU_MESSAGE_FONT_SIZE,
  WEBGPU_MESSAGE_MAX_WIDTH,
  CHANNEL_WIDTH_M,
  CHANNEL_HEIGHT_M,
  GRID_WIDTH_DEFAULT,
  GRID_HEIGHT_DEFAULT,
  GRID_WIDTH_FINE,
  GRID_HEIGHT_FINE,
  DISPLAY_CANVAS_WIDTH,
  DISPLAY_CANVAS_HEIGHT,
  WORKGROUP_SIZE,
  PRESSURE_ITERATIONS_DEFAULT,
  PRESSURE_ITERATIONS_HIGH,
  PRESSURE_ITERATIONS_RANGE,
  DIFFUSION_ITERATIONS,
  MAX_PHYSICS_DT,
  MAX_SUBSTEPS_PER_FRAME,
  FLOW_SPEED_RANGE,
  FLOW_SPEED_DEFAULT,
  VISCOSITY_RANGE,
  VISCOSITY_DEFAULT,
  OBSTACLE_DIAMETER_RANGE,
  OBSTACLE_DIAMETER_DEFAULT,
  OBSTACLE_CENTER_DEFAULT,
  OBSTACLE_DRAG_BOUNDS_M,
  OBSTACLE_KEYBOARD_SPEED_MPS,
  VORTICITY_RANGE,
  VORTICITY_DEFAULT,
  POINTER_RADIUS_M,
  DYE_DISSIPATION_RANGE,
  DYE_DISSIPATION_DEFAULT,
  RE_SEPARATION,
  RE_SHEDDING_ONSET,
  RE_TURBULENT_ONSET,
});
