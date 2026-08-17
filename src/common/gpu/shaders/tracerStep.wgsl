// tracerStep.wgsl — advection of the tracer dots.
//
// The dots are massless, neutrally buoyant markers: they are carried by the
// velocity field and have no effect on it whatsoever, exactly like the dye. What
// they add over the dye is identity — a dot is the *same* parcel of fluid frame
// after frame, so the eye can follow one all the way round the body, watch it
// stall at the nose, or see it caught in the recirculation bubble and carried
// backwards.
//
// One invocation per particle, over a flat storage buffer of
//
//   vec4(x, y, age, alive)
//
// with position in metres from the channel's lower-left corner, age in seconds
// since release (the draw pass fades a dot up over its first fraction of a
// second), and alive as a 0/1 flag. A zeroed buffer is therefore a full set of
// parked dots, which is what a freshly created buffer already reads as — the
// same trick the engine's reset() plays with the field textures.
//
// ── Release ───────────────────────────────────────────────────────────────────
// Which column is (re)released this step is decided on the CPU, by the distance
// clock in tracerSchedule.ts, and arrives as the tracerEmitBatch uniform: an
// index into the buffer's columns, or -1 for "nothing this step". A particle's
// column and lane are derived from its index rather than stored, so releasing a
// column costs nothing but the comparison every particle already makes.
//
// A parked particle is not deleted, and nothing is compacted: it simply waits,
// invisible, until its slot's turn comes round. That is what bounds the lifetime
// of a dot trapped at a stagnation point, and it is why there is no free list.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var linearSampler : sampler;
@group(0) @binding(2) var velocityTex : texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> tracers : array<vec4<f32>>;
@group(0) @binding(6) var obstacleTex : texture_2d<f32>;

// Supplied at pipeline creation from FluidDynamicsConstants, so the geometry has
// exactly one definition. The defaults are only a fallback for a pipeline built
// without constants.
override laneCount : u32 = 21u;
override inletX : f32 = 0.02;
override exitMargin : f32 = 0.01;

// Velocity in m/s at a point in metres. Clamped rather than wrapped: a dot that
// drifts a hair past the boundary must read the boundary's velocity, not the
// far wall's.
fn velocityAt(p: vec2<f32>) -> vec2<f32> {
  let uv = clamp(metresToUV(p, u), vec2<f32>(0.0), vec2<f32>(1.0));
  return textureSampleLevel(velocityTex, linearSampler, uv, 0.0).xy;
}

fn isInsideBody(p: vec2<f32>) -> bool {
  return isSolidAt(obstacleTex, vec2<i32>(floor(metresToUV(p, u) * u.gridSize)), u);
}

// Lane i sits at (i+1)/(N+1) of the channel height, so the outermost dots keep a
// full lane's clearance from the walls instead of being pinned in the boundary
// layer where the no-slip condition would leave them motionless.
fn laneHeight(lane: u32) -> f32 {
  return (f32(lane) + 1.0) / (f32(laneCount) + 1.0) * u.domainSize.y;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  // The dispatch is rounded up to whole workgroups, so the last one runs off the
  // end of the buffer.
  if (index >= arrayLength(&tracers)) {
    return;
  }

  let batch = i32(index / laneCount);
  if (i32(round(u.tracerEmitBatch)) == batch) {
    tracers[index] = vec4<f32>(inletX, laneHeight(index % laneCount), 0.0, 1.0);
    return;
  }

  let tracer = tracers[index];
  if (tracer.w < 0.5) {
    return;
  }

  // Midpoint (RK2) rather than Euler, for the same reason the semi-Lagrangian
  // backtrace uses it: an Euler step follows the velocity at the departure point
  // for the whole step and so cuts the corner on every curved path, and a vortex
  // is nothing but curved paths. A dot circling the wake would spiral out of it.
  let v1 = velocityAt(tracer.xy);
  let midpoint = tracer.xy + 0.5 * u.dt * v1;
  let position = tracer.xy + u.dt * velocityAt(midpoint);

  // Retire on the way out, on either wall (numerically reachable even though the
  // walls are no-slip), and on contact with the body — the last of which also
  // covers the learner dragging the obstacle over a dot, and keeps the draw pass
  // from ever painting a dot on top of the body.
  let hasLeft =
    position.x > u.domainSize.x - exitMargin ||
    position.x < 0.0 ||
    position.y < 0.0 ||
    position.y > u.domainSize.y ||
    isInsideBody(position);

  tracers[index] = vec4<f32>(position, tracer.z + u.dt, select(1.0, 0.0, hasLeft));
}
