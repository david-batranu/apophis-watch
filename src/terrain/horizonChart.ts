/**
 * Canvas horizon chart: obstruction skyline, Apophis path and current marker.
 * Drawn at device-pixel resolution but sized in CSS pixels.
 */

import { horizonElevationAtAzimuth } from './horizon';
import { compass8, normalizeAzimuth } from './geo';
import type { ApophisPathInfo, HorizonProfile } from './types';

export interface HorizonChartState {
  profile: HorizonProfile | null;
  path: ApophisPathInfo | null;
  utcMs: number | null;
  marginDeg: number;
  nightMode: boolean;
}

function cssSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.round(rect.width || canvas.clientWidth || 600));
  const height = Math.max(150, Math.round(rect.height || canvas.clientHeight || 220));
  return { width, height };
}

export function drawHorizonChart(
  canvas: HTMLCanvasElement,
  state: HorizonChartState,
): void {
  const { width, height } = cssSize(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const night = state.nightMode;
  const bg = night ? '#080000' : '#0b1322';
  const text = night ? '#ff8a7a' : '#9fb1c9';
  const grid = night ? '#3a0b07' : '#1d2b40';
  const horizonColour = night ? '#ff5a45' : '#8fc9a8';
  const horizonFill = night ? 'rgba(120,18,10,0.55)' : 'rgba(52,92,72,0.5)';
  const pathColour = night ? '#ffb0a0' : '#8fd0ff';
  const blockedColour = night ? '#ff3b30' : '#ff6b6b';
  const markerColour = night ? '#ffd0c8' : '#ffffff';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 44, right: 12, top: 12, bottom: 44 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const profile = state.profile;
  let minEl = -2;
  let maxEl = 12;
  if (profile) {
    for (const sample of profile.samples) {
      if (!Number.isFinite(sample.elevationDeg)) continue;
      minEl = Math.min(minEl, sample.elevationDeg);
      maxEl = Math.max(maxEl, sample.elevationDeg);
    }
  }
  if (state.path) {
    for (const sample of state.path.samples) {
      minEl = Math.min(minEl, sample.elevationDeg);
      maxEl = Math.max(maxEl, sample.elevationDeg);
    }
  }
  minEl = Math.max(-85, Math.floor(minEl - 1));
  maxEl = Math.min(90, Math.max(minEl + 8, Math.ceil(maxEl + 2)));
  const xOf = (az: number): number =>
    margin.left + (normalizeAzimuth(az) / 360) * plotW;
  const yOf = (el: number): number =>
    margin.top + plotH - ((el - minEl) / (maxEl - minEl)) * plotH;

  // Grid and labels.
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = text;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const elStep = maxEl - minEl > 40 ? 10 : maxEl - minEl > 18 ? 5 : 2;
  for (let el = Math.ceil(minEl / elStep) * elStep; el <= maxEl; el += elStep) {
    const y = yOf(el);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillText(`${el}°`, margin.left - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let az = 0; az < 360; az += 45) {
    const x = xOf(az);
    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
    ctx.stroke();
    ctx.fillText(`${az}° ${compass8(az)}`, x, margin.top + plotH + 6);
  }

  if (!profile) {
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Load a DEM to compute the local horizon.', width / 2, height / 2);
    return;
  }

  // Terrain/building silhouette, filled to the bottom of the plot.
  ctx.beginPath();
  ctx.moveTo(xOf(profile.samples[0].azimuthDeg), margin.top + plotH);
  for (const sample of profile.samples) {
    ctx.lineTo(xOf(sample.azimuthDeg), yOf(sample.elevationDeg));
  }
  ctx.lineTo(xOf(profile.samples[profile.samples.length - 1].azimuthDeg), margin.top + plotH);
  ctx.closePath();
  ctx.fillStyle = horizonFill;
  ctx.fill();
  ctx.beginPath();
  profile.samples.forEach((sample, index) => {
    const x = xOf(sample.azimuthDeg);
    const y = yOf(sample.elevationDeg);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = horizonColour;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Margin line above the obstruction.
  if (state.marginDeg > 0) {
    ctx.beginPath();
    profile.samples.forEach((sample, index) => {
      const x = xOf(sample.azimuthDeg);
      const y = yOf(sample.elevationDeg + state.marginDeg);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = night ? 'rgba(255,80,60,0.45)' : 'rgba(255,179,71,0.55)';
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (state.path && state.path.samples.length > 1) {
    // Draw visible and blocked segments separately so the obstruction is
    // obvious even without reading the table.
    for (let i = 1; i < state.path.samples.length; i++) {
      const a = state.path.samples[i - 1];
      const b = state.path.samples[i];
      const horizonA = horizonElevationAtAzimuth(profile, a.azimuthDeg) ?? -90;
      const horizonB = horizonElevationAtAzimuth(profile, b.azimuthDeg) ?? -90;
      const clear =
        a.elevationDeg >= horizonA + state.marginDeg &&
        b.elevationDeg >= horizonB + state.marginDeg;
      ctx.beginPath();
      ctx.moveTo(xOf(a.azimuthDeg), yOf(a.elevationDeg));
      ctx.lineTo(xOf(b.azimuthDeg), yOf(b.elevationDeg));
      ctx.strokeStyle = clear ? pathColour : blockedColour;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    if (state.utcMs !== null) {
      const firstMs = state.path.samples[0].utcMs;
      const lastMs = state.path.samples[state.path.samples.length - 1].utcMs;
      if (state.utcMs >= firstMs - 60_000 && state.utcMs <= lastMs + 60_000) {
        const sample = state.path.samples.reduce(
          (best, current) =>
            Math.abs(current.utcMs - state.utcMs!) <
            Math.abs(best.utcMs - state.utcMs!)
              ? current
              : best,
          state.path.samples[0],
        );
        ctx.beginPath();
        ctx.arc(xOf(sample.azimuthDeg), yOf(sample.elevationDeg), 4, 0, Math.PI * 2);
        ctx.fillStyle = markerColour;
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // Legend.
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = horizonColour;
  ctx.fillRect(margin.left, height - 11, 12, 3);
  ctx.fillStyle = text;
  ctx.fillText('horizon: terrain + buildings', margin.left + 16, height - 8);
  ctx.fillStyle = pathColour;
  ctx.fillRect(margin.left + 190, height - 11, 12, 3);
  ctx.fillStyle = text;
  ctx.fillText('Apophis path (red = below horizon/margin)', margin.left + 206, height - 8);
}
