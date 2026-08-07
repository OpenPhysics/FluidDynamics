// display.wgsl — the only render pass. Turns one of the four fields into pixels.
//
// Drawn with a single oversized triangle rather than a quad: two triangles meet
// along a diagonal seam where the GPU rasterizes the shared edge twice, and one
// triangle has no seam and no index buffer.
//
// Output goes to a detached canvas configured with a "webgpu" context, which
// FluidFieldNode then blits into Scenery's 2D canvas.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var linearSampler : sampler;
@group(0) @binding(2) var dyeTex : texture_2d<f32>;
@group(0) @binding(3) var velocityTex : texture_2d<f32>;
@group(0) @binding(4) var curlTex : texture_2d<f32>;
@group(0) @binding(5) var pressureTex : texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  // Covers the viewport with one triangle; the two thirds outside are clipped.
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let corner = corners[index];

  var out: VertexOutput;
  out.position = vec4<f32>(corner, 0.0, 1.0);
  // WebGPU clip space has +y up, and so does the grid's v axis, so no flip is
  // needed here. The flip to the canvas' top-down axis happens in rasterization.
  out.uv = corner * 0.5 + 0.5;
  return out;
}

// ── Colour maps ───────────────────────────────────────────────────────────────

// Sequential ramp for magnitudes: dark at zero, bright and warm at the top.
// A polynomial fit rather than a lookup texture — one less resource to bind, and
// smooth by construction.
fn sequentialRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  return clamp(
    vec3<f32>(
      0.03 + x * (2.4 + x * (-2.0 + x * 0.65)),
      0.05 + x * (0.35 + x * (1.6 + x * -1.05)),
      0.18 + x * (1.4 + x * (-3.4 + x * 2.1)),
    ),
    vec3<f32>(0.0),
    vec3<f32>(1.0),
  );
}

// Diverging ramp for signed quantities (vorticity, pressure): the sign is the
// information, so zero must be visually neutral and the two directions must be
// distinguishable without relying on hue alone.
fn divergingRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, -1.0, 1.0);
  let cool = vec3<f32>(0.16, 0.44, 0.90);
  let warm = vec3<f32>(0.95, 0.42, 0.18);
  let neutral = vec3<f32>(0.06, 0.07, 0.12);
  let magnitude = abs(x);
  let hue = select(cool, warm, x > 0.0);
  return mix(neutral, hue, sqrt(magnitude));
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let p = uvToMetres(uv, u);
  let mode = i32(u.visualization + 0.5);

  var colour: vec3<f32>;

  if (mode == 0) {
    colour = textureSampleLevel(dyeTex, linearSampler, uv, 0.0).rgb;
  } else if (mode == 1) {
    let speed = length(textureSampleLevel(velocityTex, linearSampler, uv, 0.0).xy);
    colour = sequentialRamp(speed / max(u.velocityScale, 1.0e-6));
  } else if (mode == 2) {
    // Vorticity is scaled by the time it takes fluid to cross one cell, which
    // makes the display independent of both grid resolution and flow speed.
    //
    // textureLoad rather than textureSampleLevel: curl and pressure are r32float,
    // which WebGPU does not guarantee is filterable, so they are bound as
    // 'unfilterable-float' and cannot be used with a filtering sampler.
    let curl = textureLoad(curlTex, uvToCell(uv, u), 0).x;
    let scale = max(u.velocityScale, 1.0e-6) / cellSize(u);
    colour = divergingRamp(curl / scale);
  } else {
    let pressure = textureLoad(pressureTex, uvToCell(uv, u), 0).x;
    let scale = max(u.velocityScale, 1.0e-6) * cellSize(u);
    colour = divergingRamp(pressure / scale);
  }

  // ── Obstacle ────────────────────────────────────────────────────────────────
  let distance = obstacleSDF(p, u);
  let edge = cellSize(u) * 1.5;
  if (distance <= 0.0) {
    // Solid body: a flat fill, with a lighter rim so its outline stays readable
    // against both the dark dye view and the bright end of the ramps.
    let rim = smoothstep(-edge, 0.0, distance);
    colour = mix(vec3<f32>(0.10, 0.11, 0.16), vec3<f32>(0.62, 0.66, 0.74), rim);
  }

  return vec4<f32>(colour, 1.0);
}
