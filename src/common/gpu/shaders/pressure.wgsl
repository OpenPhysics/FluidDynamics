// pressure.wgsl — red-black successive over-relaxation (SOR) of the pressure
// Poisson equation ∇²p = ∇·u.
//
// Step 2 of the projection. Red-black ordering splits the grid like a
// checkerboard: the red sweep updates red cells using their black neighbours,
// the black sweep updates black cells using the freshly updated red ones. That
// is Gauss–Seidel in parallel form, and it propagates information across the
// grid roughly twice as far per sweep as Jacobi. Successive over-relaxation
// then extrapolates each update past the Gauss–Seidel value, which squares the
// error reduction again — the reason SOR converges in a small fraction of the
// sweeps Jacobi needs for the same residual.
//
// Each sweep reads one pressure texture and writes the other. The cells of the
// opposite colour are copied through unchanged, so a red sweep followed by a
// black sweep leaves the full grid updated and ping-ponged back to the original
// texture. The host (WebGPUFluidEngine) alternates red and black, one dispatch
// each, so the per-frame dispatch count is unchanged from the old Jacobi loop
// while the residual divergence it leaves behind is far smaller.
//
// Convergence no longer needs ~30 sweeps to be useful; the warm start from the
// previous frame's pressure compounds the speed-up. The same caveats as Jacobi
// apply: this is still a stationary iterative method, and a true multigrid
// solve would be faster still on the coarser modes.
//
// ── Boundary conditions ───────────────────────────────────────────────────────
// Solid walls and the obstacle get Neumann (∂p/∂n = 0), implemented by
// substituting the centre cell's pressure for a solid neighbour's — the standard
// way to say "no flow through this face". Without it on the obstacle, the
// projection would push fluid straight through the body and no wake would form.
//
// The outflow edge gets Dirichlet (p = 0) so the flow can leave the channel
// instead of piling up against a closed boundary.

// Over-relaxation factor ω ∈ (1, 2). Above the Gauss–Seidel value of 1, larger
// ω converges faster but approaches the unstable edge at 2. 1.7 is conservative
// across every grid resolution the Lab screen offers and stays well clear of the
// instability that the collocated-grid checkerboard mode could otherwise amplify.
const PRESSURE_SOR_OMEGA: f32 = 1.7;

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

// One sweep of red-black SOR. `redPass` selects which colour is updated this
// dispatch; the other colour is copied through verbatim.
fn solveColour(id: vec3<u32>, redPass: bool) {
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

  let isRed = ((c.x + c.y) & 1) == 0;
  if (isRed != redPass) {
    // Not this sweep's colour: carry the previous value through unchanged.
    textureStore(outTex, cell, vec4<f32>(centre, 0.0, 0.0, 1.0));
    return;
  }

  let h = cellSize(u);
  let divergence = textureLoad(divergenceTex, c, 0).x;

  let sum =
    pressureAt(c - vec2<i32>(1, 0), centre) +
    pressureAt(c + vec2<i32>(1, 0), centre) +
    pressureAt(c - vec2<i32>(0, 1), centre) +
    pressureAt(c + vec2<i32>(0, 1), centre);

  // Gauss–Seidel value, then over-relaxation toward it.
  let gs = (sum - divergence * h * h) * 0.25;
  let relaxed = centre + PRESSURE_SOR_OMEGA * (gs - centre);
  textureStore(outTex, cell, vec4<f32>(relaxed, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn solveRed(@builtin(global_invocation_id) id: vec3<u32>) {
  solveColour(id, true);
}

@compute @workgroup_size(8, 8)
fn solveBlack(@builtin(global_invocation_id) id: vec3<u32>) {
  solveColour(id, false);
}
