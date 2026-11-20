/**
 * DEM tile loading, stitching and local east/north sampling.
 *
 * A terrain grid is a tile-aligned Web Mercator image with a local ENU mapping
 * anchored at the observer. Elevations remain metres above sea level; the
 * curvature drop is applied only when building geometry or horizon angles.
 */

import { t } from '../i18n';
import {
  getCachedTile,
  putCachedTile,
  TILE_TTL_MS,
} from './cache';
import { latLonToEnu, pointInPolygon } from './geo';
import {
  MAX_TERRAIN_ZOOM,
  chooseTerrainZoom,
  lonLatToWorldPixel,
  pixelSpacingM,
  tileBounds,
  worldPixelToLonLat,
  TILE_SIZE,
  type ZoomChoice,
} from './mercator';
import {
  decodeTerrariumPng,
  terrariumTileUrl,
  TERRARIUM_TILE_SIZE,
} from './terrarium';
import type {
  BuildingFeature,
  EnuPoint,
  PreparedBuilding,
  TerrainGrid,
} from './types';

export type TerrainLoadPhase =
  | 'planning'
  | 'tiles'
  | 'stitching'
  | 'done';

export interface TerrainLoadProgress {
  phase: TerrainLoadPhase;
  loaded: number;
  total: number;
  cached: number;
  network: number;
  failed: number;
  message: string;
}

export interface LoadTerrainOptions {
  latitudeDeg: number;
  longitudeDeg: number;
  radiusM: number;
  maxTiles?: number;
  maxZoom?: number;
  concurrency?: number;
  useCache?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: TerrainLoadProgress) => void;
}

