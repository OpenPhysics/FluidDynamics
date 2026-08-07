# Fluid Dynamics — Model

## Overview

An incompressible viscous fluid flows left to right through a two-dimensional
channel past a fixed body. The simulation exists to make one thing visible: as
the Reynolds number rises, the wake behind the body changes character — from
smooth attached flow, to a steady pair of recirculation bubbles, to a periodic
Kármán vortex street, to a wake that has lost coherence altogether.

The learner controls the flow speed (Intro) or the speed, viscosity and body
(Lab). What actually decides the wake's character is the single dimensionless
group those combine into, which is why it is displayed next to the flow.

## Quantities and units

| Symbol | Quantity | Unit | Range |
|---|---|---|---|
| **u** | velocity field | m/s | — |
| *p* | pressure (divided by density) | m²/s | — |
| ω | vorticity, ∂v/∂x − ∂u/∂y | 1/s | — |
| *U* | inflow speed | m/s | 0.05 – 3 |
| ν | kinematic viscosity | m²/s | 3×10⁻⁴ – 10⁻¹ |
| *D* | obstacle diameter | m | 0.05 – 0.35 |
| *L* × *H* | channel size | m | 2 × 1 |
| *h* | grid cell size | m | 1/128 (standard), 1/256 (fine), 1/512 (very fine), 1/1024 (ultra fine) |
| Re | Reynolds number, *UD*/ν | — | ≈0.08 – 3500 |

Density is not a separate quantity: it is constant, and dividing the momentum
equation through by it leaves the kinematic viscosity and a pressure in m²/s.
Nothing in the simulation depends on the fluid's actual density.

## Governing equations

The incompressible Navier–Stokes equations:

```
∂u/∂t + (u·∇)u = −∇p + ν∇²u + f
∇·u = 0
```

and a passive tracer (the dye) carried by the flow without affecting it:

```
∂c/∂t + (u·∇)c = −κc
```

## Solution method

Jos Stam's *Stable Fluids* operator splitting, one pass per term, all in WGSL
compute shaders. Each frame advances the velocity field through:

1. **Advection** — (u·∇)u, by semi-Lagrangian backtrace with bilinear
   interpolation, followed by a MacCormack predictor–corrector that cancels most
   of the backtrace's numerical diffusion. A bound-preserving limiter keeps the
   corrected value inside the predictor's local range, so the step is unconditionally
   stable at any timestep and no more dissipative than the scheme it replaces.
2. **Diffusion** — ν∇²u, solved implicitly: (I − νΔt∇²)u = u₀, by 12 Jacobi
   sweeps. Implicit because the explicit stability limit Δt < h²/4ν is far below
   one frame at the high-viscosity end of the range. The loop is skipped when
   α = νΔt/h² collapses to zero (the paused path), where every sweep is the
   identity and only the seeding dispatch is needed.
3. **Vorticity confinement** — a correction, not a physical term. See below.
4. **Forcing and boundaries** — inflow, outflow, walls, and the learner's
   pointer.
5. **Projection** — ∇·u is computed, ∇²p = ∇·u is solved by red-black successive
   over-relaxation (30 alternating red/black sweeps, 50 with the higher-accuracy
   preference), and ∇p is subtracted. By the Helmholtz–Hodge decomposition this
   leaves the divergence-free part of the field, which is what incompressibility
   means. Red-black ordering runs Gauss–Seidel in parallel, and over-relaxation
   (ω = 1.7) squares the per-sweep error reduction, so the same dispatch budget
   leaves far less residual divergence than the Jacobi solve it replaced.

The dye is then injected at the inflow and advected by the finished velocity
field.

### Grid

Cell-centred and collocated — velocity, pressure, dye and vorticity all live at
the same points. 256 × 128 cells over the 2 m × 1 m channel by default, 512 × 256
on the Lab screen's fine setting, 1024 × 512 on very fine, and 2048 × 1024 on ultra
fine. Cells are square at every resolution.

### Boundary conditions

