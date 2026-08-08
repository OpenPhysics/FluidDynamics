// diffuse.wgsl — implicit viscous diffusion, one red-black SOR sweep.
//
// The viscous term ν∇²u is solved implicitly: (I − νΔt∇²)u_new = u_old. Solving
// it explicitly would need Δt < h²/(4ν), which at high viscosity is far smaller
// than a frame. The implicit form is unconditionally stable and reduces to a
// linear system with one number in it:
//
//   (1 + 4α)·u_c − α·Σ u_n = u_source,   α = νΔt/h²
//
// This is the term the Reynolds-number slider actually moves, so how well it is
// solved decides whether the fluid is as viscous as the readout claims.
//
// ── Why not Jacobi ────────────────────────────────────────────────────────────
// α grows with the square of the resolution: at ν = 10⁻³ m²/s and Δt = 1/60 s it
// is 0.27 on the 256 × 128 grid and 17 on the 2048 × 1024 one. Jacobi's error
// reduction is 4α/(1 + 4α) per sweep — 0.52 at the first and 0.986 at the second
// — so a fixed twelve sweeps solved the coarse grid comfortably and barely
// touched the fine one. The fine grids were quietly *less* viscous than asked,
// in the direction that inflates the effective Reynolds number.
//
// Red-black SOR fixes both ends at once. Ordering the grid like a checkerboard
// makes Gauss–Seidel run in parallel — the red sweep updates red cells from
// their black neighbours, the black sweep updates black cells from the red ones
// just written — and over-relaxing past the Gauss–Seidel value squares the error
// reduction again. At the optimal factor the rate becomes ω − 1: 0.08 and 0.71
// for the same two cases. The host then picks the sweep count from α, so the
// easy end of the range costs less than it used to and the stiff end is right.
//
// ── Boundaries ────────────────────────────────────────────────────────────────
// Solid cells are held at zero every sweep, so a neighbour inside the body reads
// as stationary fluid: no-slip on the obstacle. clampCell gives the channel
// walls a zero-gradient (free-slip) condition for free.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var sourceTex : texture_2d<f32>;
@group(0) @binding(2) var previousTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var obstacleTex : texture_2d<f32>;

/**
 * Optimal over-relaxation factor for this α.
 *
 * The Jacobi spectral radius of the system above is ρ = 4α/(1 + 4α), and
 * Young's formula ω = 2/(1 + √(1 − ρ²)) simplifies — since 1 − ρ² is exactly
 * (1 + 8α)/(1 + 4α)² — to the closed form below: one square root, no
 * trigonometry, and ω stays inside (1, 2) for every α.
 *
 * Mirrored by `diffusionOmega` in common/gpu/solverSchedule.ts, which the host
 * uses to choose how many sweeps this rate needs. The two must agree.
 */
fn sorOmega(alpha: f32) -> f32 {
  let diagonal = 1.0 + 4.0 * alpha;
  return 2.0 * diagonal / (diagonal + sqrt(1.0 + 8.0 * alpha));
}

/** α = νΔt/h², the stiffness of the system being solved. */
fn stiffness() -> f32 {
  let h = cellSize(u);
  return u.viscosity * u.dt / (h * h);
}

/** The four-neighbour sum of the current iterate, with clamped (Neumann) edges. */
fn neighbourSum(c: vec2<i32>) -> vec2<f32> {
  return
    textureLoad(previousTex, clampCell(c - vec2<i32>(1, 0), u), 0).xy +
    textureLoad(previousTex, clampCell(c + vec2<i32>(1, 0), u), 0).xy +
    textureLoad(previousTex, clampCell(c - vec2<i32>(0, 1), u), 0).xy +
    textureLoad(previousTex, clampCell(c + vec2<i32>(0, 1), u), 0).xy;
}

/**
 * One sweep. `redPass` selects which colour is updated; cells of the other
 * colour are copied through verbatim, so a red sweep followed by a black one
 * ping-pongs back to the original texture with the whole grid updated.
 */
fn sweep(id: vec3<u32>, redPass: bool) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let c = vec2<i32>(cell);

  if (isSolidAt(obstacleTex, c, u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let centre = textureLoad(previousTex, c, 0).xy;

  let isRed = ((c.x + c.y) & 1) == 0;
  if (isRed != redPass) {
    // Not this sweep's colour: carry the previous value through unchanged.
    textureStore(outTex, cell, vec4<f32>(centre, 0.0, 1.0));
    return;
  }

  // `previousTex` is the last iterate; `sourceTex` is the pre-diffusion field,
  // which stays fixed across the whole solve.
  let alpha = stiffness();
  let original = textureLoad(sourceTex, c, 0).xy;

  // Gauss–Seidel value, then over-relaxation past it.
  let gs = (original + alpha * neighbourSum(c)) / (1.0 + 4.0 * alpha);
  let relaxed = centre + sorOmega(alpha) * (gs - centre);

  textureStore(outTex, cell, vec4<f32>(relaxed, 0.0, 1.0));
}

/**
 * The seeding dispatch: a plain Jacobi sweep from the advected field, which both
 * writes every cell — giving the sweeps above a complete iterate to start from —
 * and is already a better initial guess than the source alone.
 */
@compute @workgroup_size(8, 8)
fn seed(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let c = vec2<i32>(cell);

  if (isSolidAt(obstacleTex, c, u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let alpha = stiffness();
  let original = textureLoad(sourceTex, c, 0).xy;
  let result = (original + alpha * neighbourSum(c)) / (1.0 + 4.0 * alpha);

  textureStore(outTex, cell, vec4<f32>(result, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn solveRed(@builtin(global_invocation_id) id: vec3<u32>) {
  sweep(id, true);
}

@compute @workgroup_size(8, 8)
fn solveBlack(@builtin(global_invocation_id) id: vec3<u32>) {
  sweep(id, false);
}
