# CLAUDE.md — Fluid Dynamics

Sim-specific context for AI assistants. General SceneryStack guidance: [OpenPhysics/.github/CLAUDE.md](https://github.com/OpenPhysics/.github/blob/main/CLAUDE.md).

## Project

Flow past an obstacle, from laminar streamlines to a Kármán vortex street to a
turbulent wake. Jos Stam's **Stable Fluids** solver runs entirely in WGSL compute
shaders on **WebGPU** — there is no CPU fallback, and where WebGPU is unavailable
the sim shows a message in place of the field.

Physics and its limits: [`doc/model.md`](doc/model.md).
Architecture and the non-obvious decisions: [`doc/implementation-notes.md`](doc/implementation-notes.md).
Read both before changing the solver or the Scenery ↔ WebGPU bridge.

## Key files

| File | Purpose |
|---|---|
| `src/FluidDynamicsColors.ts` | All `ProfileColorProperty` instances, including the two dye colours |
| `src/FluidDynamicsConstants.ts` | Every named number: layout px, grid, solver iteration counts, physics ranges in SI |
| `src/common/model/FluidModel.ts` | All flow parameters + derived Reynolds number and regime |
| `src/common/model/FlowRegime.ts` | Regime vocabulary and classification |
| `src/common/gpu/WebGPUFluidEngine.ts` | Textures, pipelines, bind groups, one frame |
| `src/common/gpu/shaders/common.wgsl` | Uniform struct + obstacle SDF + grid helpers, prepended to every shader |
| `src/common/gpu/FluidUniforms.ts` | CPU mirror of that struct — **must** stay in step with it |
| `src/common/gpu/bindLayouts.ts` | Bind group layouts as plain data, checked against the WGSL by a test |
| `src/common/gpu/solverSchedule.ts` | How many sweeps the viscous solve needs, and at what ω |
| `src/common/view/FluidFieldNode.ts` | The Scenery ↔ WebGPU bridge |
| `src/common/view/FluidScreenView.ts` | Layout and wiring shared by both screens |
| `src/common/view/fluidDescription.ts` | Live a11y description, shared by field and screen summaries |
| `src/intro/`, `src/lab/` | Thin screen wrappers; they differ only in `showFullControls` |

## Things that will bite you

**`CanvasNode` does not own a canvas.** Scenery hands `paintCanvas()` a 2D
context belonging to its own shared canvas layer. The engine owns a *detached*
canvas configured with a `"webgpu"` context, and `paintCanvas` blits it with
`drawImage` — never `putImageData`, which ignores the transform Scenery already
applied. All GPU work happens in `update()`, called from the ScreenView's
`step()`; `paintCanvas` only blits, and `update()` must end with
`invalidatePaint()`.

**The view must not call `model.step()`.** joist already steps the active
screen's model.

**Uniform layout is unvalidated by WebGPU.** If `FluidUniforms.ts` and the
`SimUniforms` struct in `common.wgsl` drift apart, every shader reads a shifted
field and it looks like a physics bug. `tests/FluidUniforms.test.ts` parses the
WGSL and pins the contract — if you add a uniform, add it in both places and the
test will tell you if you got it wrong.

**Bind group layouts are shared between kernels, and unvalidated until a device
exists.** Add a binding to a shader and you must add it to the layout in
`FluidUniforms.ts`' neighbour `bindLayouts.ts` — `tests/ShaderBindings.test.ts`
parses the WGSL and will tell you, in Vitest, what the GPU would only have told
you at startup on hardware.

**Nothing in a compute kernel may call `obstacleSDF()`.** The obstacle's signed
distance is baked into a texture by `mask.wgsl` when the body moves; kernels read
it with `isSolidAt(obstacleTex, …)`. Only `display.wgsl` still evaluates the SDF,
because it needs sub-cell accuracy for the outline. Going back to the analytic
call inside the pressure solve costs ~10⁸ transcendental-heavy evaluations a
frame at the finest grid.

**Load shaders with `?raw`, never `fetch()`.** The `inlineSingleFile()` plugin
requires no runtime file fetches, and the PWA's `globPatterns` does not include
`.wgsl`.

**WebGPU canvas presentation does not work in headless Chromium under WSL2** —
the device is lost the moment any canvas is presented, with or without compute.
Compute and offscreen rendering work fine. `tests/fuzz/engine.spec.ts` therefore
runs the engine with `presentToCanvas: false` and reads pixels back.

**Vorticity confinement is scaled by how much of the damping is numerical.**
Removing that scaling makes low-Reynolds-number wakes shed vortices they should
not. See `shaders/vorticity.wgsl` and `doc/model.md`.

## Common components

Use `FluidDynamicsPanel` for every panel, and the `FLAT_*` option bundles from
`FluidDynamicsButtonOptions.ts` for every button — SceneryStack's defaults are
beveled and this sim is flat. Pair combo-box item labels with
`LIGHT_SURFACE_TEXT_FILL`, not `textColorProperty`.

`TimeModel` is composed into each screen model (never subclassed) and bound to
`TimeControlNode` via `isPlayingProperty`.

## Accessibility

A screen-reader user cannot see the dye, so `createFluidDescriptionProperty()`
builds a live sentence naming the body, speed, Reynolds number and regime, and
the *same Property* is used as the field's `accessibleParagraph` and as both
screens' `currentDetailsContent`. Keep it that way — they must not be allowed to
disagree.

Every control takes its `accessibleName` from the shared `a11y.fluid` string
group, never a literal. New strings must be added to **all three** locale files;
`StringManager.ts` enforces key parity at compile time.

## Compliance carve-out

**The solver lives under `src/common/gpu/`, not `src/common/model/`.** Fleet
convention says the view never integrates physics, but there is no CPU-side fluid
state to model: velocity, pressure and dye exist only as GPU textures, and none
of it can be stepped without a `GPUDevice`. So the *parameters* are a model
(`FluidModel`, no scenery and no GPU imports, fully unit-tested) and the solver
is a view-side renderer, mirroring `Resonance`'s `WebGLParticleRenderer`.
`FluidFieldNode` is the only file that touches both.

## Testing

Fleet-standard Vitest layout under root `tests/`, plus a Playwright suite:

| Path | Purpose |
|---|---|
| `tests/FluidUniforms.test.ts` | CPU/GPU struct layout contract |
| `tests/ShaderBindings.test.ts` | WGSL `@binding` ↔ bind-group-layout contract |
| `tests/solverSchedule.test.ts` | Viscous solve sweep count and relaxation factor |
| `tests/FluidGridSpec.test.ts` | Dispatch arithmetic, square cells, uv mapping |
| `tests/FlowRegime.test.ts` | Reynolds thresholds and boundaries |
| `tests/FluidModel.test.ts` | Derived Re, reset, reachable regimes, shader codes |
| `tests/memory-leak.test.ts` | WeakRef dispose regression (both models) |
| `tests/harness/engine.html` | Page that loads the real engine for the test below |
| `tests/fuzz/engine.spec.ts` | **The solver**, in a real browser, verified by pixel readback |
| `tests/fuzz/fuzz.spec.ts` | joist `?fuzz` smoke |

`engine.spec.ts` needs a WebGPU adapter and skips without one; it takes several
minutes on a software rasterizer, so it is not part of `npm test`.

## Commands

```bash
npm run lint && npm run check && npm run build && npm test
```

| Command | Description |
|---|---|
| `npm start` / `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run build:single` | Single-file build mode |
| `npm run check` | TypeScript (`tsc --noEmit` + scripts + tests projects) |
| `npm run lint` / `npm run fix` | Biome check / auto-fix |
| `npm test` | Vitest unit tests |
| `npm run test:fuzz` | Playwright: engine integration + fuzz smoke |
| `npm run icons` | Regenerate PWA icons |

## Query parameters

| Parameter | Purpose |
|---|---|
| `highQualitySolver` | Public. Initial value of the Preferences → Simulation toggle (50 vs 30 red-black SOR pressure sweeps). |
| `pressureIterations` | Development only. Overrides both the default and the preference; `0` means "use the preference". |

## PWA

After `npm run build`, the sim is installable offline via Workbox
(`dist/manifest.webmanifest`).
