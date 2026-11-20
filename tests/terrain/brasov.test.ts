import { describe, expect, it } from 'vitest';
import { SimulationSession } from '../../src/state/session';
import { buildApophisPath, formatSector, interpolatePathAt } from '../../src/terrain/path';
import { parallaxArcsec } from '../../src/terrain/geo';
import { ephem } from '../helpers';

const BRASOV = {
  latitudeDeg: 45.6427,
  longitudeDeg: 25.5887,
  elevationM: 600,
};

describe('Brasov visible Apophis path sector', () => {
  const session = new SimulationSession(ephem, BRASOV);
  const path = buildApophisPath(session, { stepSeconds: 30 });

  it('uses only the physical visibility window containing the close approach', () => {
    expect(path.samples).toHaveLength(625);
    expect(new Date(path.samples[0].utcMs).toISOString()).toBe(
      '2029-04-13T17:32:35.247Z',
    );
    expect(new Date(path.samples[path.samples.length - 1].utcMs).toISOString()).toBe(
      '2029-04-13T22:44:06.557Z',
    );
    const interval = session.visibleIntervalForJump()!;
    expect(interval.startUtc.toISOString()).toBe('2029-04-13T17:32:35.247Z');
    expect(interval.endUtc.toISOString()).toBe('2029-04-13T22:44:06.557Z');
  });

  it('reports the azimuth/elevation sector', () => {
    expect(path.sector.minAzimuthDeg).toBeCloseTo(124.2529, 3);
    expect(path.sector.maxAzimuthDeg).toBeCloseTo(320.0524, 3);
    expect(path.sector.spanDeg).toBeCloseTo(195.7995, 3);
    expect(path.sector.wrapsNorth).toBe(false);
    expect(path.sector.minElevationDeg).toBeCloseTo(0, 3);
    expect(path.sector.maxElevationDeg).toBeCloseTo(42.2899, 3);
    expect(formatSector(path.sector)).toContain('124.3° → 320.1°');
    expect(formatSector(path.sector)).toContain('195.8°');
  });

  it('matches the Phase 2 max-elevation sample around 20:45 UTC', () => {
    const target = Date.parse('2029-04-13T20:45:00Z');
    const sample = path.samples.reduce((best, current) =>
      Math.abs(current.utcMs - target) < Math.abs(best.utcMs - target)
        ? current
        : best,
    );
    expect(new Date(sample.utcMs).toISOString()).toBe(
      '2029-04-13T20:45:05.247Z',
    );
    expect(sample.azimuthDeg).toBeCloseTo(214.0779, 3);
    expect(sample.elevationDeg).toBeCloseTo(42.2899, 3);
    expect(sample.rangeKm).toBeCloseTo(40_385.6, 0);
  });

  it('interpolates inside the path window and hides the marker outside it', () => {
    const first = path.samples[0];
    const last = path.samples[path.samples.length - 1];
    expect(interpolatePathAt(path.samples, first.utcMs - 120_000)).toBeNull();
    expect(interpolatePathAt(path.samples, last.utcMs + 120_000)).toBeNull();
    const mid = interpolatePathAt(path.samples, first.utcMs + 15_000);
    expect(mid).not.toBeNull();
    expect(mid!.azimuthDeg).toBeGreaterThan(first.azimuthDeg);
    expect(mid!.elevationDeg).toBeGreaterThan(first.elevationDeg);
  });

  it('reports the 5 km parallax check', () => {
    expect(path.parallax.baselineKm).toBe(5);
    expect(path.parallax.rangeKm).toBeCloseTo(34_591.44, 1);
    expect(path.parallax.arcsec).toBeCloseTo(29.8144, 3);
    expect(path.parallaxAtGeocentricCa.rangeKm).toBeCloseTo(38_011.34, 1);
    expect(path.parallaxAtGeocentricCa.arcsec).toBeCloseTo(27.1320, 3);
    expect(parallaxArcsec(5, 38_011.3435)).toBeCloseTo(27.132, 3);
  });
});
