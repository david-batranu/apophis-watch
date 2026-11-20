/**
 * Pure DEM sampling helpers.
 *
 * Kept separate from terrainGrid.ts so the best-spot worker can sample a grid
 * without importing the i18n catalogue used by the tile-loading progress UI.
 */

import type { TerrainGrid } from './types';

export function bilinearNaNAware(
  values: Float32Array,
  width: number,
  height: number,
  col: number,
  row: number,
): number | null {
  const epsilon = 1e-6;
  if (
    !(col >= -epsilon && col <= width - 1 + epsilon && row >= -epsilon && row <= height - 1 + epsilon)
  ) {
    return null;
  }
  col = Math.min(width - 1, Math.max(0, col));
  row = Math.min(height - 1, Math.max(0, row));
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(width - 1, c0 + 1);
  const r1 = Math.min(height - 1, r0 + 1);
  const fx = col - c0;
  const fy = row - r0;
  const a = values[r0 * width + c0];
  const b = values[r0 * width + c1];
  const c = values[r1 * width + c0];
  const d = values[r1 * width + c1];
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !Number.isFinite(c) ||
    !Number.isFinite(d)
  ) {
    return null;
  }
  return (
    a * (1 - fx) * (1 - fy) +
    b * fx * (1 - fy) +
    c * (1 - fx) * fy +
    d * fx * fy
  );
}

/** Bilinear DEM sample at local east/north metres relative to the observer. */
export function sampleGridEnu(
  grid: TerrainGrid,
  eastM: number,
  northM: number,
): number | null {
  const col = (eastM - grid.eastOriginM) / grid.spacingEastM;
  const row = (grid.northOriginM - northM) / grid.spacingNorthM;
  return bilinearNaNAware(grid.elevations, grid.width, grid.height, col, row);
}
