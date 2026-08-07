// divergence.wgsl — ∇·u, in 1/s.
//
// Step 1 of the projection. After advection, forcing and diffusion the velocity
// field no longer conserves mass: it has cells where fluid is being created or
// destroyed. This measures how much, and the pressure solve then finds the
// scalar field whose gradient removes it.
//
// Visually, divergence is what makes dye clump into thin filaments or fade out
// in patches. Watching it disappear is the clearest confirmation the projection
// is working.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var velocityTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<r32float, write>;

fn velocityAt(cell: vec2<i32>) -> vec2<f32> {
  if (isSolidCell(cell, u)) {
    return vec2<f32>(0.0, 0.0);
  }
  return textureLoad(velocityTex, clampCell(cell, u), 0).xy;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let c = vec2<i32>(cell);
  let h = cellSize(u);

  let left = velocityAt(c - vec2<i32>(1, 0)).x;
  let right = velocityAt(c + vec2<i32>(1, 0)).x;
  let down = velocityAt(c - vec2<i32>(0, 1)).y;
  let up = velocityAt(c + vec2<i32>(0, 1)).y;

  let divergence = (right - left + up - down) / (2.0 * h);
  textureStore(outTex, cell, vec4<f32>(divergence, 0.0, 0.0, 1.0));
}
