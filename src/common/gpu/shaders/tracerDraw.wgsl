// tracerDraw.wgsl — the tracer dots, drawn over the finished field.
//
// One instanced quad per particle, six vertices each, positioned straight from
// the storage buffer that tracerStep.wgsl advects. The buffer is read here as
// read-only storage in the *vertex* stage rather than bound as a vertex buffer:
// it keeps the particle record in one place with one meaning, and there is no
// vertex layout to keep in step with the struct.
//
// Drawn into the same render pass as display.wgsl, immediately after it, so the
// dots composite over whichever field the learner is looking at. That is also
// why the dot is drawn as a light core inside a dark ring: it has to stay
// legible over the near-black of the dye view, the bright top of the sequential
// ramp, and both ends of the diverging one.
//
// Parked particles (alive = 0) are not skipped by the draw call — nothing on the
// CPU knows which those are — so their quad is collapsed onto a single point
// outside the clip volume, where the clipper discards it before rasterization.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var<storage, read> tracers : array<vec4<f32>>;

// Supplied at pipeline creation from FluidDynamicsConstants; the defaults are
// only a fallback for a pipeline built without constants.
override dotRadius : f32 = 0.008;
override fadeInSeconds : f32 = 0.15;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  // Position within the quad, -1..1 on each axis: the disc is cut out of it in
  // the fragment stage rather than tessellated.
  @location(0) offset : vec2<f32>,
  @location(1) alpha : f32,
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let tracer = tracers[instance];

  var out: VertexOutput;
  out.offset = corner;
  out.alpha = clamp(tracer.z / max(fadeInSeconds, 1.0e-6), 0.0, 1.0);

  if (tracer.w < 0.5) {
    // Parked: every vertex of the quad lands on the same point outside clip
    // space, so the triangles have no area inside it and nothing is rasterized.
    out.position = vec4<f32>(-2.0, -2.0, 0.0, 1.0);
    return out;
  }

  // Metres to clip space. The channel spans the whole viewport with +y up, the
  // same convention display.wgsl's full-screen triangle uses.
  let centre = tracer.xy / u.domainSize * 2.0 - vec2<f32>(1.0);
  // The canvas has the channel's aspect ratio, so a radius converted this way is
  // the same number of pixels on both axes and the dot is round.
  let extent = vec2<f32>(dotRadius) / u.domainSize * 2.0;
  out.position = vec4<f32>(centre + corner * extent, 0.0, 1.0);
  return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let r = length(input.offset);

  // fwidth gives the disc an edge one pixel wide whatever the dot's size on
  // screen, which is what keeps it round rather than stair-stepped after the
  // canvas is scaled down into the field's on-screen bounds.
  let edge = max(fwidth(r), 1.0e-4);
  let disc = 1.0 - smoothstep(1.0 - edge, 1.0, r);
  let core = 1.0 - smoothstep(0.6 - edge, 0.6 + edge, r);

  let alpha = disc * input.alpha;
  if (alpha <= 0.0) {
    discard;
  }
  return vec4<f32>(mix(vec3<f32>(0.04, 0.05, 0.09), vec3<f32>(0.98, 0.99, 1.0), core), alpha);
}
