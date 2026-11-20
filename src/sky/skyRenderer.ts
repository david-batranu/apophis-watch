import { jdTdbFromDate } from '../core/time';
import { RAD } from '../core/vec3';
import type { SkyPosition } from '../ephemeris/types';
import type { StarCatalogue } from './catalog';
import type { BodyPosition } from './bodies';
import { localDateHhMm, localHhMm } from '../ui/timeFormat';
import { SkyProjection } from './projection';
import { enuBasisInEqj, eqjVectorToHorizontal, raDecToEqj } from './skyFrame';
import type { SimulationSession, TrailSample } from '../state/session';
import type { UiState } from '../state/store';

interface Palette {
  bg: string;
  grid: string;
  horizon: string;
  text: string;
  muted: string;
  star: string;
  constellation: string;
  trail: string;
  good: string;
  apophis: string;
  sun: string;
  moon: string;
  planet: string;
  warning: string;
}

function palette(night: boolean): Palette {
  if (night) {
    return {
      bg: '#000000',
      grid: '#3a0808',
      horizon: '#ff4b3e',
      text: '#ff8a7a',
      muted: '#a33a30',
      star: '#ff6b5e',
      constellation: '#ff4b3e',
      trail: '#ff3b30',
      good: '#ff1a0d',
      apophis: '#ff0000',
      sun: '#ff2a1a',
      moon: '#ffb0a0',
      planet: '#ff5a4a',
      warning: '#ff7a00',
    };
  }
  return {
    bg: '#070b14',
    grid: '#18283d',
    horizon: '#7aa2c8',
    text: '#c9d6e8',
    muted: '#6b7d95',
    star: '#e8f0ff',
    constellation: '#8fb8e0',
    trail: '#ff5a5f',
    good: '#46d68a',
    apophis: '#ff5a5f',
    sun: '#ffd166',
    moon: '#eef2f7',
    planet: '#e8c9a0',
    warning: '#ffb347',
  };
}

export interface SkyDebugSnapshot {
  utcMs: number | null;
  azimuthDeg: number | null;
  elevationDeg: number | null;
  rangeKm: number | null;
  magnitude: number | null;
  angularDiameterArcsec: number | null;
  markerX: number | null;
  markerY: number | null;
  centerAzDeg: number;
  centerElDeg: number;
  zoom: number;
  trailTicks: number;
  trailLabels: number;
  trailLabelTimesUtc: string[];
  starCount: number;
  fovDeg: number;
  canvasWidth: number;
  canvasHeight: number;
  horizonRadiusPx: number;
}

const DEG = Math.PI / 180;

