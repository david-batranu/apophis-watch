/**
 * Geometry builders for the Three.js local view. These functions are pure and
 * return typed arrays; the scene class owns disposal and materials.
 *
 * World axes: +x east, +y up, +z south (so north is -z). One unit is one
 * metre. Earth curvature is applied as a downward y offset.
 */

import { triangulatePolygon } from './geo';
import type { PreparedBuilding, TerrainGrid } from './types';

export interface TerrainMeshData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  stride: number;
}

export interface BuildingMeshData {
  positions: Float32Array;
  colors: Float32Array;
  vertexCount: number;
}

export interface MeshOptions {
  /** Maximum vertices along either axis; larger grids are sampled with a stride. */
  maxDimension?: number;
  observerGroundElevationM?: number;
  curvature?: boolean;
}

function curvatureDrop(distanceM: number): number {
  return (distanceM * distanceM) / (2 * 6_371_008.8);
}

/**
 * Terrain mesh with elevation shading. Buildings are separate so they can be
 * recoloured by height provenance.
 */
export function buildTerrainMesh(
  grid: TerrainGrid,
  options: MeshOptions = {},
): TerrainMeshData {
  const maxDimension = Math.max(32, options.maxDimension ?? 512);
  const stride = Math.max(
    1,
    Math.ceil(Math.max(grid.width, grid.height) / maxDimension),
  );
  const cols = Math.floor((grid.width - 1) / stride) + 1;
  const rows = Math.floor((grid.height - 1) / stride) + 1;
  const rawReference =
    options.observerGroundElevationM ?? grid.observerGroundElevationM;
  const reference = Number.isFinite(rawReference) ? rawReference : 0;
  const curvature = options.curvature !== false;

  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < rows; j++) {
    const row = j * stride;
    for (let i = 0; i < cols; i++) {
      const h = grid.elevations[row * grid.width + i * stride];
      if (!Number.isFinite(h)) continue;
      if (h < minElevation) minElevation = h;
      if (h > maxElevation) maxElevation = h;
    }
  }
  if (!Number.isFinite(minElevation)) {
    minElevation = 0;
    maxElevation = 1;
  }
  const range = Math.max(1, maxElevation - minElevation);

  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const valid = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const row = j * stride;
    for (let i = 0; i < cols; i++) {
      const col = i * stride;
      const index = j * cols + i;
      const east = grid.eastOriginM + col * grid.spacingEastM;
      const north = grid.northOriginM - row * grid.spacingNorthM;
      const elevation = grid.elevations[row * grid.width + col];
      const finite = Number.isFinite(elevation);
      valid[index] = finite ? 1 : 0;
      const height = finite ? elevation : reference;
      const drop = curvature ? curvatureDrop(Math.hypot(east, north)) : 0;
      positions[index * 3] = east;
      positions[index * 3 + 1] = height - reference - drop;
      positions[index * 3 + 2] = -north;
      const shade = finite
        ? 0.32 + (0.5 * (height - minElevation)) / range
        : 0.18;
      colors[index * 3] = shade;
      colors[index * 3 + 1] = shade;
      colors[index * 3 + 2] = shade;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (!valid[a] || !valid[b] || !valid[c] || !valid[d]) continue;
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions,
    colors,
    indices: new Uint32Array(indices),
    vertexCount: cols * rows,
    stride,
  };
}

/** Extruded building footprints with a distinct colour for default heights. */
export function buildBuildingMesh(
  buildings: PreparedBuilding[],
  grid: TerrainGrid,
  options: MeshOptions = {},
): BuildingMeshData {
  const rawReference =
    options.observerGroundElevationM ?? grid.observerGroundElevationM;
  const reference = Number.isFinite(rawReference) ? rawReference : 0;
  const curvature = options.curvature !== false;
  const positions: number[] = [];
  const colors: number[] = [];

  for (const building of buildings) {
    const ring = building.ringEnu;
    if (ring.length < 3) continue;
    let centroidEast = 0;
    let centroidNorth = 0;
    for (const point of ring) {
      centroidEast += point.eastM;
      centroidNorth += point.northM;
    }
    centroidEast /= ring.length;
    centroidNorth /= ring.length;
    const drop = curvature
      ? curvatureDrop(Math.hypot(centroidEast, centroidNorth))
      : 0;
    const baseY = building.baseElevationM - reference - drop - 0.5;
    const roofY =
      building.baseElevationM + building.heightM - reference - drop;
    const isDefault = building.heightSource === 'default';
    const r = isDefault ? 0.78 : 0.52;
    const g = isDefault ? 0.52 : 0.62;
    const b = isDefault ? 0.16 : 0.76;

    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % ring.length];
      const x1 = p1.eastM;
      const z1 = -p1.northM;
      const x2 = p2.eastM;
      const z2 = -p2.northM;
      // Wall quad, two triangles. DoubleSide material makes winding harmless.
      positions.push(
        x1, baseY, z1,
        x2, baseY, z2,
        x2, roofY, z2,
        x1, baseY, z1,
        x2, roofY, z2,
        x1, roofY, z1,
      );
      for (let k = 0; k < 6; k++) colors.push(r, g, b);
    }

    const triangles = triangulatePolygon(ring);
    for (let i = 0; i < triangles.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const point = ring[triangles[i + k]];
        positions.push(point.eastM, roofY, -point.northM);
        colors.push(r * 1.15, g * 1.15, b * 1.15);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    vertexCount: positions.length / 3,
  };
}
