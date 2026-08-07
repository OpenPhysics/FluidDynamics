// advect.wgsl — semi-Lagrangian transport.
//
// Step 1 of Stam's Stable Fluids: instead of pushing quantities forward (which
// goes unstable above a CFL of 1), trace each cell's position *backwards* along
// the velocity field and take whatever was there. Unconditionally stable at any
// timestep, at the cost of being diffusive — which is why the solver also runs
// vorticity confinement.
//
// The bilinear filtering in textureSampleLevel is what makes the backtrace
// second-order in space; it is also why the velocity and dye textures are
// rgba16float (filterable) rather than rg32float (not, without an optional
// feature).

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var linearSampler : sampler;
@group(0) @binding(2) var velocityTex : texture_2d<f32>;
@group(0) @binding(3) var sourceTex : texture_2d<f32>;
@group(0) @binding(4) var outTex : texture_storage_2d<rgba16float, write>;

// Where the fluid now at `uv` came from one timestep ago.
// Velocity is in m/s and uv is dimensionless, so the displacement is divided by
// the domain size to convert metres to uv.
fn backtrace(uv: vec2<f32>) -> vec2<f32> {
  let velocity = textureSampleLevel(velocityTex, linearSampler, uv, 0.0).xy;
  return uv - velocity * u.dt / u.domainSize;
}

@compute @workgroup_size(8, 8)
fn advectVelocity(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (cell.x >= u32(u.gridSize.x) || cell.y >= u32(u.gridSize.y)) {
    return;
  }

  let uv = cellToUV(cell, u);

  // No-slip: the body does not move, so neither does the fluid inside it.
  // Enforced here as well as in the dedicated pass, so the backtrace never
  // picks up a stale velocity from inside the obstacle.
  if (isSolid(uvToMetres(uv, u), u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let source = textureSampleLevel(sourceTex, linearSampler, backtrace(uv), 0.0);
  textureStore(outTex, cell, vec4<f32>(source.xy, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn advectDye(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (cell.x >= u32(u.gridSize.x) || cell.y >= u32(u.gridSize.y)) {
    return;
  }

  let uv = cellToUV(cell, u);

  // Dye inside the body would be visible through the obstacle overlay's edges.
  if (isSolid(uvToMetres(uv, u), u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 0.0));
    return;
  }

  // dyeDissipation is the fraction remaining after one second, so the per-step
  // factor is that raised to dt — framerate-independent fading.
  let decay = pow(u.dyeDissipation, u.dt);
  let source = textureSampleLevel(sourceTex, linearSampler, backtrace(uv), 0.0);
  textureStore(outTex, cell, source * decay);
}
