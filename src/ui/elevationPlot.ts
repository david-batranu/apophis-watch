import type { PlotSample } from '../state/session';
import type { UiState } from '../state/store';
import { t } from '../i18n';
import { localHhMm } from './timeFormat';

interface PlotPalette {
  bg: string;
  grid: string;
  text: string;
  muted: string;
  elevation: string;
  magnitude: string;
  good: string;
  window: string;
  cursor: string;
}

function palette(night: boolean): PlotPalette {
  return night
    ? {
        bg: '#000000',
        grid: '#3a0808',
        text: '#ff8a7a',
        muted: '#a33a30',
        elevation: '#ff3b30',
        magnitude: '#ff6b5e',
        good: '#ff8a7a',
        window: 'rgba(255,59,48,0.10)',
        cursor: '#ffb0a0',
      }
    : {
        bg: '#0d1422',
        grid: '#203048',
        text: '#c9d6e8',
        muted: '#7d8fa8',
        elevation: '#6aa9ff',
        magnitude: '#ffb347',
        good: '#46d68a',
        window: 'rgba(106,169,255,0.08)',
        cursor: '#e8f0ff',
      };
}

export class ElevationPlot {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private samples: PlotSample[] = [];
  private windowStart = 0;
  private windowEnd = 1;
  private width = 640;
  private height = 190;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plot-canvas';
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable'); // developer/browser capability error
    this.ctx = ctx;
    new ResizeObserver(() => {
      this.resize();
      this.render(null, null);
    }).observe(host);
    this.resize();
  }

  setData(samples: PlotSample[], windowStart: number, windowEnd: number): void {
    this.samples = samples;
    this.windowStart = windowStart;
    this.windowEnd = windowEnd;
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(320, Math.round(rect.width));
    this.height = Math.max(160, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(state: Readonly<UiState> | null, currentUtcMs: number | null): void {
    const ctx = this.ctx;
    const p = palette(state?.toggles.nightMode ?? false);
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);

    const pad = { left: 34, right: 36, top: 16, bottom: 22 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    if (plotW <= 10 || plotH <= 10) return;

    const xOf = (ms: number) =>
      pad.left + ((ms - this.windowStart) / (this.windowEnd - this.windowStart)) * plotW;
    const yEl = (el: number) => pad.top + ((90 - Math.max(0, Math.min(90, el))) / 90) * plotH;
    const yMag = (mag: number) =>
      pad.top + ((Math.max(2, Math.min(14, mag)) - 2) / 12) * plotH;

    // Visibility shading from Phase 1 (physical: above horizon + Sun < -6).
    ctx.fillStyle = p.window;
    let shadeStart: number | null = null;
    for (const sample of this.samples) {
      if (sample.inVisibilityWindow && shadeStart === null) shadeStart = sample.utcMs;
      if (!sample.inVisibilityWindow && shadeStart !== null) {
        ctx.fillRect(xOf(shadeStart), pad.top, xOf(sample.utcMs) - xOf(shadeStart), plotH);
        shadeStart = null;
      }
    }
    if (shadeStart !== null) {
      ctx.fillRect(xOf(shadeStart), pad.top, xOf(this.windowEnd) - xOf(shadeStart), plotH);
    }

    // Grid and axes.
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (const el of [0, 30, 60, 90]) {
      const y = yEl(el);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = p.muted;
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${el}°`, pad.left - 4, y);
    }
    for (const mag of [4, 8, 12]) {
      const y = yMag(mag);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = p.muted;
      ctx.textAlign = 'left';
      ctx.fillText(`${mag}`, pad.left + plotW + 5, y);
    }
    ctx.setLineDash([]);

    if (state) {
      const threshold = yEl(state.minGoodElevationDeg);
      ctx.strokeStyle = p.good;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, threshold);
      ctx.lineTo(pad.left + plotW, threshold);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = p.good;
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(t('plot.goodThreshold', { degrees: state.minGoodElevationDeg.toFixed(0) }), pad.left + 4, threshold - 5);
    }

    // Magnitude curve (thin amber).
    ctx.strokeStyle = p.magnitude;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    let started = false;
    for (const sample of this.samples) {
      const x = xOf(sample.utcMs);
      const y = yMag(sample.magnitude);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Elevation curve, split into physical-visible (good) and rest.
    ctx.lineWidth = 2;
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1];
      const b = this.samples[i];
      const good =
        b.inVisibilityWindow &&
        b.elevationDeg >= (state?.minGoodElevationDeg ?? 10) &&
        a.inVisibilityWindow;
      ctx.strokeStyle = good ? p.good : p.elevation;
      ctx.beginPath();
      ctx.moveTo(xOf(a.utcMs), yEl(a.elevationDeg));
      ctx.lineTo(xOf(b.utcMs), yEl(b.elevationDeg));
      ctx.stroke();
    }

    // Vertical cursor.
    if (state && currentUtcMs !== null) {
      const x = xOf(currentUtcMs);
      ctx.strokeStyle = p.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      const nearest = this.samples.reduce((best, sample) =>
        Math.abs(sample.utcMs - currentUtcMs) < Math.abs(best.utcMs - currentUtcMs)
          ? sample
          : best,
      );
      ctx.fillStyle = p.cursor;
      ctx.beginPath();
      ctx.arc(x, yEl(nearest.elevationDeg), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // X labels every 6 h, in local time.
    if (state) {
      ctx.fillStyle = p.muted;
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const step = 6 * 3_600_000;
      const first = Math.ceil(this.windowStart / step) * step;
      for (let ms = first; ms <= this.windowEnd; ms += step) {
        const x = xOf(ms);
        ctx.beginPath();
        ctx.strokeStyle = p.grid;
        ctx.moveTo(x, pad.top + plotH);
        ctx.lineTo(x, pad.top + plotH + 3);
        ctx.stroke();
        ctx.fillText(localHhMm(ms, state.timeZone), x, pad.top + plotH + 6);
      }
    }

    ctx.fillStyle = p.muted;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('plot.axisElevation'), pad.left, 3);
    ctx.textAlign = 'right';
    ctx.fillText(t('plot.axisMagnitude'), w - 4, 3);
  }
}
