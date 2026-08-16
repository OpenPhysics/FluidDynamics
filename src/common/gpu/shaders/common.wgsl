// common.wgsl
//
// Preamble prepended to every fluid shader by WebGPUFluidEngine. WGSL has no
// #include, so sharing is done by string concatenation in TypeScript.
//
// The SimUniforms struct below is the contract with FluidUniforms.ts: member
// order here and the float offsets there must agree, and a unit test asserts it.
// Fields are grouped by alignment (vec4 first, then vec2, then f32) so no member
// needs implicit padding. The members occupy 140 bytes; the struct's own
// alignment rounds that up to 144, which is the uniform buffer's size.

struct SimUniforms {
  // Dye injected at the inflow, in alternating bands. Two colors rather than one
  // because the shear layer between them is what makes the vortex street legible.
  dyeColorA      : vec4<f32>,
  dyeColorB      : vec4<f32>,

  // Channel size in metres. Shader geometry works in metres so that radii stay
  // isotropic; uv is anisotropic whenever the channel is not square.
  domainSize     : vec2<f32>,
  // 1/gridWidth, 1/gridHeight — one texel step in uv.
  texelSize      : vec2<f32>,
  gridSize       : vec2<f32>,
  // Obstacle centre, in metres from the channel's lower-left corner.
  obstacleCenter : vec2<f32>,
  // Pointer position and per-frame motion, in metres.
  pointerPos     : vec2<f32>,
  pointerDelta   : vec2<f32>,

  dt             : f32,
  viscosity      : f32,
  vorticity      : f32,
  dyeDissipation : f32,
  inflowSpeed    : f32,
  // Obstacle half-size in metres: the cylinder's radius, the plate's half-height,
  // half the airfoil's chord.
  obstacleRadius : f32,
  obstacleShape  : f32,
  // Angle of attack of the plate, the airfoil and the ellipse's major axis, in
  // radians from the inflow direction. Positive tilts the leading edge up. The
  // cylinder ignores it.
  obstacleAngle  : f32,
  // Half the distance between the ellipse's two foci, in metres. Zero makes the
  // ellipse a disk. The other shapes ignore it.
  obstacleFocalRadius : f32,
  // Airfoil maximum thickness as a fraction of chord (NACA 00xx). Other shapes
  // ignore it.
  airfoilThickness    : f32,
  visualization  : f32,
  pointerActive  : f32,
  pointerRadius  : f32,
  // Speed that maps to the top of the color ramp in the non-dye views.
  velocityScale  : f32,
  // Elapsed simulation time in seconds. Used only to make the inflow
  // perturbation in forces.wgsl vary, which is what seeds vortex shedding.
  time           : f32,
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

// Centre of cell (x, y) in uv. The +0.5 samples the texel centre; without it,
// every bilinear fetch would be biased half a texel toward the origin.
fn cellToUV(cell: vec2<u32>, uniforms: SimUniforms) -> vec2<f32> {
  return (vec2<f32>(cell) + vec2<f32>(0.5)) * uniforms.texelSize;
}

fn uvToMetres(uv: vec2<f32>, uniforms: SimUniforms) -> vec2<f32> {
  return uv * uniforms.domainSize;
}

fn metresToUV(p: vec2<f32>, uniforms: SimUniforms) -> vec2<f32> {
  return p / uniforms.domainSize;
}

// ── Obstacle geometry ─────────────────────────────────────────────────────────

// Signed distance (negative inside) to a box of the given half-extents.
fn boxSDF(d: vec2<f32>, halfExtents: vec2<f32>) -> f32 {
  let q = abs(d) - halfExtents;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
}

// Rotates a world-frame offset into the chord's frame. The chord's +x axis runs
// from leading edge to trailing edge, so a positive angle of attack tilts the
// leading edge up — the sign convention every aerodynamics text uses.
fn toChordFrame(d: vec2<f32>, alpha: f32) -> vec2<f32> {
  let c = cos(alpha);
  let s = sin(alpha);
  return vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);
}

