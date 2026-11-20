import { clamp, DEG, normalize, RAD, type Vec3 } from '../core/vec3';
import { cameraForward, cameraRight, cameraUp, type Quat } from './math';

export interface ArProjection {
  width: number;
  height: number;
  /** Screen-width horizontal field of view, degrees. */
  horizontalFovDeg: number;
  /** Focal length in CSS pixels, derived from the horizontal FOV. */
  focalPx: number;
}

export interface ProjectedScreenPoint {
  x: number;
  y: number;
  /** Direction is in front of the camera. */
  inFront: boolean;
  /** In front and inside the viewport (with the requested pixel margin). */
  visible: boolean;
  /** Camera-space depth; positive is in front. */
  depth: number;
  /** Angular distance from the camera axis, degrees. */
  angularDistanceDeg: number;
}

export function createProjection(
  width: number,
  height: number,
  horizontalFovDeg: number,
): ArProjection {
  const fov = clamp(horizontalFovDeg, 20, 120);
  const w = Math.max(1, width);
  return {
    width: w,
    height: Math.max(1, height),
    horizontalFovDeg: fov,
    focalPx: w / 2 / Math.tan((fov * DEG) / 2),
  };
}

/** Project an ENU direction into screen pixels for a camera orientation. */
export function projectDirection(
  direction: Vec3,
  orientation: Quat,
  projection: ArProjection,
  marginPx = 24,
): ProjectedScreenPoint {
  const d = normalize(direction);
  const forward = cameraForward(orientation);
  const right = cameraRight(orientation);
  const up = cameraUp(orientation);

  const depth = d.x * forward.x + d.y * forward.y + d.z * forward.z;
  const xCam = d.x * right.x + d.y * right.y + d.z * right.z;
  const yCam = d.x * up.x + d.y * up.y + d.z * up.z;
  const angularDistanceDeg =
    Math.acos(clamp(d.x * forward.x + d.y * forward.y + d.z * forward.z, -1, 1)) * RAD;

  if (depth <= 1e-6) {
    return {
      x: Number.NaN,
      y: Number.NaN,
      inFront: false,
      visible: false,
      depth,
      angularDistanceDeg,
    };
  }

  const x = projection.width / 2 + (xCam / depth) * projection.focalPx;
  const y = projection.height / 2 - (yCam / depth) * projection.focalPx;
  return {
    x,
    y,
    inFront: true,
    visible:
      x >= -marginPx &&
      x <= projection.width + marginPx &&
      y >= -marginPx &&
      y <= projection.height + marginPx,
    depth,
    angularDistanceDeg,
  };
}

/** ENU unit vector for a horizontal coordinate. */
export function azElToDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const cosEl = Math.cos(el);
  return {
    x: Math.sin(az) * cosEl,
    y: Math.cos(az) * cosEl,
    z: Math.sin(el),
  };
}

export function projectAzEl(
  azimuthDeg: number,
  elevationDeg: number,
  orientation: Quat,
  projection: ArProjection,
  marginPx = 24,
): ProjectedScreenPoint {
  return projectDirection(
    azElToDirection(azimuthDeg, elevationDeg),
    orientation,
    projection,
    marginPx,
  );
}

export interface HorizonSample {
  azimuthDeg: number;
  point: ProjectedScreenPoint;
}

/** Sample the horizon great circle (elevation 0) for polyline drawing. */
export function sampleHorizon(
  orientation: Quat,
  projection: ArProjection,
  stepDeg = 2,
): HorizonSample[] {
  const samples: HorizonSample[] = [];
  const step = Math.max(0.5, stepDeg);
  for (let az = 0; az < 360; az += step) {
    samples.push({
      azimuthDeg: az,
      point: projectAzEl(az, 0, orientation, projection, 64),
    });
  }
  samples.push({
    azimuthDeg: 360,
    point: projectAzEl(360, 0, orientation, projection, 64),
  });
  return samples;
}

export interface CardinalDirection {
  label: 'N' | 'E' | 'S' | 'W';
  azimuthDeg: number;
}

export const CARDINALS: readonly CardinalDirection[] = [
  { label: 'N', azimuthDeg: 0 },
  { label: 'E', azimuthDeg: 90 },
  { label: 'S', azimuthDeg: 180 },
  { label: 'W', azimuthDeg: 270 },
];

/** Screen y position of the horizon straight below the camera, if any. */
export function horizonDropPx(
  orientation: Quat,
  projection: ArProjection,
): number | null {
  const azimuth = Math.atan2(cameraForward(orientation).x, cameraForward(orientation).y) * RAD;
  const point = projectAzEl(azimuth, 0, orientation, projection, 1e9);
  return point.inFront ? point.y : null;
}
