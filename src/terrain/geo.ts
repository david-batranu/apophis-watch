/**
 * Local geodesy for the terrain tab.
 *
 * The scene is a tangent plane at the observer. Over the 5–15 km scale of a
 * DEM patch, an equirectangular local projection is sub-metre accurate, and
 * Earth curvature is applied explicitly as a height correction.
 */

import { t } from '../i18n';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** WGS84 semi-major axis, metres. */
export const WGS84_A_M = 6_378_137;
/** WGS84 flattening. */
export const WGS84_F = 1 / 298.257223563;
/** WGS84 first eccentricity squared. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/** Mean Earth radius used for the local curvature term (IUGG), metres. */
export const EARTH_MEAN_RADIUS_M = 6_371_008.8;

/** Radius of curvature in the meridian at a geodetic latitude, metres. */
export function meridianRadiusM(latitudeDeg: number): number {
  const s = Math.sin(latitudeDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A_M * (1 - WGS84_E2)) / Math.pow(w, 1.5);
}

/** Radius of curvature in the prime vertical at a geodetic latitude, metres. */
export function primeVerticalRadiusM(latitudeDeg: number): number {
  const s = Math.sin(latitudeDeg * DEG);
  return WGS84_A_M / Math.sqrt(1 - WGS84_E2 * s * s);
}

