// advect.wgsl — semi-Lagrangian transport with a MacCormack corrector.
//
// Step 1 of Stam's Stable Fluids: instead of pushing quantities forward (which
// goes unstable above a CFL of 1), trace each cell's position *backwards* along
// the velocity field and take whatever was there. Unconditionally stable at any
// timestep, at the cost of being diffusive.
//
// The backward trace alone (the predictor, advectVelocity) behaves like an extra
// viscosity of order h·|u|/2 — enough to smear the shear layer off the obstacle
// and weaken the Kármán street. So the velocity field is advected with a
// MacCormack predictor–corrector (Selle, Fedkiw, Lanson, Molemaker & Bridson,
// 2008): the predictor's backward step is corrected by an anti-diffusive term
// built from a forward step, cancelling most of the numerical diffusion. A
// bound-preserving limiter clamps the result to the predictor's local range so
// the correction cannot create new extrema and destabilise the flow.
//
// The dye is a passive tracer and stays on the plain backward trace: it is
// carried by the (now sharper) velocity field, so it sharpens for free, and the
// dye texture needs no extra storage.
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

// ── MacCormack corrector for the velocity field ───────────────────────────────
//
// Bindings: velocityTex holds the pre-advection field φ^n (and is sampled for the
// trace velocity); sourceTex holds the predictor result φ_A (advectTemp);
// outTex receives the corrected, limited velocity (velocitySource).
//
//   φ_A   = backward advect of φ^n                      (the predictor, above)
//   φ_D   = forward sample of φ_A at x + u·dt            (the reverse trace)
//   φ_raw = φ_A + ½(φ^n(x) − φ_D)                        (anti-diffusive blend)
//   φ     = clamp φ_raw to [min, max] of φ_A around the departure point
//
// The clamp is what makes the scheme unconditionally stable: without it the
// anti-diffusive term can overshoot and, over many steps, blow up. With it the
// corrected value never leaves the range the predictor already produced, so the
// whole step is no less stable than plain semi-Lagrangian.

fn forwardTrace(uv: vec2<f32>) -> vec2<f32> {
  let velocity = textureSampleLevel(velocityTex, linearSampler, uv, 0.0).xy;
  return uv + velocity * u.dt / u.domainSize;
}

@compute @workgroup_size(8, 8)
fn advectVelocityCorrect(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (cell.x >= u32(u.gridSize.x) || cell.y >= u32(u.gridSize.y)) {
    return;
  }

  // No-slip is enforced by the predictor too; repeated here so a correction can
  // never put velocity back inside the body.
  if (isSolid(uvToMetres(cellToUV(cell, u), u), u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let c = vec2<i32>(cell);
  let uv = cellToUV(cell, u);

  let phiN = textureLoad(velocityTex, c, 0).xy;
  let phiA = textureSampleLevel(sourceTex, linearSampler, uv, 0.0).xy;
  let phiD = textureSampleLevel(sourceTex, linearSampler, forwardTrace(uv), 0.0).xy;

  let raw = phiA + 0.5 * (phiN - phiD);

  // Bound the corrected value to the range of φ_A over the four texels whose
  // bilinear interpolation produced the predictor's value at the departure
  // point. A value outside this range is an overshoot the limiter removes.
  let backUV = backtrace(uv);
  let base = clampCell(vec2<i32>(floor(backUV * u.gridSize)), u);
  let p00 = textureLoad(sourceTex, clampCell(base + vec2<i32>(0, 0), u), 0).xy;
  let p10 = textureLoad(sourceTex, clampCell(base + vec2<i32>(1, 0), u), 0).xy;
  let p01 = textureLoad(sourceTex, clampCell(base + vec2<i32>(0, 1), u), 0).xy;
  let p11 = textureLoad(sourceTex, clampCell(base + vec2<i32>(1, 1), u), 0).xy;
  let lo = min(min(p00, p10), min(p01, p11));
  let hi = max(max(p00, p10), max(p01, p11));

  let corrected = clamp(raw, lo, hi);
  textureStore(outTex, cell, vec4<f32>(corrected, 0.0, 1.0));
}
