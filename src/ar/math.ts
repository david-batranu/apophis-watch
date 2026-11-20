import { DEG, RAD, clamp, type Vec3 } from '../core/vec3';

/**
 * Unit quaternion using the Hamilton convention. `quatRotate(q, v)` applies
 * the rotation to a vector; `quatMultiply(a, b)` means "apply b, then a".
 */
export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** World frame used throughout the AR layer: x=east, y=north, z=up. */
export const WORLD_UP: Vec3 = { x: 0, y: 0, z: 1 };
export const WORLD_EAST: Vec3 = { x: 1, y: 0, z: 0 };
export const WORLD_NORTH: Vec3 = { x: 0, y: 1, z: 0 };

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Screen angle for the device-orientation compensation. Prefer the Screen
 * Orientation API angle; fall back to legacy `window.orientation` (which uses
 * ±90) and normalise it to 0..270. Anything unusable becomes 0.
 */
export function screenAngleFromSources(
  screenOrientationAngle: number | null | undefined,
  legacyWindowOrientation: number | null | undefined,
): number {
  if (
    typeof screenOrientationAngle === 'number' &&
    Number.isFinite(screenOrientationAngle)
  ) {
    return normalizeDeg(screenOrientationAngle);
  }
  if (
    typeof legacyWindowOrientation === 'number' &&
    Number.isFinite(legacyWindowOrientation)
  ) {
    return normalizeDeg(legacyWindowOrientation);
  }
  return 0;
}

/** Signed shortest rotation from `from` to `to`, in (-180, 180]. */
export function shortestAngleDeg(fromDeg: number, toDeg: number): number {
  const delta = normalizeDeg(toDeg - fromDeg);
  return delta > 180 ? delta - 360 : delta;
}

export function quatIdentity(): Quat {
  return { w: 1, x: 0, y: 0, z: 0 };
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  if (!(n > 1e-12)) return quatIdentity();
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/** Hamilton product: rotate by b first, then by a. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return quatNormalize({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const n = Math.hypot(axis.x, axis.y, axis.z);
  if (!(n > 1e-12)) return quatIdentity();
  const half = angleRad / 2;
  const s = Math.sin(half) / n;
  return { w: Math.cos(half), x: axis.x * s, y: axis.y * s, z: axis.z * s };
}

export function quatConjugate(q: Quat): Quat {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

/** Rotate a vector by a unit quaternion. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * Device orientation (W3C intrinsic Z-X'-Y'' angles) to the rotation that
 * takes device/screen coordinates into the world ENU frame.
 *
 * The W3C matrix is R = Rz(alpha) Rx(beta) Ry(gamma); its columns are the
 * device x/y/z axes in world coordinates. A rear camera looks along device
 * -z, so an upright portrait phone with alpha=0, beta=90 points north.
 */
export function quatFromDeviceEuler(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): Quat {
  const x = betaDeg * DEG;
  const y = gammaDeg * DEG;
  const z = alphaDeg * DEG;
  const cX = Math.cos(x / 2);
  const cY = Math.cos(y / 2);
  const cZ = Math.cos(z / 2);
  const sX = Math.sin(x / 2);
  const sY = Math.sin(y / 2);
  const sZ = Math.sin(z / 2);
  return quatNormalize({
    w: cX * cY * cZ - sX * sY * sZ,
    x: sX * cY * cZ - cX * sY * sZ,
    y: cX * sY * cZ + sX * cY * sZ,
    z: cX * cY * sZ + sX * sY * cZ,
  });
}

/**
 * Screen-adjusted device orientation.
 *
 * `screenAngleDeg` is `screen.orientation.angle` (0/90/180/270). W3C and the
 * Chrome/Firefox implementations require the screen-adjusted matrix
 * `R_screen = R_device * Rz(-theta)` for DeviceOrientation angles; using the
 * opposite sign rolls landscape by 180°. The matching quaternion is therefore
 * `q_device * q_z(-theta)`.
 */
export function quatFromDeviceOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): Quat {
  const device = quatFromDeviceEuler(alphaDeg, betaDeg, gammaDeg);
  const screen = quatFromAxisAngle(WORLD_UP, -screenAngleDeg * DEG);
  return quatMultiply(device, screen);
}

