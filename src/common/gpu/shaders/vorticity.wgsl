// vorticity.wgsl — vorticity confinement (Fedkiw, Stam & Jensen 2001).
//
// Semi-Lagrangian advection is stable but strongly dissipative: it damps the
// smallest resolved eddies within a few steps. At 256 × 128 that is exactly the
// scale of the vortices being shed from the obstacle, so without a correction
// the wake smears into a smooth plume and the Kármán street never appears.
//
// Confinement measures where vorticity is concentrated (the gradient of |ω|),
// and adds a force that pushes rotation back toward those concentrations,
// restoring the small-scale detail advection removed.
//
// This is a numerical correction, not a term in the Navier–Stokes equations. It
// adds energy to the flow, so its strength is a fidelity knob rather than a
// physical parameter — see doc/model.md.

@group(0) @binding(0) var<uniform> u : SimUniforms;
@group(0) @binding(1) var velocityTex : texture_2d<f32>;
@group(0) @binding(2) var curlTex : texture_2d<f32>;
@group(0) @binding(3) var outTex : texture_storage_2d<rgba16float, write>;

fn curlAt(cell: vec2<i32>) -> f32 {
  return textureLoad(curlTex, clampCell(cell, u), 0).x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.xy;
  if (!inGrid(cell, u)) {
    return;
  }

  let velocity = textureLoad(velocityTex, vec2<i32>(cell), 0).xy;

  if (isSolidCell(vec2<i32>(cell), u)) {
    textureStore(outTex, cell, vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let c = vec2<i32>(cell);
  let h = cellSize(u);
  let curl = curlAt(c);

  // ∇|ω|, pointing toward the nearest concentration of rotation.
  let gradient = vec2<f32>(
    abs(curlAt(c + vec2<i32>(1, 0))) - abs(curlAt(c - vec2<i32>(1, 0))),
    abs(curlAt(c + vec2<i32>(0, 1))) - abs(curlAt(c - vec2<i32>(0, 1))),
  ) / (2.0 * h);

  // Normalize, guarding the flat regions where the gradient is numerically zero.
  let magnitude = length(gradient);
  if (magnitude < 1.0e-8) {
    textureStore(outTex, cell, vec4<f32>(velocity, 0.0, 1.0));
    return;
  }
  let n = gradient / magnitude;

  // ── How much confinement is justified here ──────────────────────────────────
  // Confinement exists to replace vorticity that the *numerical* scheme lost, so
  // it should be applied in proportion to how much of the total damping is
  // numerical. Semi-Lagrangian advection dissipates like a viscosity of order
  // h·|u|/2, so where the physical viscosity dominates that, there is nothing to
  // put back — and adding the force anyway drives a wake unstable that should
  // physically stay steady and symmetric.
  //
  // This is what keeps the low-Reynolds-number end of the flow-speed slider
  // showing an attached laminar wake instead of shedding.
  let numericalViscosity = 0.5 * h * length(velocity);
  let weight = numericalViscosity / (numericalViscosity + u.viscosity + 1.0e-12);

  // N × ω in two dimensions. The factor of h keeps the force's effect
  // independent of grid resolution.
  let force = vec2<f32>(n.y, -n.x) * curl * u.vorticity * h * weight;

  textureStore(outTex, cell, vec4<f32>(velocity + force * u.dt, 0.0, 1.0));
}
