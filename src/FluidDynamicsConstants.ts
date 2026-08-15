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

/** Higher still — four times the cell count of fine. */
export const GRID_WIDTH_VERY_FINE = 1024;
export const GRID_HEIGHT_VERY_FINE = 512;

/** Highest-resolution grid, selectable on the Lab screen. Four times the cell count of very fine. */
export const GRID_WIDTH_ULTRA_FINE = 2048;
export const GRID_HEIGHT_ULTRA_FINE = 1024;

/**
 * Size of the canvas the solver renders into, in device pixels.
 *
 * Matches the ultra-fine grid's linear resolution: the display pass samples the
 * dye texture with a linear filter, so upscaling coarser grids costs one texture
 * fetch per pixel and removes the blockiness that a grid-sized canvas would show
 * when Scenery scales it up to the field's on-screen size.
 */
export const DISPLAY_CANVAS_WIDTH = 2048;
export const DISPLAY_CANVAS_HEIGHT = 1024;

/**
 * Compute shader workgroup edge, in invocations. 8 × 8 = 64 invocations keeps
 * occupancy high on every tier of GPU without approaching the 256-invocation
 * per-workgroup limit that the WebGPU baseline guarantees.
 */
export const WORKGROUP_SIZE = 8;

/**
 * Red-black SOR sweeps for the pressure Poisson solve. Below ~20 the velocity
 * field retains visible divergence (dye compresses and thins); above ~40 the
 * cost is real and the improvement is not visible.
 */
export const PRESSURE_ITERATIONS_DEFAULT = 30;

/** Iterations with the "higher solver accuracy" preference enabled. */
export const PRESSURE_ITERATIONS_HIGH = 50;

export const PRESSURE_ITERATIONS_RANGE = new Range(1, 200);

/**
 * Ceiling on the red-black SOR iterations spent on the implicit viscous solve.
 * Each one is a red dispatch and a black dispatch.
 *
 * The count itself is derived per step from α = νΔt/h² (see
 * `common/gpu/solverSchedule.ts`); this only bounds the stiffest corner of the
 * parameter space — the finest grid at the top of the viscosity slider — where
 * the required count runs into the hundreds and the flow is creeping anyway.
 */
export const DIFFUSION_SWEEPS_MAX = 12;

/**
 * Error the viscous solve is iterated down to, as a fraction of the error its
 * initial guess starts with. 10⁻³ is far below the point where a difference is
 * visible in the dye, and it is what makes the *displayed* viscosity the one the
 * fluid actually feels.
 */
export const DIFFUSION_RESIDUAL_TOLERANCE = 1e-3;

/**
 * Below this diffusion coefficient α = νΔt/h², the implicit diffusion sweep is
 * indistinguishable from the identity (its update is O(α)) and the iteration
 * loop is skipped, keeping only the single seeding sweep.
 *
 * In practice the viscosity floor (3×10⁻⁴ m²/s) keeps α ≈ 0.08 at the standard
 * grid during normal play, so this guard almost never triggers while running.
 * It exists for the paused / near-zero-dt path, where α collapses to zero and
 * the iterations would otherwise do nothing at all.
 */
export const DIFFUSION_SKIP_ALPHA = 1e-3;

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
 * Time constant, in seconds, of the exponential ramp the inflow boundary
 * follows when the speed slider moves.
 *
 * The inflow is a Dirichlet condition, and an incompressible projection answers
 * a step change instantly and globally: the pressure solve tilts the whole
 * channel to reconcile the new inlet flux with the momentum the fluid already
 * has, and when that transient reaches the p = 0 outflow it reflects and drives
 * the flow there into reverse — the whole column sloshes backward at up to
 * several times the *old* speed. Real channel flow cannot change its momentum
 * in one frame either, so the boundary is given the same inertia: the solver
 * approaches the slider's value exponentially, reaching 95 % of any change in
 * ~1.8 s. Readouts (Reynolds number, regime) still track the slider directly.
 */
export const FLOW_SPEED_RESPONSE_TIME = 0.6;

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

/**
 * Obstacle diameter D, in metres — the length scale in Re = U·D/ν.
 *
 * The top of the range is sized for the airfoil, which needs the headroom
 * most: its chord equals D and its thickness is only 12 % of that, so at any
 * slider setting the wing is the visually smallest of the three bodies. At
 * D = 0.8 the chord spans 40 % of the 2 m channel, while the cylinder and
 * plate at the same setting span 80 % of its height, leaving Venturi gaps at
 * the walls.
 */