// Approximate signed distance to a symmetric NACA 00xx section of the given
// chord and thickness fraction, at the given angle of attack. The NACA
// thickness distribution has no closed-form distance function; the vertical
// gap to the surface is used instead. Only the sign is load-bearing (it
// decides which cells are solid); the magnitude is used for the outline in
// the display pass, where a slightly wrong distance is invisible.
fn airfoilSDF(d: vec2<f32>, chord: f32, thickness: f32, alpha: f32) -> f32 {
  // Rotate into the airfoil's frame, then shift so x runs 0..1 from leading edge.
  let local = toChordFrame(d, alpha);
  let x = local.x / chord + 0.5;
  let y = local.y / chord;

  if (x < 0.0 || x > 1.0) {
    // Off the ends of the chord: fall back to distance from the nearest chord end.
    let nearest = vec2<f32>(clamp(x, 0.0, 1.0) - 0.5, 0.0) * chord;
    return length(local - nearest);
  }

  let halfThickness =
    5.0 * thickness *
    (0.2969 * sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
  return (abs(y) - halfThickness) * chord;
}

// Approximate signed distance to an ellipse with semi-axes (a, b) at the given
// angle of attack. The exact ellipse distance has no closed form; scaling space
// so the ellipse becomes a unit circle and scaling the result back is exact on
// the axes and slightly short elsewhere. Like the airfoil, only the sign is
// load-bearing for the solver, and the display pass only needs it near the rim.
fn ellipseSDF(d: vec2<f32>, a: f32, b: f32, alpha: f32) -> f32 {
  let local = toChordFrame(d, alpha);
  return (length(local / vec2<f32>(a, b)) - 1.0) * min(a, b);
}

// Signed distance to the obstacle at a point in metres. Positive outside.
// The shape codes match ObstacleShape.ts: 0 none, 1 cylinder, 2 plate, 3
// airfoil, 4 ellipse.
fn obstacleSDF(p: vec2<f32>, uniforms: SimUniforms) -> f32 {
  let shape = i32(uniforms.obstacleShape + 0.5);
  let d = p - uniforms.obstacleCenter;
  let r = uniforms.obstacleRadius;
  let alpha = uniforms.obstacleAngle;

  if (shape == 1) {
    return length(d) - r;
  }
  if (shape == 2) {
    // A thin plate: half a chord long, 12 % of that thick. At zero angle of
    // attack it lies along the flow and slips through it; at ±90° it stands
    // broadside — the bluffest body available, shedding at the lowest speed of
    // the three.
    return boxSDF(toChordFrame(d, alpha), vec2<f32>(r, r * 0.12));
  }
  if (shape == 3) {
    return airfoilSDF(d, r * 2.0, uniforms.airfoilThickness, alpha);
  }
  if (shape == 4) {
    // An ellipse with its foci on the major axis: a = D/2 out to the rim, and
    // b = √(a² − c²) from the focal half-separation. The clamp is insurance
    // for a stale uniform: the model never lets c reach a, but if one ever
    // did, √ of a negative is NaN and every comparison after it is false.
    let c = min(uniforms.obstacleFocalRadius, 0.95 * r);
    let b = sqrt(max(r * r - c * c, r * r * 0.0025));
    return ellipseSDF(d, r, b, alpha);
  }
  // "none": a distance no cell can be inside of.
  return 1.0e9;
}

// ── Grid helpers ──────────────────────────────────────────────────────────────

// True when the invocation is inside the grid. Dispatch sizes are rounded up to
// whole workgroups, so the last workgroup in each direction runs partly out of
// bounds and every kernel must start with this guard.
fn inGrid(cell: vec2<u32>, uniforms: SimUniforms) -> bool {
  return cell.x < u32(uniforms.gridSize.x) && cell.y < u32(uniforms.gridSize.y);
}

// Clamps a neighbour index to the grid, giving a zero-gradient (Neumann)
// boundary for free: a stencil that reaches past the edge reads the edge cell.
fn clampCell(cell: vec2<i32>, uniforms: SimUniforms) -> vec2<i32> {
  return clamp(cell, vec2<i32>(0, 0), vec2<i32>(uniforms.gridSize) - vec2<i32>(1, 1));
}

// Nearest cell to a uv coordinate, for the non-filterable fields that have to be
// read with textureLoad instead of a sampler.
fn uvToCell(uv: vec2<f32>, uniforms: SimUniforms) -> vec2<i32> {
  return clampCell(vec2<i32>(floor(uv * uniforms.gridSize)), uniforms);
}

// Cell edge length in metres, the h in every finite difference below.
fn cellSize(uniforms: SimUniforms) -> f32 {
  return uniforms.domainSize.x / uniforms.gridSize.x;
}

// ── The baked obstacle field ──────────────────────────────────────────────────
//
// obstacleSDF() above is not cheap — the airfoil alone costs a sqrt, a sin, a
// cos and a quartic — and the solver asks "is this cell solid?" up to five times
// per cell in nearly every one of the ~50 dispatches that make up a frame. The
// pressure solve alone accounts for most of them.
//
// So the distance is evaluated once per cell by mask.wgsl, whenever the obstacle
// actually changes, and every compute kernel reads that texture instead. The
// analytic function is still used by the display pass, which samples between
// cells and needs sub-cell accuracy for the body's outline.
//
// The texture is a parameter rather than a global here because the binding is
// declared by each kernel that needs one, and display.wgsl has none.

fn obstacleDistanceAt(field: texture_2d<f32>, cell: vec2<i32>, uniforms: SimUniforms) -> f32 {
  return textureLoad(field, clampCell(cell, uniforms), 0).x;
}

// Clamping before the lookup gives a cell outside the grid the solidity of the
// edge cell nearest it, which is what the boundary stencils below rely on.
fn isSolidAt(field: texture_2d<f32>, cell: vec2<i32>, uniforms: SimUniforms) -> bool {
  return obstacleDistanceAt(field, cell, uniforms) <= 0.0;
}
