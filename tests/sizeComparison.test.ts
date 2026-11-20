import { describe, expect, it } from 'vitest';
import {
  angularDiameterArcsec,
  comparisonAtDistance,
  COMPARISON_OBJECTS,
} from '../src/sky/sizeComparison';

describe('size comparison panel', () => {
  it('calculates the real Apophis angle at CA', () => {
    const arcsec = angularDiameterArcsec(340, 34_800);
    const smallAngle = (0.34 / 34_800) * 206_264.806;
    expect(arcsec).toBeCloseTo(smallAngle, 5);
    expect(arcsec).toBeGreaterThan(2.0);
    expect(arcsec).toBeLessThan(2.1);
  });

  it('orders familiar objects by calculated angular size', () => {
    const rows = comparisonAtDistance(34_800);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.apophis.angularArcsec).toBeCloseTo(2.015, 2);
    expect(byId.eiffel.angularArcsec).toBeCloseTo(1.956, 2);
    expect(byId.iss.angularArcsec).toBeCloseTo(0.646, 2);
    expect(byId.football.angularArcsec).toBeCloseTo(0.623, 2);
    expect(byId.moon.angularArcsec).toBeGreaterThan(20_000);
    expect(byId.moon.angularArcsec / byId.apophis.angularArcsec).toBeGreaterThan(9_000);
  });

  it('scales inversely with distance', () => {
    const near = angularDiameterArcsec(340, 34_800);
    const far = angularDiameterArcsec(340, 69_600);
    expect(near / far).toBeCloseTo(2, 6);
  });

  it('has provenance for every physical size', () => {
    expect(COMPARISON_OBJECTS.length).toBeGreaterThanOrEqual(5);
    for (const object of COMPARISON_OBJECTS) {
      expect(object.sizeM).toBeGreaterThan(0);
      expect(object.source).toBeTruthy();
      expect(object.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});
