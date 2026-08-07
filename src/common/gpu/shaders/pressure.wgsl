// pressure.wgsl — one Jacobi sweep of the pressure Poisson equation ∇²p = ∇·u.
//
// Step 2 of the projection. Jacobi rather than a multigrid or conjugate-gradient
// solver because every cell updates from the previous iterate only — perfectly
// parallel, one dispatch per sweep, no synchronisation inside the grid.
//
// Convergence is slow (error decays roughly as the number of sweeps divided by
// the grid size), so ~30 sweeps do not fully converge. They do not need to: the
// residual divergence left behind is far below what is visible in the dye.
//
// ── Boundary conditions ───────────────────────────────────────────────────────
// Solid walls and the obstacle get Neumann (∂p/∂n = 0), implemented by
// substituting the centre cell's pressure for a solid neighbour's — the standard
// way to say "no flow through this face". Without it on the obstacle, the
// projection would push fluid straight through the body and no wake would form.
//
// The outflow edge gets Dirichlet (p = 0) so the flow can leave the channel
// instead of piling up against a closed boundary.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var pressureTex : texture_2d<f32>;
@group(0) @binding(2) var divergenceTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<r32float, write>;

// Pressure at a neighbour, applying the boundary conditions.
fn pressureAt(neighbour: vec2<i32>, centre: f32) -> f32 {
  // Outflow: fixed reference pressure, so fluid can leave freely.
  if (neighbour.x >= i32(u.gridSize.x)) {
    return 0.0;
  }
  // Solid neighbour (obstacle, or a cell past the wall after clamping):
  // reflect the centre value, giving zero normal gradient.
  if (isSolidCell(neighbour, u)) {
    return centre;
  }
  let clamped = clampCell(neighbour, u);
  if (clamped.x != neighbour.x || clamped.y != neighbour.y) {
    return centre;
  }
  return textureLoad(pressureTex, clamped, 0).x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let c = vec2<i32>(cell);

  // Pressure is undefined inside a solid; hold it at zero so the reflected
  // boundary values above stay well behaved.
  if (isSolidCell(c, u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let centre = textureLoad(pressureTex, c, 0).x;
  let h = cellSize(u);
  let divergence = textureLoad(divergenceTex, c, 0).x;

  let sum =
    pressureAt(c - vec2<i32>(1, 0), centre) +
    pressureAt(c + vec2<i32>(1, 0), centre) +
    pressureAt(c - vec2<i32>(0, 1), centre) +
    pressureAt(c + vec2<i32>(0, 1), centre);

  let pressure = (sum - divergence * h * h) * 0.25;
  textureStore(outTex, cell, vec4<f32>(pressure, 0.0, 0.0, 1.0));
}
