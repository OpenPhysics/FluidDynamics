// forces.wgsl — external forcing and velocity boundary conditions.
//
// Everything that drives the flow rather than evolving it: the inflow at the
// left edge, the free-slip channel walls, the outflow at the right edge, and the
// impulse the learner adds by dragging in the field.
//
// ── Why the inflow is perturbed ───────────────────────────────────────────────
// Flow past a cylinder is symmetric about the centreline, and so is this grid.
// A perfectly symmetric initial condition stays symmetric forever: the wake
// grows two mirror-image recirculation bubbles and never sheds, no matter how
// high the Reynolds number. Real flow escapes this because no laboratory inflow
// is perfectly uniform. The same thing is done here, with a very small
// time-varying perturbation on the inflow's transverse component — enough to
// seed the instability, far too small to be visible in the flow it produces.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var velocityTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var obstacleTex : texture_2d<f32>;

// Width of the inflow and outflow boundary strips, in cells.
const BOUNDARY_CELLS: i32 = 2;

// Transverse inflow perturbation, as a fraction of the inflow speed.
const INFLOW_NOISE: f32 = 0.004;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let c = vec2<i32>(cell);
  let width = i32(u.gridSize.x);
  let height = i32(u.gridSize.y);

  if (isSolidAt(obstacleTex, c, u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  var velocity = textureLoad(velocityTex, c, 0).xy;
  let uv = cellToUV(cell, u);
  let p = uvToMetres(uv, u);

  // ── Inflow ──────────────────────────────────────────────────────────────────
  if (c.x < BOUNDARY_CELLS) {
    // Two incommensurate frequencies so the perturbation never repeats exactly
    // and cannot lock the shedding to its own period.
    let noise = sin(u.time * 3.7 + uv.y * 17.0) * sin(u.time * 1.3 + uv.y * 5.0);
    velocity = vec2<f32>(u.inflowSpeed, u.inflowSpeed * INFLOW_NOISE * noise);
  }

  // ── Outflow: zero gradient, so vortices convect out instead of reflecting ───
  if (c.x >= width - BOUNDARY_CELLS) {
    let interior = textureLoad(velocityTex, vec2<i32>(width - BOUNDARY_CELLS - 1, c.y), 0).xy;
    // The channel empties into a reservoir at reference pressure — the pressure
    // solve pins p = 0 past this edge — and a reservoir does not push back. A
    // plain zero-gradient copy would re-import any transient reversal at the
    // outlet and feed it back into the channel, so the copied axial velocity is
    // clamped to point downstream.
    velocity = vec2<f32>(max(interior.x, 0.0), interior.y);
  }

  // ── Free-slip walls: no flow through, but no drag along ─────────────────────
  if (c.y == 0 || c.y == height - 1) {
    velocity.y = 0.0;
  }

  // ── Pointer impulse ─────────────────────────────────────────────────────────
  if (u.pointerActive > 0.5) {
    let d = p - u.pointerPos;
    // Gaussian falloff, so the impulse has no hard edge to shed spurious vorticity from.
    let falloff = exp(-dot(d, d) / (u.pointerRadius * u.pointerRadius));
    // pointerDelta is the pointer's motion in metres this frame; dividing by dt
    // turns it into the velocity the learner is "pushing" the fluid at.
    velocity += (u.pointerDelta / max(u.dt, 1.0e-6)) * falloff;
  }

  textureStore(outTex, cell, vec4<f32>(velocity, 0.0, 1.0));
}
