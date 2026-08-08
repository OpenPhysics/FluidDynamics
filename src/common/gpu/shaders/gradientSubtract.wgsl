// gradientSubtract.wgsl — u ← u − ∇p.
//
// Step 3 of the projection, and the step that makes the fluid incompressible.
// By the Helmholtz–Hodge decomposition any vector field splits into a
// divergence-free part and the gradient of a scalar; the pressure solve found
// that scalar, and subtracting its gradient leaves only the divergence-free
// part.
//
// The same boundary conditions as the pressure solve have to be applied here,
// or the two disagree at the obstacle surface and fluid leaks into the body.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var velocityTex : texture_2d<f32>;
@group(0) @binding(2) var pressureTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var obstacleTex : texture_2d<f32>;

fn pressureAt(neighbour: vec2<i32>, centre: f32) -> f32 {
  if (neighbour.x >= i32(u.gridSize.x)) {
    return 0.0;
  }
  if (isSolidAt(obstacleTex, neighbour, u)) {
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

  if (isSolidAt(obstacleTex, c, u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let centre = textureLoad(pressureTex, c, 0).x;
  let h = cellSize(u);

  let gradient = vec2<f32>(
    pressureAt(c + vec2<i32>(1, 0), centre) - pressureAt(c - vec2<i32>(1, 0), centre),
    pressureAt(c + vec2<i32>(0, 1), centre) - pressureAt(c - vec2<i32>(0, 1), centre),
  ) / (2.0 * h);

  let velocity = textureLoad(velocityTex, c, 0).xy;
  textureStore(outTex, cell, vec4<f32>(velocity - gradient, 0.0, 1.0));
}