export class SkyView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly projection = new SkyProjection(800, 600);
  private readonly pointerPositions = new Map<number, { x: number; y: number }>();
  private lastPointer: { x: number; y: number } | null = null;
  private pinchDistance = 0;
  private lastInput: SkyRenderInput | null = null;
  private lastKey = '';
  private lastMarker: { x: number; y: number } | null = null;
  private lastDebug: SkyDebugSnapshot = this.emptyDebug();
  private starVectors: ReturnType<typeof raDecToEqj>[] = [];
  private starLabelPositions: { x: number; y: number }[] = [];
  private catalogueRef: StarCatalogue | null = null;
  private skyCacheKey = '';
  private starHorizontals: { azimuthDeg: number; elevationDeg: number }[] = [];
  private constellationHorizontals: {
    azimuthDeg: number;
    elevationDeg: number;
  }[][][] = [];
  private trailCacheKey = '';
  private trailCache: TrailSample[] = [];

  constructor(private readonly host: HTMLElement, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    new ResizeObserver(() => {
      this.resize();
      this.lastKey = '';
      this.render();
    }).observe(host);
    this.attachPointerHandlers();
    this.resize();
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(320, Math.round(rect.height));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.projection.setViewport(w, h);
  }

  private attachPointerHandlers(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (event) => {
      c.setPointerCapture(event.pointerId);
      this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointerPositions.size === 1) {
        this.lastPointer = { x: event.clientX, y: event.clientY };
      } else if (this.pointerPositions.size === 2) {
        this.pinchDistance = this.currentPinchDistance();
        this.lastPointer = null;
      }
    });
    c.addEventListener('pointermove', (event) => {
      if (!this.pointerPositions.has(event.pointerId)) return;
      this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointerPositions.size === 2) {
        const next = this.currentPinchDistance();
        if (this.pinchDistance > 0) this.projection.zoomBy(next / this.pinchDistance);
        this.pinchDistance = next;
        this.invalidate();
      } else if (this.lastPointer) {
        const dx = event.clientX - this.lastPointer.x;
        const dy = event.clientY - this.lastPointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) this.projection.panByPixels(dx, dy);
        this.lastPointer = { x: event.clientX, y: event.clientY };
        this.invalidate();
      }
    });
    const end = (event: PointerEvent) => {
      this.pointerPositions.delete(event.pointerId);
      this.lastPointer = null;
      this.pinchDistance = 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.projection.zoomBy(Math.exp(-event.deltaY * 0.0012));
        this.invalidate();
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => {
      this.projection.setView({ centerAzDeg: 0, centerElDeg: 90, zoom: 1 });
      this.invalidate();
    });
  }

  private currentPinchDistance(): number {
    const points = [...this.pointerPositions.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  private invalidate(): void {
    this.lastKey = '';
    this.render();
  }

  resetView(): void {
    this.projection.setView({ centerAzDeg: 0, centerElDeg: 90, zoom: 1 });
    this.invalidate();
  }

  /** Keyboard-accessible look controls; pixel deltas match a drag. */
  panByPixels(dx: number, dy: number): void {
    this.projection.panByPixels(dx, dy);
    this.invalidate();
  }

  zoomBy(factor: number): void {
    this.projection.zoomBy(factor);
    this.invalidate();
  }

  getDebugSnapshot(): SkyDebugSnapshot {
    return this.lastDebug;
  }

  render(input?: SkyRenderInput): void {
    if (input) {
      this.lastInput = input;
      if (input.catalogue !== this.catalogueRef) {
        this.catalogueRef = input.catalogue;
        this.starVectors =
          input.catalogue?.stars.map((star) => raDecToEqj(star.raDeg, star.decDeg)) ?? [];
      }
    }
    const data = input ?? this.lastInput;
    if (!data) return;
    const { state, session, sky, bodies, catalogue } = data;
    const key = [
      state.utcMs,
      state.minGoodElevationDeg,
      state.toggles.constellations,
      state.toggles.refraction,
      state.toggles.enlargedMarker,
      state.toggles.nightMode,
      state.observer?.latitudeDeg,
      state.observer?.longitudeDeg,
      catalogue?.metadata.starCount,
      this.projection.centerAzDeg.toFixed(3),
      this.projection.centerElDeg.toFixed(3),
      this.projection.zoom.toFixed(3),
      this.projection.width,
      this.projection.height,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const p = palette(state.toggles.nightMode);
    const ctx = this.ctx;
    const w = this.projection.width;
    const h = this.projection.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(p);
    if (state.toggles.constellations) this.drawConstellations(p, data);
    this.drawStars(p, data, session);
    this.drawTrail(p, data);
    this.drawBodies(p, data);
    const marker = this.drawApophis(p, data);
    this.lastMarker = marker;
    this.drawHorizon(p);
    this.drawCardinals(p);

    this.lastDebug = {
      utcMs: state.utcMs,
      azimuthDeg: sky.azimuthDeg,
      elevationDeg: sky.elevationDeg,
      rangeKm: sky.rangeKm,
      magnitude: sky.magnitude,
      angularDiameterArcsec: sky.angularDiameterArcsec,
      markerX: marker?.x ?? null,
      markerY: marker?.y ?? null,
      centerAzDeg: this.projection.centerAzDeg,
      centerElDeg: this.projection.centerElDeg,
      zoom: this.projection.zoom,
      trailTicks: this.lastTrailTicks,
      trailLabels: this.lastTrailLabels,
      trailLabelTimesUtc: this.lastTrailLabelTimes.map((ms) =>
        new Date(ms).toISOString(),
      ),
      starCount: catalogue?.metadata.starCount ?? 0,
      fovDeg: this.estimateFovDeg(),
      canvasWidth: this.projection.width,
      canvasHeight: this.projection.height,
      horizonRadiusPx: this.projection.horizonRadiusPx,
    };
  }

  private lastTrailTicks = 0;
  private lastTrailLabels = 0;
  private lastTrailLabelTimes: number[] = [];

  private drawGrid(p: Palette): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    for (const el of [30, 60]) {
      this.strokeCurve((az) => ({ az, el }), p.grid);
    }
    ctx.restore();
  }

  private drawHorizon(p: Palette): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = p.horizon;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([]);
    this.strokeCurve((az) => ({ az, el: 0 }), p.horizon, 1.6);
    ctx.restore();
  }

  private drawCardinals(p: Palette): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = p.text;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [label, az] of [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ] as const) {
      const pt = this.projection.project(az, 0);
      if (!pt.visible) continue;
      const dx = pt.x - this.projection.width / 2;
      const dy = pt.y - this.projection.height / 2;
      const n = Math.hypot(dx, dy) || 1;
      ctx.fillText(label, pt.x + (dx / n) * 14, pt.y + (dy / n) * 14);
    }
    ctx.restore();
  }

  private ensureSkyCache(data: SkyRenderInput, node: SimulationSession): void {
    if (!data.catalogue || data.state.utcMs === null) return;
    const key = [
      Math.floor(data.state.utcMs / 60_000),
      data.catalogue.metadata.starCount,
      node.observer.latitudeDeg,
      node.observer.longitudeDeg,
    ].join('|');
    if (key === this.skyCacheKey) return;
    this.skyCacheKey = key;
    const basis = enuBasisInEqj(
      node.observer,
      jdTdbFromDate(new Date(data.state.utcMs)),
    );
    this.starHorizontals = data.catalogue.stars.map((_, i) =>
      eqjVectorToHorizontal(this.starVectors[i], basis),
    );
    this.constellationHorizontals = data.catalogue.constellations.map((c) =>
      c.segments.map((segment) =>
        segment.map(([raDeg, decDeg]) =>
          eqjVectorToHorizontal(raDecToEqj(raDeg, decDeg), basis),
        ),
      ),
    );
  }

  private drawStars(p: Palette, data: SkyRenderInput, session: SimulationSession): void {
    const catalogue = data.catalogue;
    if (!catalogue || data.state.utcMs === null) return;
    this.ensureSkyCache(data, session);
    const ctx = this.ctx;
    ctx.save();
    // Batch stars into a handful of magnitude/alpha buckets: one fill per
    // bucket instead of one fill per star.
    const buckets = [
      { limit: 1.5, alpha: 1, radius: 3.2 },
      { limit: 2.5, alpha: 0.9, radius: 2.55 },
      { limit: 3.5, alpha: 0.68, radius: 1.9 },
      { limit: 4.5, alpha: 0.46, radius: 1.25 },
      { limit: 5.0, alpha: 0.28, radius: 0.75 },
    ];
    for (const bucket of buckets) {
      ctx.beginPath();
      ctx.fillStyle = p.star;
      ctx.globalAlpha = bucket.alpha;
      for (let i = 0; i < catalogue.stars.length; i++) {
        const star = catalogue.stars[i];
        if (star.mag >= bucket.limit) continue;
        const horizontal = this.starHorizontals[i];
        if (horizontal.elevationDeg < 0) continue;
        const pt = this.projection.project(
          horizontal.azimuthDeg,
          horizontal.elevationDeg,
        );
        if (!pt.visible) continue;
        const radius = Math.max(0.55, Math.min(3.2, bucket.radius - star.mag * 0.25));
        ctx.moveTo(pt.x + radius, pt.y);
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = p.text;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const placedLabels: { x: number; y: number }[] = [];
    this.starLabelPositions = [];
    for (let i = 0; i < catalogue.stars.length; i++) {
      const star = catalogue.stars[i];
      if (!star.name || star.mag >= 1.0) continue;
      const horizontal = this.starHorizontals[i];
      if (horizontal.elevationDeg < 0) continue;
      const pt = this.projection.project(horizontal.azimuthDeg, horizontal.elevationDeg);
      if (!pt.visible) continue;
      if (
        placedLabels.some(
          (label) => Math.hypot(label.x - pt.x, label.y - pt.y) < 44,
        )
      ) {
        continue;
      }
      placedLabels.push({ x: pt.x, y: pt.y });
      this.starLabelPositions.push({ x: pt.x, y: pt.y });
      ctx.fillText(star.name, pt.x + 6, pt.y);
    }
    ctx.restore();
  }

  private drawConstellations(p: Palette, data: SkyRenderInput): void {
    const catalogue = data.catalogue;
    if (!catalogue || data.state.utcMs === null) return;
    this.ensureSkyCache(data, data.session);
    const ctx = this.ctx;
    ctx.save();
    // One path for all constellations; one stroke.
    ctx.strokeStyle = p.constellation;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    for (let ci = 0; ci < catalogue.constellations.length; ci++) {
      for (const segment of this.constellationHorizontals[ci]) {
        let started = false;
        for (const horizontal of segment) {
          if (horizontal.elevationDeg < 0) {
            started = false;
            continue;
          }
          const pt = this.projection.project(
            horizontal.azimuthDeg,
            horizontal.elevationDeg,
          );
          if (!pt.visible) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBodies(p: Palette, data: SkyRenderInput): void {
    const ctx = this.ctx;
    const placedLabels: { x: number; y: number }[] = [];
    const markerPoint =
      data.sky.elevationDeg >= -0.2
        ? this.projection.project(data.sky.azimuthDeg, data.sky.elevationDeg)
        : null;
    for (const body of data.bodies) {
      if (body.elevationDeg < -1) continue;
      const pt = this.projection.project(body.azimuthDeg, body.elevationDeg);
      if (!pt.visible) continue;
      const color =
        body.body === 'Sun' ? p.sun : body.body === 'Moon' ? p.moon : p.planet;
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (body.body === 'Sun') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else if (body.body === 'Moon') {
        this.drawMoonPhase(
          pt.x,
          pt.y,
          7,
          body.phaseFraction ?? 0.5,
          body.waxing ?? true,
          color,
          p.bg,
        );
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(2, body.symbolRadiusPx), 0, Math.PI * 2);
        ctx.fill();
      }
      const label =
        body.body === 'Moon' && body.phaseFraction !== undefined
          ? `Moon ${(body.phaseFraction * 100).toFixed(0)}%`
          : body.body;
      const nearMarker =
        markerPoint?.visible &&
        Math.hypot(markerPoint.x - pt.x, markerPoint.y - pt.y) < 58;
      const nearStarLabel = this.starLabelPositions.some(
        (placed) => Math.hypot(placed.x - pt.x, placed.y - pt.y) < 38,
      );
      if (
        !nearMarker &&
        !nearStarLabel &&
        !placedLabels.some(
          (placed) => Math.hypot(placed.x - pt.x, placed.y - pt.y) < 34,
        )
      ) {
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width;
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = p.bg;
        ctx.beginPath();
        ctx.roundRect(pt.x + 10, pt.y - 8, tw + 6, 16, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(label, pt.x + 13, pt.y);
        placedLabels.push({ x: pt.x, y: pt.y });
      }
      ctx.restore();
    }
  }

  private drawMoonPhase(
    x: number,
    y: number,
    radius: number,
    fraction: number,
    waxing: boolean,
    light: string,
    dark: string,
  ): void {
    const ctx = this.ctx;
    const f = Math.max(0, Math.min(1, fraction));
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.beginPath();
    const rx = radius * Math.abs(Math.cos(Math.PI * f));
    if (waxing) {
      ctx.arc(x, y, radius, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(x, y, rx, radius, 0, Math.PI / 2, -Math.PI / 2, f < 0.5);
    } else {
      ctx.arc(x, y, radius, Math.PI / 2, (3 * Math.PI) / 2, false);
      ctx.ellipse(
        x,
        y,
        rx,
        radius,
        0,
        -Math.PI / 2,
        Math.PI / 2,
        f < 0.5,
      );
    }
    ctx.closePath();
    ctx.fillStyle = light;
    ctx.fill();
    ctx.restore();
  }

  private ensureTrail(data: SkyRenderInput): TrailSample[] {
    if (data.state.utcMs === null) return [];
    const key = [
      Math.floor(data.state.utcMs / 60_000),
      data.state.toggles.refraction,
      data.session.observer.latitudeDeg,
      data.session.observer.longitudeDeg,
    ].join('|');
    if (key !== this.trailCacheKey) {
      this.trailCacheKey = key;
      this.trailCache = data.session.trail(
        data.state.utcMs,
        3,
        data.state.toggles.refraction,
      );
    }
    return this.trailCache;
  }

  private drawTrail(p: Palette, data: SkyRenderInput): void {
    if (data.state.utcMs === null) return;
    const samples = this.ensureTrail(data);
    const ctx = this.ctx;
    const minGood = data.state.minGoodElevationDeg;
    const markerPoint =
      data.sky.elevationDeg >= -0.2
        ? this.projection.project(data.sky.azimuthDeg, data.sky.elevationDeg)
        : null;
    const bodyPoints = data.bodies
      .filter((body) => body.elevationDeg >= -1)
      .map((body) => this.projection.project(body.azimuthDeg, body.elevationDeg))
      .filter((pt) => pt.visible);
    ctx.save();
    let previous: {
      x: number;
      y: number;
      good: boolean;
    } | null = null;
    let currentGood: boolean | null = null;
    let pathOpen = false;
    let label: { x: number; y: number } | null = null;
    let ticks = 0;
    let labels = 0;
    const labelTimes: number[] = [];
    const fiveMinuteTicks: { x: number; y: number; good: boolean }[] = [];

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (sample.elevationDeg < 0) {
        if (pathOpen) {
          ctx.stroke();
          pathOpen = false;
        }
        previous = null;
        currentGood = null;
        continue;
      }
      const pt = this.projection.project(sample.azimuthDeg, sample.elevationDeg);
      if (!pt.visible) {
        if (pathOpen) {
          ctx.stroke();
          pathOpen = false;
        }
        previous = null;
        currentGood = null;
        continue;
      }
      const good = sample.inVisibilityWindow && sample.elevationDeg >= minGood;
      if (previous) {
        if (good !== currentGood) {
          if (pathOpen) ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = good ? p.good : p.trail;
          ctx.lineWidth = good ? 2.4 : 1.4;
          currentGood = good;
          pathOpen = true;
        }
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(pt.x, pt.y);
      }
      ticks++;
      if (i % 5 === 0) {
        fiveMinuteTicks.push({ x: pt.x, y: pt.y, good });
        const nearMarker =
          markerPoint?.visible &&
          Math.hypot(pt.x - markerPoint.x, pt.y - markerPoint.y) < 55;
        const nearBody = bodyPoints.some(
          (bodyPt) => Math.hypot(bodyPt.x - pt.x, bodyPt.y - pt.y) < 46,
        );
        if (
          !nearMarker &&
          !nearBody &&
          (!label || Math.hypot(pt.x - label.x, pt.y - label.y) > 52)
        ) {
          const ms = sample.utcMs;
          const short = localHhMm(ms, data.state.timeZone);
          const text = short === '00:00' ? localDateHhMm(ms, data.state.timeZone) : short;
          ctx.save();
          ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(text).width;
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = p.bg;
          ctx.beginPath();
          ctx.roundRect(pt.x + 2, pt.y - 20, tw + 6, 14, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = good ? p.good : p.text;
          ctx.fillText(text, pt.x + 5, pt.y - 6);
          ctx.restore();
          label = { x: pt.x, y: pt.y };
          labels++;
          labelTimes.push(ms);
        }
      } else {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = p.muted;
        ctx.fillRect(pt.x, pt.y, 1.1, 1.1);
      }
      previous = { x: pt.x, y: pt.y, good };
    }
    if (pathOpen) ctx.stroke();
    ctx.globalAlpha = 1;
    for (const tick of fiveMinuteTicks) {
      ctx.fillStyle = tick.good ? p.good : p.text;
      ctx.beginPath();
      ctx.arc(tick.x, tick.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.lastTrailTicks = ticks;
    this.lastTrailLabels = labels;
    this.lastTrailLabelTimes = labelTimes;
    ctx.restore();
  }

  private drawApophis(p: Palette, data: SkyRenderInput): { x: number; y: number } | null {
    const sky = data.sky;
    if (sky.elevationDeg < -0.2) return null;
    const pt = this.projection.project(sky.azimuthDeg, sky.elevationDeg);
    if (!pt.visible) return null;
    const ctx = this.ctx;
    ctx.save();
    // True-scale: a point-like source, sized by apparent magnitude, never by
    // the 2-arcsecond physical disc (which is far below one pixel).
    const glow = Math.max(2.5, Math.min(11, 10 - sky.magnitude * 1.15));
    const gradient = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, glow);
    gradient.addColorStop(0, p.apophis);
    gradient.addColorStop(0.4, `${p.apophis}99`);
    gradient.addColorStop(1, `${p.apophis}00`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, glow, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.apophis;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.apophis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    const label = `Apophis  V≈${sky.magnitude.toFixed(1)}  ${sky.angularDiameterArcsec.toFixed(2)}″`;
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = p.bg;
    ctx.beginPath();
    ctx.roundRect(pt.x + 10, pt.y - 10, tw + 6, 17, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.text;
    ctx.fillText(label, pt.x + 13, pt.y - 1);
    if (data.state.toggles.enlargedMarker) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = p.warning;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = p.warning;
      ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('ENLARGED — NOT TO SCALE', pt.x, pt.y - 20);
      ctx.restore();
    }
    ctx.restore();
    return { x: pt.x, y: pt.y };
  }

  private strokeCurve(
    f: (azDeg: number) => { az: number; el: number },
    color: string,
    width = 1,
  ): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let started = false;
    for (let az = 0; az <= 360; az += 2) {
      const { az: a, el } = f(az);
      const pt = this.projection.project(a, el);
      if (!pt.visible || !Number.isFinite(pt.x)) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();
  }

  private estimateFovDeg(): number {
    // Approximate angular diameter across the short canvas edge.
    const r = Math.min(this.projection.width, this.projection.height) / 2;
    const theta = 2 * Math.atan(r / (2 * this.projection.scale));
    return (2 * theta * 180) / Math.PI;
  }

  private emptyDebug(): SkyDebugSnapshot {
    return {
      utcMs: null,
      azimuthDeg: null,
      elevationDeg: null,
      rangeKm: null,
      magnitude: null,
      angularDiameterArcsec: null,
      markerX: null,
      markerY: null,
      centerAzDeg: 0,
      centerElDeg: 90,
      zoom: 1,
      trailTicks: 0,
      trailLabels: 0,
      trailLabelTimesUtc: [],
      starCount: 0,
      fovDeg: 180,
      canvasWidth: 0,
      canvasHeight: 0,
      horizonRadiusPx: 0,
    };
  }
}

export interface SkyRenderInput {
  state: Readonly<UiState>;
  session: SimulationSession;
  sky: SkyPosition;
  bodies: BodyPosition[];
  catalogue: StarCatalogue | null;
}
