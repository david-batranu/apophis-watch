import {
  Rotation_EQD_EQJ,
  Rotation_EQJ_EQD,
  SiderealTime,
  type AstroTime,
} from 'astronomy-engine';
import { DEG, vec3, type Vec3 } from '../core/vec3';

type Matrix = number[][];

/**
 * Apply an astronomy-engine rotation matrix to a vector.
 *
 * astronomy-engine's `RotationMatrix.rot` is consumed through its own
 * `RotateVector`, which computes the transpose of the printed row-major
 * array. Using `m * v` here silently applies the inverse rotation (a ~0.8
 * degree error in 2029), so we match `RotateVector` exactly and cover it
 * with a test against `ObserverVector`.
 */
function applyMatrix(m: Matrix, v: Vec3): Vec3 {
  return vec3(
    m[0][0] * v.x + m[1][0] * v.y + m[2][0] * v.z,
    m[0][1] * v.x + m[1][1] * v.y + m[2][1] * v.z,
    m[0][2] * v.x + m[1][2] * v.y + m[2][2] * v.z,
  );
}

/** Greenwich apparent sidereal time in radians, using astronomy-engine. */
export function gastRad(time: AstroTime): number {
  return SiderealTime(time) * 15 * DEG;
}

/** ICRF/J2000 mean equator -> true equator of date. */
export function eqjToEqd(v: Vec3, time: AstroTime): Vec3 {
  return applyMatrix(Rotation_EQJ_EQD(time).rot, v);
}

/** True equator of date -> ICRF/J2000 mean equator. */
export function eqdToEqj(v: Vec3, time: AstroTime): Vec3 {
  return applyMatrix(Rotation_EQD_EQJ(time).rot, v);
}

/**
 * ICRF/J2000 equatorial -> Earth-fixed (ITRF-like) axes.
 * Uses precession+nutation from astronomy-engine and Greenwich apparent
 * sidereal time. Polar motion (<0.5 arcsec) is intentionally omitted.
 */
export function eqjToEcef(v: Vec3, time: AstroTime): Vec3 {
  const eqd = eqjToEqd(v, time);
  const theta = gastRad(time);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // Rotation by +GAST about z, as required for ECEF east-longitude.
  return vec3(c * eqd.x + s * eqd.y, -s * eqd.x + c * eqd.y, eqd.z);
}

/** Earth-fixed axes -> ICRF/J2000 equatorial. */
export function ecefToEqj(v: Vec3, time: AstroTime): Vec3 {
  const theta = gastRad(time);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const eqd = vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
  return eqdToEqj(eqd, time);
}
