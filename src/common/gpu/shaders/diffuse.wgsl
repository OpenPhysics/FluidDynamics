// diffuse.wgsl — implicit viscous diffusion, one Jacobi sweep.
//
// The viscous term ν∇²u is solved implicitly: (I − νΔt∇²)u_new = u_old. Solving
// it explicitly would need Δt < h²/(4ν), which at high viscosity is far smaller
// than a frame. The implicit form is unconditionally stable and reduces to the
// same Jacobi iteration used for pressure:
//
//   u_new = (u_old + α·Σ neighbours) / (1 + 4α),   α = νΔt/h²
//
// This is the term the Reynolds-number slider actually moves. At low viscosity α
// is tiny and the sweep is nearly the identity, which is correct — there the
// numerical diffusion of the advection step dominates, and that ceiling on the
// achievable Reynolds number is documented in doc/model.md.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var sourceTex : texture_2d<f32>;
@group(0) @binding(2) var previousTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  if (isSolidCell(vec2<i32>(cell), u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let c = vec2<i32>(cell);
  let h = cellSize(u);
  let alpha = u.viscosity * u.dt / (h * h);

  // `previousTex` is the last Jacobi iterate; `sourceTex` is the pre-diffusion
  // field, which stays fixed across the whole solve.
  let neighbours =
    textureLoad(previousTex, clampCell(c - vec2<i32>(1, 0), u), 0).xy +
    textureLoad(previousTex, clampCell(c + vec2<i32>(1, 0), u), 0).xy +
    textureLoad(previousTex, clampCell(c - vec2<i32>(0, 1), u), 0).xy +
    textureLoad(previousTex, clampCell(c + vec2<i32>(0, 1), u), 0).xy;

  let original = textureLoad(sourceTex, c, 0).xy;
  let result = (original + alpha * neighbours) / (1.0 + 4.0 * alpha);

  textureStore(outTex, cell, vec4<f32>(result, 0.0, 1.0));
}
