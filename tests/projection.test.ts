import { describe, expect, it } from 'vitest';
import { SkyProjection } from '../src/sky/projection';

describe('stereographic sky projection', () => {
  it('maps zenith, north horizon and east horizon to known pixels', () => {
    const p = new SkyProjection(800, 600, {
      centerAzDeg: 0,
      centerElDeg: 90,
      zoom: 1,
    });
    const zenith = p.project(0, 90);
    expect(zenith.x).toBeCloseTo(400, 9);
    expect(zenith.y).toBeCloseTo(300, 9);
    expect(zenith.visible).toBe(true);

    const north = p.project(0, 0);
    expect(north.x).toBeCloseTo(400, 6);
    expect(north.y).toBeCloseTo(300 - p.horizonRadiusPx, 6);
    expect(north.visible).toBe(true);

    const east = p.project(90, 0);
    expect(east.x).toBeCloseTo(400 + p.horizonRadiusPx, 6);
    expect(east.y).toBeCloseTo(300, 6);
  });

  it('round-trips arbitrary az/el through screen coordinates', () => {
    const p = new SkyProjection(900, 700, {
      centerAzDeg: 35,
      centerElDeg: 62,
      zoom: 1.4,
    });
    const points = [
      [0, 0],
      [45, 20],
      [90, 45],
      [180, 10],
      [270, -5],
      [35, 62],
      [120, 80],
    ] as const;
    for (const [az, el] of points) {
      const projected = p.project(az, el);
      if (!projected.visible) continue;
      const back = p.unproject(projected.x, projected.y);
      expect(back.azDeg).toBeCloseTo(az, 6);
      expect(back.elDeg).toBeCloseTo(el, 6);
    }
  });

  it('zooms and pans without breaking the round trip', () => {
    const p = new SkyProjection(800, 600, {
      centerAzDeg: 0,
      centerElDeg: 90,
      zoom: 1,
    });
    const before = p.horizonRadiusPx;
    p.zoomBy(2);
    expect(p.horizonRadiusPx).toBeCloseTo(before * 2, 6);
    p.panByPixels(60, 30);
    expect(p.centerAzDeg).not.toBe(0);
    expect(p.centerElDeg).toBeLessThan(90);
    const point = p.project(120, 15);
    const back = p.unproject(point.x, point.y);
    expect(back.azDeg).toBeCloseTo(120, 5);
    expect(back.elDeg).toBeCloseTo(15, 5);
  });

  it('culls the antipode instead of producing infinities', () => {
    const p = new SkyProjection(800, 600, {
      centerAzDeg: 0,
      centerElDeg: 90,
      zoom: 1,
    });
    const below = p.project(0, -90);
    expect(below.visible).toBe(false);
    expect(Number.isFinite(below.x)).toBe(false);
  });
});
