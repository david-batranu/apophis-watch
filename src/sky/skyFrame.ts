import { astroTimeFromJdTdb } from '../core/time';
import { dot, normalize, RAD, vec3, type Vec3 } from '../core/vec3';
import { ecefToEqj } from '../ephemeris/frames';
import { enuBasis } from '../ephemeris/wgs84';
import type { ObserverLocation } from '../ephemeris/types';

export interface EnuInEqj {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

/**
 * Express the local east/north/up basis in ICRF/J2000 axes for one instant.
 * Transforming the three basis vectors once per frame is much cheaper than
 * transforming every catalogue star individually.
 */
export function enuBasisInEqj(
  observer: ObserverLocation,
  jdTdb: number,
): EnuInEqj {
  const time = astroTimeFromJdTdb(jdTdb);
  const basis = enuBasis(observer.latitudeDeg, observer.longitudeDeg);
  return {
    east: ecefToEqj(basis.east, time),
    north: ecefToEqj(basis.north, time),
    up: ecefToEqj(basis.up, time),
  };
}

export interface HorizontalDeg {
  azimuthDeg: number;
  elevationDeg: number;
}

/** Horizontal coordinates of a J2000 unit vector, using a precomputed basis. */
export function eqjVectorToHorizontal(star: Vec3, basis: EnuInEqj): HorizontalDeg {
  const u = normalize(star);
  const east = dot(u, basis.east);
  const north = dot(u, basis.north);
  const up = dot(u, basis.up);
  return {
    azimuthDeg: (Math.atan2(east, north) * RAD + 360) % 360,
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, up))) * RAD,
  };
}

/** J2000 RA/Dec in degrees -> unit vector. */
export function raDecToEqj(raDeg: number, decDeg: number): Vec3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return vec3(
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  );
}
