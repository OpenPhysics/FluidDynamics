/**
 * WebGPUFluidEngine.ts
 *
 * Jos Stam's Stable Fluids, run entirely in WGSL compute shaders.
 *
 * The engine owns every GPU resource and the whole fluid state; nothing is
 * mirrored on the CPU. Its only inputs are the parameter values handed to
 * {@link step} each frame, and its only output is the detached canvas it renders
 * into, which FluidFieldNode blits into Scenery.
 *
 * ── One frame ─────────────────────────────────────────────────────────────────
 *   advect velocity → diffuse (viscosity) → curl → vorticity confinement
 *   → forces & boundaries → divergence → pressure (Jacobi ×N)
 *   → subtract pressure gradient → inject dye → advect dye → display
 *
 * Every compute dispatch above is recorded into a single compute pass on a
 * single command encoder, with one queue submission per frame.
 *
 * ── Ping-pong ─────────────────────────────────────────────────────────────────
 * A shader cannot read and write the same texture, so velocity, dye and pressure
 * each exist twice and swap roles after every write. Bind groups reference
 * concrete texture views, so every combination of parities that the frame can
 * reach is built once at construction: allocating bind groups inside the frame
 * loop is the classic way to make a WebGPU renderer allocate 60 times a second.
 *
 * ── Texture formats ───────────────────────────────────────────────────────────
 * Velocity and dye are rgba16float because semi-Lagrangian advection wants
 * hardware bilinear filtering, and rgba16float is both filterable and usable as
 * a storage texture in core WebGPU. rg32float would fit velocity exactly but is
 * not filterable without an optional feature. Pressure, divergence and curl are
 * r32float and are only ever read with textureLoad, so filtering does not apply.
 */

import {
  CHANNEL_HEIGHT_M,
  CHANNEL_WIDTH_M,
  DIFFUSION_ITERATIONS,
  DISPLAY_CANVAS_HEIGHT,
  DISPLAY_CANVAS_WIDTH,
} from "../../FluidDynamicsConstants.js";
import type { FluidGridSpec } from "./FluidGridSpec.js";
import { FluidUniforms, type FluidUniformValues, UNIFORM_BUFFER_SIZE } from "./FluidUniforms.js";
import advectWGSL from "./shaders/advect.wgsl?raw";
import commonWGSL from "./shaders/common.wgsl?raw";
import curlWGSL from "./shaders/curl.wgsl?raw";
import diffuseWGSL from "./shaders/diffuse.wgsl?raw";
import displayWGSL from "./shaders/display.wgsl?raw";
import divergenceWGSL from "./shaders/divergence.wgsl?raw";
import dyeWGSL from "./shaders/dye.wgsl?raw";
import forcesWGSL from "./shaders/forces.wgsl?raw";
import gradientSubtractWGSL from "./shaders/gradientSubtract.wgsl?raw";
import pressureWGSL from "./shaders/pressure.wgsl?raw";
import vorticityWGSL from "./shaders/vorticity.wgsl?raw";

const VELOCITY_FORMAT: GPUTextureFormat = "rgba16float";
const SCALAR_FORMAT: GPUTextureFormat = "r32float";

/** Everything step() needs that is not derived from the grid. */
export type FluidStepValues = Omit<FluidUniformValues, "domainWidth" | "domainHeight" | "dt"> & {
  readonly pressureIterations: number;
};

/** A field that must be read and written in the same pass, so it exists twice. */
class PingPong {
  private readonly textures: [GPUTexture, GPUTexture];
  public readonly views: [GPUTextureView, GPUTextureView];

  /** Index of the texture holding the current value. */
  public parity: 0 | 1 = 0;

  public constructor(device: GPUDevice, label: string, format: GPUTextureFormat, grid: FluidGridSpec) {
    const descriptor: GPUTextureDescriptor = {
      size: [grid.width, grid.height],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    };
    this.textures = [
      device.createTexture({ ...descriptor, label: `${label}0` }),
      device.createTexture({ ...descriptor, label: `${label}1` }),
    ];
    this.views = [this.textures[0].createView(), this.textures[1].createView()];
  }