export const OBSTACLE_DIAMETER_RANGE = new Range(0.05, 0.8);
export const OBSTACLE_DIAMETER_DEFAULT = 0.15;

/**
 * Obstacle centre, in metres from the channel's lower-left corner. Placed a
 * quarter of the way downstream so there is inflow to develop upstream of it
 * and three quarters of the channel for the wake to form in.
 */
export const OBSTACLE_CENTER_DEFAULT = new Vector2(0.5, 0.5);

/**
 * Where the obstacle's centre may be when the body is small, in metres — the
 * loosest case; obstacleDragBounds() tightens this region as the body grows.
 *
 * Clear of the inflow strip on the left (a body overlapping it would fight the
 * boundary condition that forces the velocity there), clear of the outflow on
 * the right, and clear of both walls so there is always room for a wake.
 */
export const OBSTACLE_DRAG_BOUNDS_M = new Bounds2(0.25, 0.25, 1.2, 0.75);

/**
 * Closest the obstacle's edge may come to a wall, the inflow or the outflow,
 * in metres. Not arbitrary: the static drag bounds above were sized for bodies
 * up to 0.35 m, and 0.25 − 0.35/2 = 0.075 — so every size the original slider
 * allowed keeps exactly the region it always had, and only larger bodies feel
 * the tightening.
 */
export const OBSTACLE_CLEARANCE_M = 0.075;

/**
 * The region the obstacle's centre may occupy for a body of the given
 * diameter: the static bounds above, shrunk on each side by the body's radius
 * plus OBSTACLE_CLEARANCE_M, so the edge itself stays clear of the walls and
 * both flow boundaries.
 *
 * Non-empty for every diameter in OBSTACLE_DIAMETER_RANGE — the largest body
 * pins near mid-height with a gap at each wall. A unit test pins both that and
 * the sizes the original slider allowed seeing no change.
 */
export function obstacleDragBounds(diameter: number): Bounds2 {
  const edge = diameter / 2 + OBSTACLE_CLEARANCE_M;
  return new Bounds2(
    Math.max(OBSTACLE_DRAG_BOUNDS_M.minX, edge),
    Math.max(OBSTACLE_DRAG_BOUNDS_M.minY, edge),
    Math.min(OBSTACLE_DRAG_BOUNDS_M.maxX, CHANNEL_WIDTH_M - edge),
    Math.min(OBSTACLE_DRAG_BOUNDS_M.maxY, CHANNEL_HEIGHT_M - edge),
  );
}

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
 * The range runs the full span from "dye never fades" to "dye obviously fades",
 * because a control the learner cannot see working is not a control. Dye
 * crosses the channel in under a second at the fastest inflow speeds and more
 * than ten at the slowest, so a narrow range near 1 — the original 0.9 to 1 —
 * changed what reached the far wall by only a few percent, and even
 * pointer-painted dye advected away long before a 10 %-per-second fade could
 * act on it.
 *
 * The default stays at 0.99: the inflow bands are the main visualization, and
 * they should survive to the far wall unless the learner deliberately asks for
 * faster fading by moving the slider down.
 */
export const DYE_DISSIPATION_RANGE = new Range(0.1, 1);
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
  GRID_WIDTH_VERY_FINE,
  GRID_HEIGHT_VERY_FINE,
  GRID_WIDTH_ULTRA_FINE,
  GRID_HEIGHT_ULTRA_FINE,
  DISPLAY_CANVAS_WIDTH,
  DISPLAY_CANVAS_HEIGHT,
  WORKGROUP_SIZE,
  PRESSURE_ITERATIONS_DEFAULT,
  PRESSURE_ITERATIONS_HIGH,
  PRESSURE_ITERATIONS_RANGE,
  DIFFUSION_SWEEPS_MAX,
  DIFFUSION_RESIDUAL_TOLERANCE,
  DIFFUSION_SKIP_ALPHA,
  MAX_PHYSICS_DT,
  MAX_SUBSTEPS_PER_FRAME,
  FLOW_SPEED_RANGE,
  FLOW_SPEED_DEFAULT,
  FLOW_SPEED_RESPONSE_TIME,
  VISCOSITY_RANGE,
  VISCOSITY_DEFAULT,
  OBSTACLE_DIAMETER_RANGE,
  OBSTACLE_DIAMETER_DEFAULT,
  OBSTACLE_CENTER_DEFAULT,
  OBSTACLE_DRAG_BOUNDS_M,
  OBSTACLE_CLEARANCE_M,
  obstacleDragBounds,
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
