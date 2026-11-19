import { DEG, vec3, type Vec3 } from '../core/vec3';
import type { ObserverLocation } from './types';

/** WGS84 semi-major axis, km. */
export const WGS84_A_KM = 6378.137;
/** WGS84 flattening. */
export const WGS84_F = 1 / 298.257223563;
/** WGS84 semi-minor axis, km. */
export const WGS84_B_KM = WGS84_A_KM * (1 - WGS84_F);
/** WGS84 first eccentricity squared. */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/**
 * Geodetic latitude/longitude/elevation -> Earth-fixed cartesian km.
 * Longitude is east-positive, latitude north-positive.
 */
export function geodeticToEcef(location: ObserverLocation): Vec3 {
  const lat = location.latitudeDeg * DEG;
  const lon = location.longitudeDeg * DEG;
  const hKm = location.elevationM / 1000;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return vec3(
    (n + hKm) * cosLat * Math.cos(lon),
    (n + hKm) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + hKm) * sinLat,
  );
}

/** Earth-fixed cartesian km -> geodetic latitude/longitude/elevation. */
export function ecefToGeodetic(v: Vec3): ObserverLocation {
  const p = Math.hypot(v.x, v.y);
  const lonDeg = Math.atan2(v.y, v.x) / DEG;
  if (p < 1e-9) {
    return {
      latitudeDeg: v.z >= 0 ? 90 : -90,
      longitudeDeg: 0,
      elevationM: Math.abs(v.z) - WGS84_B_KM * 1000,
    };
  }
  let lat = Math.atan2(v.z, p * (1 - WGS84_E2));
  let h = 0;
  for (let i = 0; i < 8; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(v.z, p * (1 - (WGS84_E2 * n) / (n + h)));
  }
  return {
    latitudeDeg: lat / DEG,
    longitudeDeg: lonDeg,
    elevationM: h * 1000,
  };
}

/**
 * Radius of the WGS84 ellipsoid along a unit direction from the geocentre.
 * Used for "distance above the surface" of a nearby object.
 */
export function ellipsoidRadiusAlong(direction: Vec3): number {
  const rho2 = direction.x * direction.x + direction.y * direction.y;
  const z2 = direction.z * direction.z;
  return 1 / Math.sqrt(rho2 / (WGS84_A_KM * WGS84_A_KM) + z2 / (WGS84_B_KM * WGS84_B_KM));
}

/** Unit east/north/up basis of the local ENU frame at a geodetic point. */
export function enuBasis(latitudeDeg: number, longitudeDeg: number): {
  east: Vec3;
  north: Vec3;
  up: Vec3;
} {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return {
    east: vec3(-sinLon, cosLon, 0),
    north: vec3(-sinLat * cosLon, -sinLat * sinLon, cosLat),
    up: vec3(cosLat * cosLon, cosLat * sinLon, sinLat),
  };
}

/** Express an Earth-fixed vector in the local ENU basis. */
export function ecefToEnu(v: Vec3, latitudeDeg: number, longitudeDeg: number): Vec3 {
  const { east, north, up } = enuBasis(latitudeDeg, longitudeDeg);
  return vec3(
    east.x * v.x + east.y * v.y + east.z * v.z,
    north.x * v.x + north.y * v.y + north.z * v.z,
    up.x * v.x + up.y * v.y + up.z * v.z,
  );
}
