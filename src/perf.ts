/**
 * Lightweight performance telemetry for the render loop.
 *
 * The browser's requestAnimationFrame cadence is normally pinned to the
 * display refresh rate, so frame *interval* alone cannot tell us how much
 * main-thread work a view costs. This module records the time spent inside the
 * frame callback (JS + render submission) and exposes p50/p95/max for tests
 * and for the optional `?perf=1` overlay.
 */

export interface FrameStats {
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over20Ms: number;
  over33Ms: number;
}

export interface MemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface RendererInfo {
  vendor: string | null;
  renderer: string | null;
  software: boolean;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * fraction)),
  );
  return sorted[index];
}

export class PerfMonitor {
  private readonly samples: number[] = [];
  private readonly capacity: number;
  private totalFrames = 0;

  constructor(capacity = 3_600) {
    this.capacity = Math.max(60, capacity);
  }

  record(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.totalFrames++;
    this.samples.push(durationMs);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  reset(): void {
    this.samples.length = 0;
    this.totalFrames = 0;
  }

  get frameCount(): number {
    return this.totalFrames;
  }

  summary(last = 600): FrameStats {
    const values = this.samples.slice(-Math.max(1, last));
    if (values.length === 0) {
      return {
        frames: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
        over20Ms: 0,
        over33Ms: 0,
      };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      frames: values.length,
      meanMs: mean,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1],
      over20Ms: values.filter((value) => value > 20).length,
      over33Ms: values.filter((value) => value > 33.4).length,
    };
  }
}

export function memorySnapshot(): MemorySnapshot | null {
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (!memory) return null;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

let cachedRenderer: RendererInfo | null = null;

/**
 * Read the WebGL renderer string once. Headless Chromium normally reports
 * SwiftShader (software rendering); that matters when interpreting frame
 * timing numbers.
 */
export function detectRenderer(): RendererInfo {
  if (cachedRenderer) return cachedRenderer;
  const result: RendererInfo = { vendor: null, renderer: null, software: false };
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (gl && 'getParameter' in gl) {
      const context = gl as WebGLRenderingContext;
      const debug = context.getExtension('WEBGL_debug_renderer_info');
      if (debug) {
        result.vendor = String(
          context.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? '',
        );
        result.renderer = String(
          context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '',
        );
      } else {
        result.vendor = String(context.getParameter(context.VENDOR) ?? '');
        result.renderer = String(context.getParameter(context.RENDERER) ?? '');
      }
      result.software = /swiftshader|llvmpipe|software|softpipe/i.test(
        `${result.vendor} ${result.renderer}`,
      );
    }
  } catch {
    // Renderer detection is diagnostic only.
  }
  cachedRenderer = result;
  return result;
}

export interface PerfApi {
  monitor: PerfMonitor;
  summary(last?: number): FrameStats;
  memory(): MemorySnapshot | null;
  renderer(): RendererInfo;
  reset(): void;
}

export function createPerfApi(monitor = new PerfMonitor()): PerfApi {
  return {
    monitor,
    summary: (last = 600) => monitor.summary(last),
    memory: () => memorySnapshot(),
    renderer: () => detectRenderer(),
    reset: () => monitor.reset(),
  };
}

declare global {
  interface Window {
    __apophisPerf?: PerfApi;
  }
}