| Boundary | Condition |
|---|---|
| Inflow (left) | **u** = (*U*, small perturbation) |
| Outflow (right) | ∂**u**/∂x = 0, *p* = 0 |
| Top and bottom walls | free slip: *v* = 0, *u* unconstrained |
| Obstacle surface | no slip: **u** = 0; ∂p/∂n = 0 |

The Neumann pressure condition on the obstacle is what makes the body solid. Left
out, the projection pushes fluid straight through it and no wake forms at all.

## Simplifications and assumptions

**Two dimensions.** Real turbulence is three-dimensional: vortex stretching, the
mechanism that drives the energy cascade to small scales, does not exist in 2D.
What the high-Reynolds-number end of this simulation shows is a 2D wake that has
lost coherence, which looks turbulent and is not. The laminar and vortex-shedding
regimes, which are genuinely two-dimensional phenomena, are faithful.

**The displayed Reynolds number is nominal.** Re = *UD*/ν is computed from the
values the learner set. The *effective* Reynolds number is lower, because
advection is itself dissipative — even with the MacCormack corrector a residual
dissipation of order *h*|**u**|/2 remains, though an order of magnitude smaller
than plain semi-Lagrangian would leave. At the default grid it is still
comparable to the physical viscosity in the middle of its range. The regime
boundaries in `FlowRegime.ts` are the classical values for a circular cylinder
(Re ≈ 5, 47 and 200), and the solver was tuned to reproduce the matching
*behaviour* at those nominal numbers rather than the labels being moved to fit
the solver.

**Vorticity confinement is not physics.** Advection still damps the smallest
resolved eddies within a few steps — exactly the scale of the vortices being
shed, and the MacCormack corrector reduces but does not eliminate that damping.
Confinement (Fedkiw, Stam & Jensen 2001) adds a force along the gradient of |ω|
that pushes rotation back toward its concentrations, restoring what the numerics
removed. It adds energy to the flow, so it is a visual-fidelity knob, not a term
in Navier–Stokes.

Its strength is scaled by *h*|**u**|/2 ÷ (*h*|**u**|/2 + ν), the fraction of the
total damping that is numerical. This matters: at full strength it destabilises
wakes that should be steady, and a cylinder at Re ≈ 15 sheds vortices it has no
business shedding. With the scaling, the low-Reynolds-number end shows the
attached symmetric wake it should.

**The inflow is slightly perturbed.** Flow past a cylinder is symmetric about the
centreline, and so is the grid; a perfectly symmetric initial condition stays
symmetric forever and never sheds, at any Reynolds number. Real flow escapes this
because no laboratory inflow is perfectly uniform. The same is done here, with a
transverse perturbation of 0.4% of the inflow speed — enough to seed the
instability, far too small to see in the flow it produces.

**Pressure is collocated with velocity.** This admits a checkerboard pressure mode
that nothing damps once the viscosity is small enough; it appears as speckle on
the obstacle's surface. The viscosity slider's floor (3×10⁻⁴ m²/s) is set to keep
it out of the picture. A staggered (MAC) grid would remove it properly.

**The pressure solve does not fully converge.** Red-black SOR with ω = 1.7 and a
warm start from the previous frame's pressure drives the residual down fast, but
thirty sweeps still leave some residual divergence. It is far below what is
visible in the dye, which is the standard the simulation is held to.

## References

- Stam, J. (1999). *Stable Fluids.* SIGGRAPH '99, 121–128.
- Selle, A., Fedkiw, R., Kim, B., Liu, Y. & Rossignac, J. (2008). *An
  Unconditionally Stable MacCormack Method.* Journal of Scientific Computing 35,
  350–371. (The velocity advection corrector.)
- Fedkiw, R., Stam, J. & Jensen, H. W. (2001). *Visual Simulation of Smoke.*
  SIGGRAPH '01, 15–22. (Vorticity confinement.)
- Williamson, C. H. K. (1996). *Vortex dynamics in the cylinder wake.*
  Annual Review of Fluid Mechanics 28, 477–539. (Transition Reynolds numbers.)
- Harris, M. (2004). *Fast Fluid Dynamics Simulation on the GPU.* GPU Gems,
  chapter 38.
