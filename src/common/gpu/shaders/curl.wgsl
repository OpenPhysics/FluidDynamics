// curl.wgsl — vorticity ω = ∂v/∂x − ∂u/∂y, in 1/s.
//
// In two dimensions vorticity is a scalar: the local rate of rotation. It is
// computed for two reasons — the vorticity-confinement pass needs its gradient,
// and it is the clearest of the four visualizations, because a Kármán street is
// literally a row of alternating-sign vorticity blobs.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var velocityTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<r32float, write>;
@group(0) @binding(6) var obstacleTex : texture_2d<f32>;

fn velocityAt(cell: vec2<i32>) -> vec2<f32> {
  // Solid cells read as stationary, so the shear layer forms at the body's
  // surface rather than at the first fluid cell outside it.
  if (isSolidAt(obstacleTex, cell, u)) {
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

  let left = velocityAt(c - vec2<i32>(1, 0));
  let right = velocityAt(c + vec2<i32>(1, 0));
  let down = velocityAt(c - vec2<i32>(0, 1));
  let up = velocityAt(c + vec2<i32>(0, 1));

  let curl = (right.y - left.y - up.x + down.x) / (2.0 * h);
  textureStore(outTex, cell, vec4<f32>(curl, 0.0, 0.0, 1.0));
}
