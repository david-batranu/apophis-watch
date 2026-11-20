import { describe, expect, it } from 'vitest';
import {
  azElToDirection,
  createProjection,
  CARDINALS,
  projectAzEl,
  projectDirection,
  sampleHorizon,
} from '../../src/ar/projection';
import {
  quatFromDeviceOrientation,
  quatFromVirtualLook,
} from '../../src/ar/math';

const W = 400;
const H = 300;

describe('perspective projection', () => {
  it('puts the look direction at the screen centre', () => {
    const projection = createProjection(W, H, 60);
    const q = quatFromVirtualLook(0, 0);
    const p = projectAzEl(0, 0, q, projection);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(W / 2, 9);
    expect(p.y).toBeCloseTo(H / 2, 9);
    expect(p.depth).toBeCloseTo(1, 12);
  });

  it('maps half the horizontal FOV to the screen edge', () => {
    const projection = createProjection(W, H, 60);
    const q = quatFromVirtualLook(0, 0);
    const rightEdge = projectAzEl(30, 0, q, projection);
    expect(rightEdge.x).toBeCloseTo(W, 8);
    expect(rightEdge.y).toBeCloseTo(H / 2, 8);
    const leftEdge = projectAzEl(330, 0, q, projection);
    expect(leftEdge.x).toBeCloseTo(0, 8);
  });

  it('places east of north to the right and higher elevations above the centre', () => {
    const projection = createProjection(W, H, 60);
    const q = quatFromVirtualLook(0, 0);
    const north = projectAzEl(0, 0, q, projection);
    const east = projectAzEl(20, 0, q, projection);
    expect(east.x).toBeGreaterThan(north.x);
    const up = projectAzEl(0, 20, q, projection);
    expect(up.y).toBeLessThan(north.y);
    const expectedY = H / 2 - Math.tan((20 * Math.PI) / 180) * projection.focalPx;
    expect(up.y).toBeCloseTo(expectedY, 6);
  });

  it('rejects directions behind the camera', () => {
    const projection = createProjection(W, H, 60);
    const q = quatFromVirtualLook(0, 0);
    const south = projectAzEl(180, 10, q, projection);
    expect(south.inFront).toBe(false);
    expect(south.visible).toBe(false);
    expect(Number.isNaN(south.x)).toBe(true);
  });

  it('changes scale with the adjustable horizontal FOV', () => {
    const wide = createProjection(W, H, 90);
    const narrow = createProjection(W, H, 40);
    const q = quatFromVirtualLook(0, 0);
    const widePoint = projectAzEl(30, 0, q, wide);
    const narrowPoint = projectAzEl(30, 0, q, narrow);
    expect(narrow.focalPx).toBeGreaterThan(wide.focalPx);
    expect(narrowPoint.x).toBeGreaterThan(widePoint.x);
  });

  it('pans the target with camera heading', () => {
    const projection = createProjection(W, H, 70);
    const q = quatFromVirtualLook(0, 0);
    const atNorth = projectAzEl(0, 0, q, projection);
    const qEast = quatFromVirtualLook(20, 0);
    const atTwentyEast = projectAzEl(0, 0, qEast, projection);
    expect(atTwentyEast.x).toBeLessThan(atNorth.x);
    expect(atTwentyEast.y).toBeCloseTo(atNorth.y, 6);
  });

  it('uses the screen-adjusted quaternion so landscape poses project identically', () => {
    const projection = createProjection(W, H, 60);
    const portrait = quatFromDeviceOrientation(0, 90, 0, 0);
    const landscape = quatFromDeviceOrientation(270, 0, 90, 90);
    for (const [az, el] of [
      [0, 0],
      [30, 10],
      [330, 5],
      [45, 30],
    ]) {
      const a = projectAzEl(az, el, portrait, projection);
      const b = projectAzEl(az, el, landscape, projection);
      expect(b.x).toBeCloseTo(a.x, 8);
      expect(b.y).toBeCloseTo(a.y, 8);
      expect(b.visible).toBe(a.visible);
    }
  });

  it('projects direction vectors consistently with az/el', () => {
    const projection = createProjection(W, H, 75);
    const q = quatFromVirtualLook(200, 12);
    const p = projectDirection(azElToDirection(234, 20), q, projection);
    const p2 = projectAzEl(234, 20, q, projection);
    expect(p.x).toBeCloseTo(p2.x, 12);
    expect(p.y).toBeCloseTo(p2.y, 12);
    expect(p.depth).toBeCloseTo(p2.depth, 12);
  });

  it('samples the horizon all the way round', () => {
    const projection = createProjection(W, H, 80);
    const q = quatFromVirtualLook(0, 10);
    const samples = sampleHorizon(q, projection, 5);
    expect(samples.length).toBe(73);
    const visible = samples.filter((s) => s.point.inFront);
    expect(visible.length).toBeGreaterThan(0);
    const north = samples.find((s) => s.azimuthDeg === 0)!;
    const south = samples.find((s) => s.azimuthDeg === 180)!;
    expect(north.point.inFront).toBe(true);
    expect(south.point.inFront).toBe(false);
  });

  it('exposes the cardinal order', () => {
    expect(CARDINALS.map((c) => c.label)).toEqual(['N', 'E', 'S', 'W']);
    expect(CARDINALS.map((c) => c.azimuthDeg)).toEqual([0, 90, 180, 270]);
  });
});
