// dye.wgsl — dye injection.
//
// Dye is a passive tracer: it is carried by the flow but does not affect it. It
// exists purely so the flow is visible, exactly as in a laboratory dye-injection
// experiment.
//
// It is injected at the inflow in alternating horizontal bands of two colours.
// A single colour would fill the channel uniformly and show almost nothing; the
// interfaces between bands are what actually reveal the flow, because they get
// stretched and folded by the shear layer coming off the obstacle and roll up
// into the individual vortices of the Kármán street.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var dyeTex : texture_2d<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba16float, write>;

// Width of the injection strip at the inflow, in cells.
const INJECTION_CELLS: i32 = 2;

// Number of colour bands across the channel height. Enough that several pass on
// either side of the obstacle, few enough that each stays distinguishable.
const BANDS: f32 = 12.0;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let c = vec2<i32>(cell);
  var dye = textureLoad(dyeTex, c, 0);
  let uv = cellToUV(cell, u);

  if (c.x < INJECTION_CELLS) {
    // smoothstep across each band edge rather than a hard step: a one-texel
    // colour discontinuity would alias badly once advection stretches it.
    let band = fract(uv.y * BANDS);
    let blend = smoothstep(0.45, 0.55, band) - smoothstep(0.95, 1.0, band);
    dye = mix(u.dyeColorA, u.dyeColorB, blend);
  }

  if (u.pointerActive > 0.5) {
    let d = uvToMetres(uv, u) - u.pointerPos;
    let falloff = exp(-dot(d, d) / (u.pointerRadius * u.pointerRadius));
    dye = mix(dye, u.dyeColorA, clamp(falloff, 0.0, 1.0));
  }

  textureStore(outTex, cell, dye);
}
