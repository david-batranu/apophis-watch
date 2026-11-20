/**
 * Web Mercator tile arithmetic (EPSG:3857 / OSM z/x/y scheme).
 *
 * The DEM is stored as 256×256 PNG tiles. We stitch them at a single zoom and
 * map them onto a local east/north grid; no projection library is needed.
 */

import { DEG, RAD, meridianRadiusM, primeVerticalRadiusM } from './geo';

export const TILE_SIZE = 256;
export const MAX_MERCATOR_LAT = 85.05112878;
export const MAX_TERRAIN_ZOOM = 15;
export const MIN_TERRAIN_ZOOM = 8;

/** Web Mercator metres per pixel at a latitude and zoom. */
export function groundResolutionM(latitudeDeg: number, zoom: number): number {
  return (
    (156543.03392804097 * Math.cos(latitudeDeg * DEG)) / Math.pow(2, zoom)
  );
}

/** Width of one tile on the ground at a latitude, metres. */
export function tileSizeM(latitudeDeg: number, zoom: number): number {
  return groundResolutionM(latitudeDeg, zoom) * TILE_SIZE;
}

/**
 * Actual local ground size of one Web Mercator pixel, east and north.
 * The spherical Mercator resolution and the ellipsoid's local radii differ
 * by ~0.1–0.5%; keeping the two axes separate avoids a systematic scale
 * error in long horizon rays.
 */
export function pixelSpacingM(
  latitudeDeg: number,
  zoom: number,
): { eastM: number; northM: number } {
  const world = TILE_SIZE * Math.pow(2, zoom);
  const eastM = (2 * Math.PI * primeVerticalRadiusM(latitudeDeg) *
    Math.cos(latitudeDeg * DEG)) / world;
  const y = lonLatToWorldPixel(latitudeDeg, 0, zoom).y;
  const nextLat = worldPixelToLonLat(0, y + 1, zoom).latitudeDeg;
  const northM =
    (latitudeDeg - nextLat) *
    DEG *
    meridianRadiusM((latitudeDeg + nextLat) / 2);
  return { eastM, northM };
}

/** Longitude/latitude -> continuous world pixel at a zoom. y grows south. */
export function lonLatToWorldPixel(
  latitudeDeg: number,
  longitudeDeg: number,
  zoom: number,
): { x: number; y: number } {
  const lat = Math.max(
    -MAX_MERCATOR_LAT,
    Math.min(MAX_MERCATOR_LAT, latitudeDeg),
  );
  const world = TILE_SIZE * Math.pow(2, zoom);
  const x = ((longitudeDeg + 180) / 360) * world;
  const sin = Math.sin(lat * DEG);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  return { x, y };
}

/** Continuous world pixel -> longitude/latitude. */
export function worldPixelToLonLat(
  x: number,
  y: number,
  zoom: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const world = TILE_SIZE * Math.pow(2, zoom);
  const longitudeDeg = (x / world) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / world;
  const latitudeDeg = Math.atan(Math.sinh(n)) * RAD;
  return { latitudeDeg, longitudeDeg };
}

export function lonLatToTile(
  latitudeDeg: number,
  longitudeDeg: number,
  zoom: number,
): { x: number; y: number } {
  const p = lonLatToWorldPixel(latitudeDeg, longitudeDeg, zoom);
  return {
    x: Math.floor(p.x / TILE_SIZE),
    y: Math.floor(p.y / TILE_SIZE),
  };
}

export interface GeoBbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function tileBounds(
  x: number,
  y: number,
  zoom: number,
): GeoBbox {
  const nw = worldPixelToLonLat(x * TILE_SIZE, y * TILE_SIZE, zoom);
  const se = worldPixelToLonLat(
    (x + 1) * TILE_SIZE,
    (y + 1) * TILE_SIZE,
    zoom,
  );
  return {
    south: se.latitudeDeg,
    west: nw.longitudeDeg,
    north: nw.latitudeDeg,
    east: se.longitudeDeg,
  };
}

export interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function tileRangeForBbox(bbox: GeoBbox, zoom: number): TileRange {
  const nw = lonLatToWorldPixel(bbox.north, bbox.west, zoom);
  const se = lonLatToWorldPixel(bbox.south, bbox.east, zoom);
  return {
    xMin: Math.floor(nw.x / TILE_SIZE),
    xMax: Math.floor((se.x - 1e-9) / TILE_SIZE),
    yMin: Math.floor(nw.y / TILE_SIZE),
    yMax: Math.floor((se.y - 1e-9) / TILE_SIZE),
  };
}

/**
 * Bounding box covering a radius around a point. The latitude/longitude
 * deltas use the local WGS84 radii, so this is the same projection as the
 * ENU grid.
 */
export function bboxAround(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
): GeoBbox {
  const midLat = latitudeDeg;
  const dLat = (radiusM / meridianRadiusM(midLat)) * RAD;
  const dLon =
    (radiusM /
      (primeVerticalRadiusM(midLat) * Math.cos(midLat * DEG))) *
    RAD;
  return {
    south: Math.max(-MAX_MERCATOR_LAT, latitudeDeg - dLat),
    north: Math.min(MAX_MERCATOR_LAT, latitudeDeg + dLat),
    west: longitudeDeg - dLon,
    east: longitudeDeg + dLon,
  };
}

export interface ZoomChoice {
  zoom: number;
  resolutionM: number;
  tileCount: number;
  tileRange: TileRange;
  bbox: GeoBbox;
  /** Radius actually covered by the tile-aligned grid, metres (approx). */
  coveredRadiusM: number;
}

/**
 * Pick the highest AWS Terrarium zoom whose tile-aligned bbox fits the tile
 * budget. AWS Terrarium tops out at z15.
 */
export function chooseTerrainZoom(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
  maxTiles = 64,
  minZoom = MIN_TERRAIN_ZOOM,
  maxZoom = MAX_TERRAIN_ZOOM,
): ZoomChoice {
  const bbox = bboxAround(latitudeDeg, longitudeDeg, radiusM);
  for (let zoom = maxZoom; zoom >= minZoom; zoom--) {
    const range = tileRangeForBbox(bbox, zoom);
    const count =
      (range.xMax - range.xMin + 1) * (range.yMax - range.yMin + 1);
    if (count <= maxTiles) {
      const tileW = tileSizeM(latitudeDeg, zoom);
      return {
        zoom,
        resolutionM: groundResolutionM(latitudeDeg, zoom),
        tileCount: count,
        tileRange: range,
        bbox,
        coveredRadiusM: (Math.min(
          range.xMax - range.xMin + 1,
          range.yMax - range.yMin + 1,
        ) *
          tileW) /
          2,
      };
    }
  }
  const range = tileRangeForBbox(bbox, minZoom);
  return {
    zoom: minZoom,
    resolutionM: groundResolutionM(latitudeDeg, minZoom),
    tileCount: (range.xMax - range.xMin + 1) * (range.yMax - range.yMin + 1),
    tileRange: range,
    bbox,
    coveredRadiusM:
      (Math.min(
        range.xMax - range.xMin + 1,
        range.yMax - range.yMin + 1,
      ) *
        tileSizeM(latitudeDeg, minZoom)) /
      2,
  };
}
