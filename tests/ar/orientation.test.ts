import { describe, expect, it } from 'vitest';
import {
  cameraForward,
  cameraUp,
  headingFromQuat,
  pitchFromQuat,
  quatAddHeading,
  quatAimAtHeading,
  quatAngleBetween,
  quatBasis,
  quatFromDeviceEuler,
  quatFromDeviceOrientation,
  quatFromVirtualLook,
  quatSlerp,
  quatToMatrix,
  rollFromQuat,
  screenAngleFromSources,
  shortestAngleDeg,
} from '../../src/ar/math';

const DEG = Math.PI / 180;

function closeVec(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  digits = 12,
): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

function angleDiff(a: number, b: number): number {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

describe('device orientation quaternion', () => {
  it('matches the W3C Z-X\'-Y" rotation matrix', () => {
    const alpha = 37;
    const beta = 63;
    const gamma = -22;
    const q = quatFromDeviceEuler(alpha, beta, gamma);
    const m = quatToMatrix(q);

    const cX = Math.cos(beta * DEG);
    const sX = Math.sin(beta * DEG);
    const cY = Math.cos(gamma * DEG);
    const sY = Math.sin(gamma * DEG);
    const cZ = Math.cos(alpha * DEG);
    const sZ = Math.sin(alpha * DEG);
    const expected = [
      cZ * cY - sZ * sX * sY,
      -cX * sZ,
      cY * sZ * sX + cZ * sY,
      cY * sZ + cZ * sX * sY,
      cZ * cX,
      sZ * sY - cZ * cY * sX,
      -cX * sY,
      sX,
      cX * cY,
    ];
    for (let i = 0; i < 9; i++) expect(m[i]).toBeCloseTo(expected[i], 12);
  });

  it('points the rear camera north when upright in portrait', () => {
    const q = quatFromDeviceOrientation(0, 90, 0, 0);
    closeVec(cameraForward(q), { x: 0, y: 1, z: 0 });
    closeVec(cameraUp(q), { x: 0, y: 0, z: 1 });
    expect(headingFromQuat(q)).toBeCloseTo(0, 10);
    expect(pitchFromQuat(q)).toBeCloseTo(0, 10);
  });

  it('treats alpha as the opposite sense to compass heading', () => {
    expect(headingFromQuat(quatFromDeviceOrientation(90, 90, 0, 0))).toBeCloseTo(270, 10);
    expect(headingFromQuat(quatFromDeviceOrientation(270, 90, 0, 0))).toBeCloseTo(90, 10);
    expect(headingFromQuat(quatFromDeviceOrientation(180, 90, 0, 0))).toBeCloseTo(180, 10);
  });

  it('produces a level, north-facing screen in all four screen orientations', () => {
    // Each raw pose is the same physical state: camera pointing north with the
    // displayed screen upright. Screen orientation is clockwise from natural:
    // 90 = top edge left, 270 = top edge right.
    const poses = [
      { screen: 0, alpha: 0, beta: 90, gamma: 0 },
      { screen: 90, alpha: 90, beta: 0, gamma: -90 },
      { screen: 180, alpha: 90, beta: -90, gamma: -90 },
      { screen: 270, alpha: 270, beta: 0, gamma: 90 },
    ];
    for (const pose of poses) {
      const q = quatFromDeviceOrientation(
        pose.alpha,
        pose.beta,
        pose.gamma,
        pose.screen,
      );
      closeVec(cameraForward(q), { x: 0, y: 1, z: 0 });
      closeVec(cameraUp(q), { x: 0, y: 0, z: 1 });
      expect(headingFromQuat(q)).toBeCloseTo(0, 9);
      expect(pitchFromQuat(q)).toBeCloseTo(0, 9);
      // Basis columns agree with the independent matrix conversion.
      const basis = quatBasis(q);
      closeVec(basis.y, { x: 0, y: 0, z: 1 });
    }
  });

  it('keeps the forward direction unchanged by screen rotation', () => {
    const portrait = quatFromDeviceOrientation(123, 71, 12, 0);
    const landscape = quatFromDeviceOrientation(123, 71, 12, 90);
    closeVec(cameraForward(portrait), cameraForward(landscape));
  });

  it('aims yaw without changing pitch or roll', () => {
    const start = quatFromDeviceOrientation(0, 80, 10, 0);
    const aimed = quatAimAtHeading(start, 123.4);
    expect(angleDiff(headingFromQuat(aimed), 123.4)).toBeLessThan(1e-8);
    expect(pitchFromQuat(aimed)).toBeCloseTo(pitchFromQuat(start), 10);
    expect(rollFromQuat(aimed)).toBeCloseTo(rollFromQuat(start), 10);
  });

  it('adds heading across the north wrap', () => {
    const west = quatFromVirtualLook(355, 0);
    const east = quatAddHeading(west, 10);
    expect(angleDiff(headingFromQuat(east), 5)).toBeLessThan(1e-8);
    expect(shortestAngleDeg(355, 5)).toBeCloseTo(10, 12);
    expect(shortestAngleDeg(5, 355)).toBeCloseTo(-10, 12);
  });

  it('builds a virtual look with the requested heading and pitch', () => {
    for (const heading of [0, 45, 90, 180, 269, 359]) {
      for (const pitch of [-45, 0, 30, 80]) {
        const q = quatFromVirtualLook(heading, pitch);
        expect(angleDiff(headingFromQuat(q), heading)).toBeLessThan(1e-8);
        expect(pitchFromQuat(q)).toBeCloseTo(pitch, 8);
        expect(rollFromQuat(q)).toBeCloseTo(0, 8);
      }
    }
  });

  it('slerps along the shortest arc across north', () => {
    const a = quatFromVirtualLook(350, 0);
    const b = quatFromVirtualLook(10, 0);
    const mid = quatSlerp(a, b, 0.5);
    expect(angleDiff(headingFromQuat(mid), 0)).toBeLessThan(1e-6);
    expect(quatAngleBetween(a, b)).toBeCloseTo(20, 8);
    const quarter = quatSlerp(a, b, 0.25);
    expect(angleDiff(headingFromQuat(quarter), 355)).toBeLessThan(1e-6);
  });

  it('normalises Screen Orientation and legacy window.orientation angles', () => {
    expect(screenAngleFromSources(0, null)).toBe(0);
    expect(screenAngleFromSources(90, null)).toBe(90);
    expect(screenAngleFromSources(180, null)).toBe(180);
    expect(screenAngleFromSources(270, null)).toBe(270);
    expect(screenAngleFromSources(null, 0)).toBe(0);
    expect(screenAngleFromSources(null, 90)).toBe(90);
    expect(screenAngleFromSources(null, -90)).toBe(270);
    expect(screenAngleFromSources(null, 180)).toBe(180);
    expect(screenAngleFromSources(undefined, -90)).toBe(270);
    expect(screenAngleFromSources(Number.NaN, Number.NaN)).toBe(0);
    // The Screen Orientation API wins when both are present.
    expect(screenAngleFromSources(90, -90)).toBe(90);
  });
});
