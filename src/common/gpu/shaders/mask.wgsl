// mask.wgsl — bakes the obstacle's signed distance into a grid-sized texture.
//
// Everything downstream needs to know which cells are solid, and several of the
// stencils need it for four neighbours as well as the centre. Evaluating the
// analytic SDF each time costs transcendentals — for the airfoil, several — and
// it is the same answer every time until the learner moves or resizes the body.
//
// So this kernel runs once whenever the obstacle (or the grid) changes, and the
// rest of the solver reads the result with a single texture fetch. See the
// helpers at the bottom of common.wgsl, and the dirty-tracking in
// WebGPUFluidEngine.recordCompute.
//
// The stored value is the distance in metres, positive outside the body, not a
// 0/1 flag: it is no more expensive to keep, and it leaves the door open to
// weighting the boundary by how much of a cell the body actually covers.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var outTex : texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let distance = obstacleSDF(uvToMetres(cellToUV(cell, u), u), u);
  textureStore(outTex, cell, vec4<f32>(distance, 0.0, 0.0, 1.0));
}