/**
 * Rotation for a virtual (touch-drag) camera. Camera coordinates are the same
 * as a portrait phone's: x right, y up, z out of the screen. The camera looks
 * along -z; heading is clockwise from north and pitch is positive upwards.
 */
export function quatFromVirtualLook(
  headingDeg: number,
  pitchDeg: number,
): Quat {
  return quatFromDeviceOrientation(
    normalizeDeg(-headingDeg),
    90 + clamp(pitchDeg, -89, 89),
    0,
    0,
  );
}

/** Rear-camera look direction (device -z) in world coordinates. */
export function cameraForward(q: Quat): Vec3 {
  return quatRotate(q, { x: 0, y: 0, z: -1 });
}

/** Camera right direction (device +x) in world coordinates. */
export function cameraRight(q: Quat): Vec3 {
  return quatRotate(q, { x: 1, y: 0, z: 0 });
}

/** Camera up direction (device +y) in world coordinates. */
export function cameraUp(q: Quat): Vec3 {
  return quatRotate(q, { x: 0, y: 1, z: 0 });
}

/** Compass heading of the rear camera, clockwise from true north. */
export function headingFromQuat(q: Quat): number {
  const f = cameraForward(q);
  return normalizeDeg(Math.atan2(f.x, f.y) * RAD);
}

/** Elevation of the rear camera above the horizon, degrees. */
export function pitchFromQuat(q: Quat): number {
  return Math.asin(clamp(cameraForward(q).z, -1, 1)) * RAD;
}

/** Screen roll: 0 when the screen's up vector matches world up. */
export function rollFromQuat(q: Quat): number {
  const up = cameraUp(q);
  const right = cameraRight(q);
  return Math.atan2(right.z, up.z) * RAD;
}

/**
 * Rotate the camera about world up so its heading becomes `targetHeadingDeg`.
 * This changes only yaw; the physical tilt (pitch and roll) is untouched.
 */
export function quatAimAtHeading(q: Quat, targetHeadingDeg: number): Quat {
  const current = headingFromQuat(q);
  const delta = shortestAngleDeg(current, targetHeadingDeg);
  return quatMultiply(quatFromAxisAngle(WORLD_UP, -delta * DEG), q);
}

/** Add a signed heading delta (positive clockwise/eastward) to a camera. */
export function quatAddHeading(q: Quat, deltaDeg: number): Quat {
  return quatMultiply(quatFromAxisAngle(WORLD_UP, -deltaDeg * DEG), q);
}

/** Slerp with shortest-arc handling. `t=0` returns a, `t=1` returns b. */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let cosHalf = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let target = b;
  if (cosHalf < 0) {
    cosHalf = -cosHalf;
    target = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
  }
  const amount = clamp(t, 0, 1);
  if (cosHalf > 0.9995) {
    return quatNormalize({
      w: a.w + (target.w - a.w) * amount,
      x: a.x + (target.x - a.x) * amount,
      y: a.y + (target.y - a.y) * amount,
      z: a.z + (target.z - a.z) * amount,
    });
  }
  const half = Math.acos(clamp(cosHalf, -1, 1));
  const sinHalf = Math.sin(half);
  const wa = Math.sin((1 - amount) * half) / sinHalf;
  const wb = Math.sin(amount * half) / sinHalf;
  return quatNormalize({
    w: a.w * wa + target.w * wb,
    x: a.x * wa + target.x * wb,
    y: a.y * wa + target.y * wb,
    z: a.z * wa + target.z * wb,
  });
}

/** Angular distance between two orientations, degrees. */
export function quatAngleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 2 * Math.acos(clamp(dot, -1, 1)) * RAD;
}

/** Row-major 3x3 rotation matrix, exposed for independent tests. */
export function quatToMatrix(q: Quat): number[] {
  const { w, x, y, z } = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/** Column vectors of a rotation matrix: the rotated x, y and z axes. */
export function quatBasis(q: Quat): { x: Vec3; y: Vec3; z: Vec3 } {
  const m = quatToMatrix(q);
  return {
    x: { x: m[0], y: m[3], z: m[6] },
    y: { x: m[1], y: m[4], z: m[7] },
    z: { x: m[2], y: m[5], z: m[8] },
  };
}
