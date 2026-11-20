/**
 * Offline base map: a locally rendered hillshade from cached DEM tiles plus
 * OSM building footprints. This is deliberately not a cached copy of
 * tile.openstreetmap.org; that service forbids bulk/offline downloading.
 */

import type { BuildingFeature, TerrainGrid } from './types';

export interface OfflineBaseMapResult {
  dataUrl: string;
  width: number;
  height: number;
  buildingCount: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Render at up to 1024 px on the long edge. A 15 km z14 grid becomes a
 * legible local hillshade without allocating a 2300×2300 canvas on a phone.
 */
export function renderOfflineBaseMap(
  grid: TerrainGrid,
  buildings: BuildingFeature[],
  nightMode: boolean,
): OfflineBaseMapResult | null {
  if (typeof document === 'undefined') return null;
  const { south, west, north, east } = grid.bbox;
  const latSpan = north - south;
  const lonSpan = east - west;
  if (!(latSpan > 0) || !(lonSpan > 0)) return null;
  const latRad = ((south + north) / 2) * (Math.PI / 180);
  const aspect = (latSpan * 111_320) / (lonSpan * 111_320 * Math.cos(latRad));
  const width = 1024;
  const height = clamp(Math.round(width * aspect), 256, 1024);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const sample = (col: number, row: number): number => {
    const c = clamp(Math.round(col), 0, grid.width - 1);
    const r = clamp(Math.round(row), 0, grid.height - 1);
    const value = grid.elevations[r * grid.width + c];
    return Number.isFinite(value) ? value : grid.observerGroundElevationM;
  };
  const spacingEast = Math.max(1, grid.spacingEastM);
  const spacingNorth = Math.max(1, grid.spacingNorthM);

  for (let y = 0; y < height; y++) {
    const row = (y / (height - 1)) * (grid.height - 1);
    for (let x = 0; x < width; x++) {
      const col = (x / (width - 1)) * (grid.width - 1);
      const h = sample(col, row);
      const hE = sample(col + 1, row);
      const hW = sample(col - 1, row);
      const hN = sample(col, row - 1);
      const hS = sample(col, row + 1);
      const dzdx = (hE - hW) / (2 * spacingEast);
      const dzdy = (hN - hS) / (2 * spacingNorth);
      // Surface normal (-dz/dx, -dz/dy, 1), lit from the north-west.
      const nx = -dzdx;
      const ny = -dzdy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const lightX = -0.55;
      const lightY = 0.55;
      const lightZ = 0.63;
      const shade = clamp(
        Math.abs((nx * lightX + ny * lightY + nz * lightZ) / length),
        0,
        1,
      );
      const relief = clamp((h - grid.observerGroundElevationM) / 600, -0.35, 0.35);
      const index = (y * width + x) * 4;
      if (nightMode) {
        data[index] = Math.round(30 + shade * 92 + relief * 40);
        data[index + 1] = Math.round(4 + shade * 12);
        data[index + 2] = Math.round(3 + shade * 9);
      } else {
        data[index] = Math.round(26 + shade * 58 + relief * 28);
        data[index + 1] = Math.round(43 + shade * 76 + relief * 34);
        data[index + 2] = Math.round(39 + shade * 66 + relief * 24);
      }
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Building footprints are the only vector features in the offline base.
  ctx.lineJoin = 'round';
  for (const building of buildings) {
    if (building.ring.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < building.ring.length; i++) {
      const point = building.ring[i];
      const x = ((point.lon - west) / lonSpan) * width;
      const y = ((north - point.lat) / latSpan) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = nightMode ? 'rgba(255,59,48,0.48)' : 'rgba(255,179,71,0.5)';
    ctx.strokeStyle = nightMode ? 'rgba(255,138,122,0.8)' : 'rgba(255,224,160,0.85)';
    ctx.lineWidth = 0.7;
    ctx.fill();
    ctx.stroke();
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    buildingCount: buildings.length,
  };
}