function abortError(): Error {
  // Internal abort payload; the UI discards aborted loads instead of showing it.
  const error = new Error('Terrain load cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

interface TileCoord {
  x: number;
  y: number;
}

/**
 * Fetch and stitch AWS Terrarium tiles. Individual tile failures do not
 * reject the whole load; the result reports `failedTiles` and leaves NaNs.
 */
export async function loadTerrainGrid(
  options: LoadTerrainOptions,
): Promise<TerrainGrid> {
  const {
    latitudeDeg,
    longitudeDeg,
    radiusM,
    maxTiles = 64,
    maxZoom = MAX_TERRAIN_ZOOM,
    concurrency = 6,
    useCache = true,
    signal,
    onProgress,
  } = options;
  const zoomChoice: ZoomChoice = chooseTerrainZoom(
    latitudeDeg,
    longitudeDeg,
    radiusM,
    maxTiles,
    8,
    maxZoom,
  );
  const { xMin, xMax, yMin, yMax } = zoomChoice.tileRange;
  const tiles: TileCoord[] = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) tiles.push({ x, y });
  }
  const total = tiles.length;
  let loaded = 0;
  let cached = 0;
  let network = 0;
  let failed = 0;

  const report = (message: string): void => {
    onProgress?.({
      phase: 'tiles',
      loaded,
      total,
      cached,
      network,
      failed,
      message,
    });
  };
  report(
    t('terrain.gridProgressLoading', {
      count: total,
      zoom: zoomChoice.zoom,
    }),
  );

  const bytes = new Map<string, Float32Array>();
  let cursor = 0;

  const loadOne = async (tile: TileCoord): Promise<void> => {
    throwIfAborted(signal);
    const key = `${tile.x}/${tile.y}`;
    if (useCache) {
      const hit = await getCachedTile(zoomChoice.zoom, tile.x, tile.y, TILE_TTL_MS);
      if (hit) {
        bytes.set(key, hit.elevations);
        cached++;
        loaded++;
        report(
          t('terrain.gridProgressTiles', {
            loaded,
            total,
            cached,
          }),
        );
        return;
      }
    }
    try {
      const response = await fetch(terrariumTileUrl(zoomChoice.zoom, tile.x, tile.y), {
        signal,
        mode: 'cors',
        credentials: 'omit',
        cache: 'default',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`); // technical provider payload
      }
      const blob = await response.blob();
      const elevations = await decodeTerrariumPng(blob);
      if (elevations.length !== TERRARIUM_TILE_SIZE * TERRARIUM_TILE_SIZE) {
        throw new Error(`unexpected tile size ${elevations.length}`); // technical payload
      }
      bytes.set(key, elevations);
      network++;
      void putCachedTile(zoomChoice.zoom, tile.x, tile.y, elevations);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      failed++;
      console.warn(
        `Terrarium tile z${zoomChoice.zoom}/${tile.x}/${tile.y} failed:`,
        error,
      );
    } finally {
      if (!signal?.aborted) {
        loaded++;
        report(
          t('terrain.gridProgressTiles', {
            loaded,
            total,
            cached,
          }),
        );
      }
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, tiles.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      throwIfAborted(signal);
      const index = cursor++;
      if (index >= tiles.length) return;
      await loadOne(tiles[index]);
    }
  });
  await Promise.all(workers);
  throwIfAborted(signal);

  onProgress?.({
    phase: 'stitching',
    loaded,
    total,
    cached,
    network,
    failed,
    message: t('terrain.gridProgressStitching', { count: total }),
  });

  const width = (xMax - xMin + 1) * TILE_SIZE;
  const height = (yMax - yMin + 1) * TILE_SIZE;
  const elevations = new Float32Array(width * height);
  elevations.fill(Number.NaN);
  for (let ty = yMin; ty <= yMax; ty++) {
    for (let tx = xMin; tx <= xMax; tx++) {
      const tile = bytes.get(`${tx}/${ty}`);
      if (!tile) continue;
      const destX = (tx - xMin) * TILE_SIZE;
      const destY = (ty - yMin) * TILE_SIZE;
      for (let row = 0; row < TILE_SIZE; row++) {
        const src = row * TILE_SIZE;
        const dest = (destY + row) * width + destX;
        elevations.set(tile.subarray(src, src + TILE_SIZE), dest);
      }
    }
  }

  const spacing = pixelSpacingM(latitudeDeg, zoomChoice.zoom);
  const corner = worldPixelToLonLat(
    xMin * TILE_SIZE + 0.5,
    yMin * TILE_SIZE + 0.5,
    zoomChoice.zoom,
  );
  const cornerEnu = latLonToEnu(
    corner.latitudeDeg,
    corner.longitudeDeg,
    latitudeDeg,
    longitudeDeg,
  );

  const nwBounds = tileBounds(xMin, yMin, zoomChoice.zoom);
  const seBounds = tileBounds(xMax, yMax, zoomChoice.zoom);

  const observerSample = sampleStitchedLatLon(
    elevations,
    width,
    height,
    zoomChoice.zoom,
    xMin,
    yMin,
    latitudeDeg,
    longitudeDeg,
  );

  const grid: TerrainGrid = {
    zoom: zoomChoice.zoom,
    width,
    height,
    elevations,
    spacingM: (spacing.eastM + spacing.northM) / 2,
    spacingEastM: spacing.eastM,
    spacingNorthM: spacing.northM,
    eastOriginM: cornerEnu.eastM,
    northOriginM: cornerEnu.northM,
    originLatDeg: latitudeDeg,
    originLonDeg: longitudeDeg,
    observerGroundElevationM: observerSample ?? Number.NaN,
    tileRange: { xMin, xMax, yMin, yMax },
    bbox: {
      south: seBounds.south,
      west: nwBounds.west,
      north: nwBounds.north,
      east: seBounds.east,
    },
    requestedTiles: total,
    cachedTiles: cached,
    networkTiles: network,
    failedTiles: failed,
    createdAt: Date.now(),
  };

  onProgress?.({
    phase: 'done',
    loaded,
    total,
    cached,
    network,
    failed,
    message: t('terrain.gridProgressReady', {
      zoom: grid.zoom,
      spacing: grid.spacingM.toFixed(1),
    }),
  });

  return grid;
}

function bilinearNaNAware(
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
  const weights = [
    values[r0 * width + c0],
    values[r0 * width + c1],
    values[r1 * width + c0],
    values[r1 * width + c1],
  ];
  const w = [
    (1 - fx) * (1 - fy),
    fx * (1 - fy),
    (1 - fx) * fy,
    fx * fy,
  ];
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < 4; i++) {
    if (Number.isFinite(weights[i])) {
      sum += weights[i] * w[i];
      weightSum += w[i];
    }
  }
  if (weightSum <= 1e-12) return null;
  return sum / weightSum;
}

function sampleStitchedLatLon(
  elevations: Float32Array,
  width: number,
  height: number,
  zoom: number,
  xMin: number,
  yMin: number,
  latitudeDeg: number,
  longitudeDeg: number,
): number | null {
  const world = lonLatToWorldPixel(latitudeDeg, longitudeDeg, zoom);
  const col = world.x - xMin * TILE_SIZE - 0.5;
  const row = world.y - yMin * TILE_SIZE - 0.5;
  return bilinearNaNAware(elevations, width, height, col, row);
}

/** Bilinear DEM sample at a geodetic point. */
export function sampleGridLatLon(
  grid: TerrainGrid,
  latitudeDeg: number,
  longitudeDeg: number,
): number | null {
  const sample = sampleStitchedLatLon(
    grid.elevations,
    grid.width,
    grid.height,
    grid.zoom,
    grid.tileRange.xMin,
    grid.tileRange.yMin,
    latitudeDeg,
    longitudeDeg,
  );
  // Allow a sample just outside the tile-aligned rectangle to be clamped by
  // the bilinear helper, but reject points far outside (see bounds check).
  if (sample === null) return null;
  return sample;
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

/**
 * Ground elevation at the local origin used to anchor the 3D scene.
 *
 * `observerGroundElevationM` is sampled through the Mercator pixel mapping
 * (best for the astronomy ground elevation). The local mesh, however, uses
 * the constant-spacing ENU grid; at (0,0) that sample can differ by ~0.9 m
 * (Cape Town: 14.49 m vs 15.41 m). Anchoring the camera to the ENU sample
 * keeps the eye height above the actual mesh.
 */
export function sceneGroundElevationM(grid: TerrainGrid): number {
  const sampled = sampleGridEnu(grid, 0, 0);
  if (sampled !== null && Number.isFinite(sampled)) return sampled;
  return Number.isFinite(grid.observerGroundElevationM)
    ? grid.observerGroundElevationM
    : 0;
}

/** Geodetic lat/lon of a grid cell centre. */
export function gridCellLatLon(
  grid: TerrainGrid,
  col: number,
  row: number,
): { latitudeDeg: number; longitudeDeg: number } {
  return worldPixelToLonLat(
    grid.tileRange.xMin * TILE_SIZE + col + 0.5,
    grid.tileRange.yMin * TILE_SIZE + row + 0.5,
    grid.zoom,
  );
}

/** ENU coordinate of a grid cell centre. */
export function gridCellEnu(
  grid: TerrainGrid,
  col: number,
  row: number,
): EnuPoint {
  return {
    eastM: grid.eastOriginM + col * grid.spacingEastM,
    northM: grid.northOriginM - row * grid.spacingNorthM,
  };
}

export interface EnuBounds {
  eastMinM: number;
  eastMaxM: number;
  northMinM: number;
  northMaxM: number;
}

export function terrainGridEnuBounds(grid: TerrainGrid): EnuBounds {
  return {
    eastMinM: grid.eastOriginM,
    eastMaxM: grid.eastOriginM + (grid.width - 1) * grid.spacingEastM,
    northMinM: grid.northOriginM - (grid.height - 1) * grid.spacingNorthM,
    northMaxM: grid.northOriginM,
  };
}

/** True if a local ENU point lies inside the grid rectangle. */
export function gridContainsEnu(
  grid: TerrainGrid,
  eastM: number,
  northM: number,
): boolean {
  const b = terrainGridEnuBounds(grid);
  return (
    eastM >= b.eastMinM &&
    eastM <= b.eastMaxM &&
    northM >= b.northMinM &&
    northM <= b.northMaxM
  );
}

/**
 * Project parsed Overpass footprints into the grid's ENU frame and attach a
 * conservative base elevation (highest terrain under the footprint).
 */
export function prepareBuildings(
  grid: TerrainGrid,
  features: BuildingFeature[],
): PreparedBuilding[] {
  const prepared: PreparedBuilding[] = [];
  for (const feature of features) {
    if (feature.ring.length < 3) continue;
    const ringEnu = feature.ring.map((point) =>
      latLonToEnu(
        point.lat,
        point.lon,
        grid.originLatDeg,
        grid.originLonDeg,
      ),
    );
    let minEastM = Infinity;
    let maxEastM = -Infinity;
    let minNorthM = Infinity;
    let maxNorthM = -Infinity;
    let baseElevationM = -Infinity;
    for (let i = 0; i < ringEnu.length; i++) {
      const p = ringEnu[i];
      minEastM = Math.min(minEastM, p.eastM);
      maxEastM = Math.max(maxEastM, p.eastM);
      minNorthM = Math.min(minNorthM, p.northM);
      maxNorthM = Math.max(maxNorthM, p.northM);
      const ground = sampleGridLatLon(
        grid,
        feature.ring[i].lat,
        feature.ring[i].lon,
      );
      if (ground !== null && Number.isFinite(ground)) {
        baseElevationM = Math.max(baseElevationM, ground);
      }
    }
    if (!Number.isFinite(baseElevationM)) {
      const centroid = centroidOf(feature.ring);
      const ground = sampleGridLatLon(grid, centroid.lat, centroid.lon);
      if (ground !== null && Number.isFinite(ground)) baseElevationM = ground;
    }
    if (!Number.isFinite(baseElevationM)) {
      if (Number.isFinite(grid.observerGroundElevationM)) {
        baseElevationM = grid.observerGroundElevationM;
      } else {
        continue;
      }
    }
    prepared.push({
      id: feature.id,
      ringEnu,
      minEastM,
      maxEastM,
      minNorthM,
      maxNorthM,
      baseElevationM,
      heightM: feature.heightM,
      heightSource: feature.heightSource,
      tags: feature.tags,
    });
  }
  return prepared;
}

export function centroidOf(
  ring: Array<{ lat: number; lon: number }>,
): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const point of ring) {
    lat += point.lat;
    lon += point.lon;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

/** First building whose footprint contains the local ENU point. */
export function buildingAtPoint(
  buildings: PreparedBuilding[],
  eastM: number,
  northM: number,
): PreparedBuilding | null {
  for (const building of buildings) {
    if (
      eastM < building.minEastM ||
      eastM > building.maxEastM ||
      northM < building.minNorthM ||
      northM > building.maxNorthM
    ) {
      continue;
    }
    if (pointInPolygon(eastM, northM, building.ringEnu)) return building;
  }
  return null;
}

/** Highest building at a point, used for the rooftop eye-height option. */
export function tallestBuildingAtPoint(
  buildings: PreparedBuilding[],
  eastM: number,
  northM: number,
): PreparedBuilding | null {
  let best: PreparedBuilding | null = null;
  for (const building of buildings) {
    if (
      eastM < building.minEastM ||
      eastM > building.maxEastM ||
      northM < building.minNorthM ||
      northM > building.maxNorthM
    ) {
      continue;
    }
    if (!pointInPolygon(eastM, northM, building.ringEnu)) continue;
    if (!best || building.heightM > best.heightM) best = building;
  }
  return best;
}