  /** Records that the field was just written, so read and write swap. */
  public swap(): void {
    this.parity = this.parity === 0 ? 1 : 0;
  }

  public destroy(): void {
    this.textures[0].destroy();
    this.textures[1].destroy();
  }
}

/** Construction options. */
export type WebGPUFluidEngineOptions = {
  /**
   * Copy each finished frame to the canvas. Turned off by the engine integration
   * test, which reads pixels back from the offscreen target instead — some
   * headless environments cannot present WebGPU to a canvas at all.
   */
  readonly presentToCanvas?: boolean;
};

export class WebGPUFluidEngine {
  public readonly canvas: HTMLCanvasElement;

  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvasFormat: GPUTextureFormat;
  private readonly presentToCanvas: boolean;
  private readonly uniforms = new FluidUniforms();
  private readonly uniformBuffer: GPUBuffer;
  private readonly linearSampler: GPUSampler;

  /** Reports a device or validation error, so the view can show the fallback. */
  private readonly onFailure: () => void;

  private grid: FluidGridSpec;

  // Fields. Recreated whenever the grid resolution changes.
  private velocity!: PingPong;
  private dye!: PingPong;
  private pressure!: PingPong;
  private velocitySource!: GPUTexture;
  private velocitySourceView!: GPUTextureView;
  private divergence!: GPUTexture;
  private divergenceView!: GPUTextureView;
  private curl!: GPUTexture;
  private curlView!: GPUTextureView;

  private pipelines!: Pipelines;
  private bindGroups!: BindGroups;

  /**
   * Where the display pass draws. Rendering to an offscreen texture and then
   * copying to the canvas — rather than rendering straight into the canvas
   * texture — costs one full-surface GPU copy per frame and buys two things: the
   * finished frame can be read back for testing, and presentation becomes a
   * single command that can be skipped where it is unsupported.
   */
  private displayTexture!: GPUTexture;
  private displayView!: GPUTextureView;

  /** Staging buffer for readDisplayPixels, allocated on first use. */
  private readbackBuffer: GPUBuffer | null = null;

  private isDisposed = false;
  private hasFailed = false;