/** Normalise a longitude difference to (-180, 180]. */
export function wrapLongitudeDelta(deg: number): number {
  const wrapped = ((deg + 540) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Normalise an azimuth to [0, 360). */
export function normalizeAzimuth(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Geodetic lat/lon -> east/north metres relative to a tangent-plane origin.
 * Positive east, positive north. Accurate to well under a metre over 10 km.
 */
export function latLonToEnu(
  latitudeDeg: number,
  longitudeDeg: number,
  originLatDeg: number,
  originLonDeg: number,
): { eastM: number; northM: number } {
  const midLat = (latitudeDeg + originLatDeg) / 2;
  const dLon = wrapLongitudeDelta(longitudeDeg - originLonDeg);
  const northM = (latitudeDeg - originLatDeg) * DEG * meridianRadiusM(midLat);
  const eastM =
    dLon * DEG * primeVerticalRadiusM(midLat) * Math.cos(midLat * DEG);
  return { eastM, northM };
}

/**
 * Tangent-plane east/north metres -> geodetic lat/lon.
 * The inverse of {@link latLonToEnu} to first order in the local scale.
 */
export function enuToLatLon(
  eastM: number,
  northM: number,
  originLatDeg: number,
  originLonDeg: number,
): { latitudeDeg: number; longitudeDeg: number } {
  // Invert the mid-latitude forward projection by fixed-point iteration.
  let latitudeDeg = originLatDeg + northM / meridianRadiusM(originLatDeg) / DEG;
  for (let i = 0; i < 4; i++) {
    const midLat = (latitudeDeg + originLatDeg) / 2;
    latitudeDeg =
      originLatDeg + northM / meridianRadiusM(midLat) / DEG;
  }
  const midLat = (latitudeDeg + originLatDeg) / 2;
  const longitudeDeg =
    originLonDeg +
    eastM /
      (primeVerticalRadiusM(midLat) * Math.cos(midLat * DEG)) /
      DEG;
  return { latitudeDeg, longitudeDeg };
}

/**
 * Height drop below the tangent plane at horizontal distance d, metres.
 * This is the exact spherical sagitta R(1 - cos(d/R)); the usual d²/(2R)
 * approximation is within 1 mm at 15 km.
 */
export function curvatureDropM(
  distanceM: number,
  earthRadiusM: number = EARTH_MEAN_RADIUS_M,
): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  if (!Number.isFinite(earthRadiusM) || earthRadiusM <= 0) return 0;
  return earthRadiusM * (1 - Math.cos(distanceM / earthRadiusM));
}

/**
 * Geometric elevation angle of a target above the local tangent plane.
 * `eyeElevationM` and `targetElevationM` are heights above sea level.
 */
export function elevationAngleDeg(
  targetElevationM: number,
  eyeElevationM: number,
  distanceM: number,
  earthRadiusM: number = EARTH_MEAN_RADIUS_M,
): number {
  if (distanceM <= 0) return 0;
  const drop = curvatureDropM(distanceM, earthRadiusM);
  return Math.atan2(targetElevationM - eyeElevationM - drop, distanceM) * RAD;
}

/**
 * Angular parallax shift for a baseline at a given range:
 * atan(baseline / range), returned in arcseconds.
 */
export function parallaxArcsec(baselineKm: number, rangeKm: number): number {
  if (!(rangeKm > 0) || !(baselineKm >= 0)) return 0;
  return Math.atan2(baselineKm, rangeKm) * RAD * 3600;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMPASS_8_LONG = [
  t('compass.north'),
  t('compass.northEast'),
  t('compass.east'),
  t('compass.southEast'),
  t('compass.south'),
  t('compass.southWest'),
  t('compass.west'),
  t('compass.northWest'),
] as const;
const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/** Eight-point compass name, e.g. "SW". */
export function compass8(azimuthDeg: number): string {
  return COMPASS_8[Math.round(normalizeAzimuth(azimuthDeg) / 45) % 8];
}

/** Eight-point compass name in prose, e.g. "south-west". */
export function compass8Long(azimuthDeg: number): string {
  return COMPASS_8_LONG[Math.round(normalizeAzimuth(azimuthDeg) / 45) % 8];
}

/** Sixteen-point compass name, e.g. "WSW". */
export function compass16(azimuthDeg: number): string {
  return COMPASS_16[Math.round(normalizeAzimuth(azimuthDeg) / 22.5) % 16];
}

/** Shortest absolute angular difference between two azimuths, degrees. */
export function azimuthDifferenceDeg(a: number, b: number): number {
  const d = Math.abs(wrapLongitudeDelta(a - b));
  return d;
}

/** Point-in-polygon test on a local east/north ring (ray casting). */
export function pointInPolygon(
  x: number,
  y: number,
  ring: Array<{ eastM: number; northM: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].eastM;
    const yi = ring[i].northM;
    const xj = ring[j].eastM;
    const yj = ring[j].northM;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Distance from a point to an axis-aligned box; zero when inside.
 */
export function distanceToBoxM(
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): number {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}

/**
 * Triangulate a simple polygon by ear clipping. Returns flat index triples
 * into the supplied ring, with counter-clockwise winding. OSM rings may be
 * clockwise; normalise by signed area before clipping. Falls back to a fan
 * if the ring is degenerate.
 */
export function triangulatePolygon(
  ring: Array<{ eastM: number; northM: number }>,
): number[] {
  const n = ring.length;
  if (n < 3) return [];
  // Shoelace signed area; positive is counter-clockwise.
  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    signedArea2 += a.eastM * b.northM - b.eastM * a.northM;
  }
  const order = Array.from({ length: n }, (_, i) => i);
  if (signedArea2 < 0) order.reverse();
  const indices = [...order];
  const triangles: number[] = [];
  const area2 = (a: number, b: number, c: number): number => {
    const A = ring[a];
    const B = ring[b];
    const C = ring[c];
    return (
      (B.eastM - A.eastM) * (C.northM - A.northM) -
      (C.eastM - A.eastM) * (B.northM - A.northM)
    );
  };
  let guard = 0;
  while (indices.length > 3 && guard++ < n * n * 2) {
    let clipped = false;
    for (let k = 0; k < indices.length; k++) {
      const ia = indices[(k + indices.length - 1) % indices.length];
      const ib = indices[k];
      const ic = indices[(k + 1) % indices.length];
      const cross = area2(ia, ib, ic);
      if (cross <= 1e-9) continue; // reflex or collinear
      let contains = false;
      for (const other of indices) {
        if (other === ia || other === ib || other === ic) continue;
        const o = ring[other];
        const a = ring[ia];
        const b = ring[ib];
        const c = ring[ic];
        const d1 = (b.eastM - a.eastM) * (o.northM - a.northM) -
          (b.northM - a.northM) * (o.eastM - a.eastM);
        const d2 = (c.eastM - b.eastM) * (o.northM - b.northM) -
          (c.northM - b.northM) * (o.eastM - b.eastM);
        const d3 = (a.eastM - c.eastM) * (o.northM - c.northM) -
          (a.northM - c.northM) * (o.eastM - c.eastM);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push(ia, ib, ic);
      indices.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push(indices[0], indices[1], indices[2]);
  if (triangles.length === 0) {
    for (let i = 1; i < order.length - 1; i++) {
      triangles.push(order[0], order[i], order[i + 1]);
    }
  }
  return triangles;
}