  public constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    grid: FluidGridSpec,
    onFailure: () => void,
    options?: WebGPUFluidEngineOptions,
  ) {
    this.canvas = canvas;
    this.device = device;
    this.grid = grid;
    this.onFailure = onFailure;
    this.presentToCanvas = options?.presentToCanvas ?? true;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    // Registered before any resource is created, so validation errors raised
    // during pipeline construction are caught too.
    device.addEventListener("uncapturederror", (event) => {
      this.reportError(event as GPUUncapturedErrorEvent);
    });

    canvas.width = DISPLAY_CANVAS_WIDTH;
    canvas.height = DISPLAY_CANVAS_HEIGHT;

    const context = canvas.getContext("webgpu");
    if (context === null) {
      this.hasFailed = true;
      onFailure();
      throw new Error("canvas does not support a webgpu context");
    }
    this.context = context;
    this.context.configure({
      device,
      format: this.canvasFormat,
      // COPY_DST because frames arrive by copyTextureToTexture from the
      // offscreen display target rather than by rendering into the canvas.
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      // Opaque: the result is blitted into Scenery's canvas with drawImage, and
      // a premultiplied-alpha surface would darken where the dye is thin.
      alphaMode: "opaque",
    });

    this.uniformBuffer = device.createBuffer({
      label: "fluid-uniforms",
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Clamp-to-edge, so a backtrace that leaves the channel reads the boundary
    // value rather than wrapping around to the far side.
    this.linearSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.displayTexture = device.createTexture({
      label: "display-target",
      size: [DISPLAY_CANVAS_WIDTH, DISPLAY_CANVAS_HEIGHT],
      format: this.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.displayView = this.displayTexture.createView();

    this.pipelines = createPipelines(device, this.canvasFormat);
    this.createFields();
  }

  /** Whether the engine is still able to render. */
  public get isRunning(): boolean {
    return !(this.isDisposed || this.hasFailed);
  }

  /** The grid the solver is currently running on. */
  public get gridSpec(): FluidGridSpec {
    return this.grid;
  }

  /**
   * Channel order of the bytes readDisplayPixels returns. It follows the
   * platform's preferred canvas format, which is bgra8unorm on most desktops —
   * so callers cannot assume RGBA.
   */
  public get displayFormat(): GPUTextureFormat {
    return this.canvasFormat;
  }

  /**
   * Advances the solver by dt seconds and renders the result.
   *
   * dt is expected to be pre-clamped and pre-substepped by the caller — the
   * engine runs exactly one solver step per call.
   */
  public step(dt: number, values: FluidStepValues): void {
    if (!this.isRunning) {
      return;
    }

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniforms.pack({ ...values, dt, domainWidth: CHANNEL_WIDTH_M, domainHeight: CHANNEL_HEIGHT_M }, this.grid),
    );

    const encoder = this.device.createCommandEncoder({ label: "fluid-frame" });
    this.recordCompute(encoder, values.pressureIterations);
    this.recordDisplay(encoder);
    if (this.presentToCanvas) {
      encoder.copyTextureToTexture({ texture: this.displayTexture }, { texture: this.context.getCurrentTexture() }, [
        DISPLAY_CANVAS_WIDTH,
        DISPLAY_CANVAS_HEIGHT,
      ]);
    }
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Reads the last rendered frame back as RGBA bytes, row-major from the top.
   *
   * The only way to inspect the solver's output without a display, and therefore
   * how the engine integration test checks that the physics is right. Not used
   * on the rendering path: a full readback stalls the pipeline.
   */
  public async readDisplayPixels(): Promise<Uint8Array> {
    // copyTextureToBuffer requires rows to be a multiple of 256 bytes.
    const bytesPerRow = Math.ceil((DISPLAY_CANVAS_WIDTH * 4) / 256) * 256;
    const size = bytesPerRow * DISPLAY_CANVAS_HEIGHT;

    this.readbackBuffer ??= this.device.createBuffer({
      label: "display-readback",
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const buffer = this.readbackBuffer;

    const encoder = this.device.createCommandEncoder({ label: "fluid-readback" });
    encoder.copyTextureToBuffer({ texture: this.displayTexture }, { buffer, bytesPerRow }, [
      DISPLAY_CANVAS_WIDTH,
      DISPLAY_CANVAS_HEIGHT,
    ]);
    this.device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();

    // Drop the row padding so callers get a tightly packed RGBA image.
    const tightBytesPerRow = DISPLAY_CANVAS_WIDTH * 4;
    if (bytesPerRow === tightBytesPerRow) {
      return padded;
    }
    const tight = new Uint8Array(tightBytesPerRow * DISPLAY_CANVAS_HEIGHT);
    for (let row = 0; row < DISPLAY_CANVAS_HEIGHT; row++) {
      tight.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + tightBytesPerRow), row * tightBytesPerRow);
    }
    return tight;
  }

  /** Clears the fluid state back to a channel at rest with no dye. */
  public reset(): void {
    if (!this.isRunning) {
      return;
    }
    // Recreating the textures is the clearing mechanism: WebGPU guarantees new
    // resources read as zero, which saves a clear kernel and two more layouts.
    this.destroyFields();
    this.createFields();
  }

  /** Switches the solver to a different grid, discarding the current state. */
  public setGrid(grid: FluidGridSpec): void {
    if (!this.isRunning || (grid.width === this.grid.width && grid.height === this.grid.height)) {
      return;
    }
    this.destroyFields();
    this.grid = grid;
    this.createFields();
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.destroyFields();
    this.displayTexture.destroy();
    this.readbackBuffer?.destroy();
    this.uniformBuffer.destroy();
  }

  // ── Frame recording ─────────────────────────────────────────────────────────

  private recordCompute(encoder: GPUCommandEncoder, pressureIterations: number): void {
    const pass = encoder.beginComputePass({ label: "fluid-solver" });
    const x = this.grid.dispatchX;
    const y = this.grid.dispatchY;
    const bg = this.bindGroups;

    const dispatch = (pipeline: GPUComputePipeline, group: GPUBindGroup): void => {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(x, y);
    };

    // 1. Advect velocity by itself, into the diffusion solve's fixed source.
    dispatch(this.pipelines.advectVelocity, bg.advectVelocity[this.velocity.parity]);

    // 2. Viscous diffusion. The first sweep seeds the iterate from the source;
    //    the rest ping-pong. Always run, even at low viscosity, where the
    //    iteration is very close to the identity.
    dispatch(this.pipelines.diffuse, bg.diffuseSeed);
    this.velocity.parity = 0;
    for (let i = 1; i < DIFFUSION_ITERATIONS; i++) {
      dispatch(this.pipelines.diffuse, bg.diffuse[this.velocity.parity]);
      this.velocity.swap();
    }

    // 3-4. Restore the small-scale vorticity advection dissipated.
    dispatch(this.pipelines.curl, bg.curl[this.velocity.parity]);
    dispatch(this.pipelines.vorticity, bg.vorticity[this.velocity.parity]);
    this.velocity.swap();

    // 5. Inflow, outflow, walls, and the learner's pointer.
    dispatch(this.pipelines.forces, bg.forces[this.velocity.parity]);
    this.velocity.swap();

    // 6-8. Projection: make the velocity field divergence-free.
    dispatch(this.pipelines.divergence, bg.divergence[this.velocity.parity]);
    for (let i = 0; i < pressureIterations; i++) {
      dispatch(this.pipelines.pressure, bg.pressure[this.pressure.parity]);
      this.pressure.swap();
    }
    dispatch(this.pipelines.gradientSubtract, bg.gradientSubtract[this.velocity.parity][this.pressure.parity]);
    this.velocity.swap();

    // 9-10. Dye: inject at the inflow, then carry it with the finished velocity.
    dispatch(this.pipelines.injectDye, bg.injectDye[this.dye.parity]);
    this.dye.swap();
    dispatch(this.pipelines.advectDye, bg.advectDye[this.velocity.parity][this.dye.parity]);
    this.dye.swap();

    pass.end();
  }

  private recordDisplay(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginRenderPass({
      label: "fluid-display",
      colorAttachments: [
        {
          view: this.displayView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.pipelines.display);
    pass.setBindGroup(0, this.bindGroups.display[this.dye.parity][this.velocity.parity][this.pressure.parity]);
    pass.draw(3);
    pass.end();
  }

  // ── Resources ───────────────────────────────────────────────────────────────

  private createFields(): void {
    const device = this.device;
    const grid = this.grid;

    this.velocity = new PingPong(device, "velocity", VELOCITY_FORMAT, grid);
    this.dye = new PingPong(device, "dye", VELOCITY_FORMAT, grid);
    this.pressure = new PingPong(device, "pressure", SCALAR_FORMAT, grid);

    const storageAndSample = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

    this.velocitySource = device.createTexture({
      label: "velocity-source",
      size: [grid.width, grid.height],
      format: VELOCITY_FORMAT,
      usage: storageAndSample,
    });
    this.velocitySourceView = this.velocitySource.createView();

    this.divergence = device.createTexture({
      label: "divergence",
      size: [grid.width, grid.height],
      format: SCALAR_FORMAT,
      usage: storageAndSample,
    });
    this.divergenceView = this.divergence.createView();

    this.curl = device.createTexture({
      label: "curl",
      size: [grid.width, grid.height],
      format: SCALAR_FORMAT,
      usage: storageAndSample,
    });
    this.curlView = this.curl.createView();

    this.bindGroups = this.createBindGroups();
  }

  private destroyFields(): void {
    this.velocity.destroy();
    this.dye.destroy();
    this.pressure.destroy();
    this.velocitySource.destroy();
    this.divergence.destroy();
    this.curl.destroy();
  }

  private createBindGroups(): BindGroups {
    const device = this.device;
    const layouts = this.pipelines.layouts;
    const uniform: GPUBindGroupEntry = { binding: 0, resource: { buffer: this.uniformBuffer } };
    const sampler: GPUBindGroupEntry = { binding: 1, resource: this.linearSampler };

    const velocityViews = this.velocity.views;
    const dyeViews = this.dye.views;
    const pressureViews = this.pressure.views;

    const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]): GPUBindGroup =>
      device.createBindGroup({ layout, entries });

    // Indexed by the parity of the field(s) each pass reads.
    const perParity = <T>(build: (parity: 0 | 1) => T): [T, T] => [build(0), build(1)];

    return {
      // Advects velocity by itself into velocitySource.
      advectVelocity: perParity((p) =>
        group(layouts.advect, [
          uniform,
          sampler,
          { binding: 2, resource: velocityViews[p] },
          { binding: 3, resource: velocityViews[p] },
          { binding: 4, resource: this.velocitySourceView },
        ]),
      ),

      // First diffusion sweep: iterate seeded from the source itself.
      diffuseSeed: group(layouts.twoInRGBA, [
        uniform,
        { binding: 1, resource: this.velocitySourceView },
        { binding: 2, resource: this.velocitySourceView },
        { binding: 3, resource: velocityViews[0] },
      ]),

      diffuse: perParity((p) =>
        group(layouts.twoInRGBA, [
          uniform,
          { binding: 1, resource: this.velocitySourceView },
          { binding: 2, resource: velocityViews[p] },
          { binding: 3, resource: velocityViews[p === 0 ? 1 : 0] },
        ]),
      ),

      curl: perParity((p) =>
        group(layouts.oneInScalar, [
          uniform,
          { binding: 1, resource: velocityViews[p] },
          { binding: 2, resource: this.curlView },
        ]),
      ),

      vorticity: perParity((p) =>
        group(layouts.mixedRGBA, [
          uniform,
          { binding: 1, resource: velocityViews[p] },
          { binding: 2, resource: this.curlView },
          { binding: 3, resource: velocityViews[p === 0 ? 1 : 0] },
        ]),
      ),

      forces: perParity((p) =>
        group(layouts.oneInRGBA, [
          uniform,
          { binding: 1, resource: velocityViews[p] },
          { binding: 2, resource: velocityViews[p === 0 ? 1 : 0] },
        ]),
      ),

      divergence: perParity((p) =>
        group(layouts.oneInScalar, [
          uniform,
          { binding: 1, resource: velocityViews[p] },
          { binding: 2, resource: this.divergenceView },
        ]),
      ),

      pressure: perParity((p) =>
        group(layouts.twoInScalar, [
          uniform,
          { binding: 1, resource: pressureViews[p] },
          { binding: 2, resource: this.divergenceView },
          { binding: 3, resource: pressureViews[p === 0 ? 1 : 0] },
        ]),
      ),

      gradientSubtract: perParity((v) =>
        perParity((p) =>
          group(layouts.mixedRGBA, [
            uniform,
            { binding: 1, resource: velocityViews[v] },
            { binding: 2, resource: pressureViews[p] },
            { binding: 3, resource: velocityViews[v === 0 ? 1 : 0] },
          ]),
        ),
      ),

      injectDye: perParity((d) =>
        group(layouts.oneInRGBA, [
          uniform,
          { binding: 1, resource: dyeViews[d] },
          { binding: 2, resource: dyeViews[d === 0 ? 1 : 0] },
        ]),
      ),

      advectDye: perParity((v) =>
        perParity((d) =>
          group(layouts.advect, [
            uniform,
            sampler,
            { binding: 2, resource: velocityViews[v] },
            { binding: 3, resource: dyeViews[d] },
            { binding: 4, resource: dyeViews[d === 0 ? 1 : 0] },
          ]),
        ),
      ),

      display: perParity((d) =>
        perParity((v) =>
          perParity((p) =>
            group(layouts.display, [
              uniform,
              sampler,
              { binding: 2, resource: dyeViews[d] },
              { binding: 3, resource: velocityViews[v] },
              { binding: 4, resource: this.curlView },
              { binding: 5, resource: pressureViews[p] },
            ]),
          ),
        ),
      ),
    };
  }

  private reportError(event: GPUUncapturedErrorEvent): void {
    if (this.hasFailed) {
      return;
    }
    this.hasFailed = true;
    // A WebGPU error is otherwise completely silent — it leaves a blank field
    // and no way at all to diagnose what went wrong. The learner still gets the
    // "WebGPU is not available" message via onFailure(); this line is for
    // whoever has to debug it. It is the only console use in src/, and the
    // hasFailed guard above means it fires at most once per engine.
    // biome-ignore lint/suspicious/noConsole: see above
    console.error(`WebGPU error in the fluid solver: ${event.error.message}`);
    this.onFailure();
  }
}

// ── Pipeline construction ─────────────────────────────────────────────────────

type Layouts = {
  readonly advect: GPUBindGroupLayout;
  readonly twoInRGBA: GPUBindGroupLayout;
  readonly oneInRGBA: GPUBindGroupLayout;
  readonly oneInScalar: GPUBindGroupLayout;
  readonly mixedRGBA: GPUBindGroupLayout;
  readonly twoInScalar: GPUBindGroupLayout;
  readonly display: GPUBindGroupLayout;
};

type Pipelines = {
  readonly layouts: Layouts;
  readonly advectVelocity: GPUComputePipeline;
  readonly advectDye: GPUComputePipeline;
  readonly diffuse: GPUComputePipeline;
  readonly curl: GPUComputePipeline;
  readonly vorticity: GPUComputePipeline;
  readonly forces: GPUComputePipeline;
  readonly divergence: GPUComputePipeline;
  readonly pressure: GPUComputePipeline;
  readonly gradientSubtract: GPUComputePipeline;
  readonly injectDye: GPUComputePipeline;
  readonly display: GPURenderPipeline;
};

type BindGroups = {
  readonly advectVelocity: [GPUBindGroup, GPUBindGroup];
  readonly diffuseSeed: GPUBindGroup;
  readonly diffuse: [GPUBindGroup, GPUBindGroup];
  readonly curl: [GPUBindGroup, GPUBindGroup];
  readonly vorticity: [GPUBindGroup, GPUBindGroup];
  readonly forces: [GPUBindGroup, GPUBindGroup];
  readonly divergence: [GPUBindGroup, GPUBindGroup];
  readonly pressure: [GPUBindGroup, GPUBindGroup];
  readonly gradientSubtract: [[GPUBindGroup, GPUBindGroup], [GPUBindGroup, GPUBindGroup]];
  readonly injectDye: [GPUBindGroup, GPUBindGroup];
  readonly advectDye: [[GPUBindGroup, GPUBindGroup], [GPUBindGroup, GPUBindGroup]];
  readonly display: [
    [[GPUBindGroup, GPUBindGroup], [GPUBindGroup, GPUBindGroup]],
    [[GPUBindGroup, GPUBindGroup], [GPUBindGroup, GPUBindGroup]],
  ];
};

const COMPUTE = GPUShaderStage.COMPUTE;
const FRAGMENT = GPUShaderStage.FRAGMENT;

const uniformEntry = (visibility: number): GPUBindGroupLayoutEntry => ({
  binding: 0,
  visibility,
  buffer: { type: "uniform" },
});

const filterable = (binding: number, visibility: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility,
  texture: { sampleType: "float" },
});

/**
 * r32float is not guaranteed filterable, so pressure, divergence and curl must
 * be declared unfilterable and read with textureLoad.
 */
const unfilterable = (binding: number, visibility: number): GPUBindGroupLayoutEntry => ({
  binding,
  visibility,
  texture: { sampleType: "unfilterable-float" },
});

const storageOut = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: COMPUTE,
  storageTexture: { access: "write-only", format },
});

function createPipelines(device: GPUDevice, canvasFormat: GPUTextureFormat): Pipelines {
  const layouts: Layouts = {
    advect: device.createBindGroupLayout({
      label: "advect",
      entries: [
        uniformEntry(COMPUTE),
        { binding: 1, visibility: COMPUTE, sampler: { type: "filtering" } },
        filterable(2, COMPUTE),
        filterable(3, COMPUTE),
        storageOut(4, VELOCITY_FORMAT),
      ],
    }),
    twoInRGBA: device.createBindGroupLayout({
      label: "two-in-rgba",
      entries: [uniformEntry(COMPUTE), filterable(1, COMPUTE), filterable(2, COMPUTE), storageOut(3, VELOCITY_FORMAT)],
    }),
    oneInRGBA: device.createBindGroupLayout({
      label: "one-in-rgba",
      entries: [uniformEntry(COMPUTE), filterable(1, COMPUTE), storageOut(2, VELOCITY_FORMAT)],
    }),
    oneInScalar: device.createBindGroupLayout({
      label: "one-in-scalar",
      entries: [uniformEntry(COMPUTE), filterable(1, COMPUTE), storageOut(2, SCALAR_FORMAT)],
    }),
    mixedRGBA: device.createBindGroupLayout({
      label: "mixed-rgba",
      entries: [
        uniformEntry(COMPUTE),
        filterable(1, COMPUTE),
        unfilterable(2, COMPUTE),
        storageOut(3, VELOCITY_FORMAT),
      ],
    }),
    twoInScalar: device.createBindGroupLayout({
      label: "two-in-scalar",
      entries: [
        uniformEntry(COMPUTE),
        unfilterable(1, COMPUTE),
        unfilterable(2, COMPUTE),
        storageOut(3, SCALAR_FORMAT),
      ],
    }),
    display: device.createBindGroupLayout({
      label: "display",
      entries: [
        uniformEntry(FRAGMENT),
        { binding: 1, visibility: FRAGMENT, sampler: { type: "filtering" } },
        filterable(2, FRAGMENT),
        filterable(3, FRAGMENT),
        unfilterable(4, FRAGMENT),
        unfilterable(5, FRAGMENT),
      ],
    }),
  };

  // WGSL has no include mechanism, so the shared struct and helpers are
  // concatenated ahead of every shader.
  const module = (label: string, source: string): GPUShaderModule =>
    device.createShaderModule({ label, code: `${commonWGSL}\n${source}` });

  const compute = (label: string, layout: GPUBindGroupLayout, source: string, entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: module(label, source), entryPoint },
    });

  const advectModule = module("advect", advectWGSL);
  const advectLayout = device.createPipelineLayout({ bindGroupLayouts: [layouts.advect] });

  const displayModule = module("display", displayWGSL);

  return {
    layouts,
    advectVelocity: device.createComputePipeline({
      label: "advect-velocity",
      layout: advectLayout,
      compute: { module: advectModule, entryPoint: "advectVelocity" },
    }),
    advectDye: device.createComputePipeline({
      label: "advect-dye",
      layout: advectLayout,
      compute: { module: advectModule, entryPoint: "advectDye" },
    }),
    diffuse: compute("diffuse", layouts.twoInRGBA, diffuseWGSL, "main"),
    curl: compute("curl", layouts.oneInScalar, curlWGSL, "main"),
    vorticity: compute("vorticity", layouts.mixedRGBA, vorticityWGSL, "main"),
    forces: compute("forces", layouts.oneInRGBA, forcesWGSL, "main"),
    divergence: compute("divergence", layouts.oneInScalar, divergenceWGSL, "main"),
    pressure: compute("pressure", layouts.twoInScalar, pressureWGSL, "main"),
    gradientSubtract: compute("gradient-subtract", layouts.mixedRGBA, gradientSubtractWGSL, "main"),
    injectDye: compute("inject-dye", layouts.oneInRGBA, dyeWGSL, "main"),
    display: device.createRenderPipeline({
      label: "display",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.display] }),
      vertex: { module: displayModule, entryPoint: "vs" },
      fragment: {
        module: displayModule,
        entryPoint: "fs",
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    }),
  };
}
