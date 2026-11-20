import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeDeclination,
  WMM_OFFICIAL_END_MS,
  WMM_PACKAGE_END_MS,
  WMM_PACKAGE_START_MS,
} from '../../src/ar/declination';

const BRASOV = { latitudeDeg: 45.6427, longitudeDeg: 25.5887, elevationM: 600 };

describe('WMM magnetic declination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes the 2029 flyby declination from WMM2025', () => {
    const result = computeDeclination(BRASOV, new Date('2029-04-13T21:45:03Z'));
    expect(result.status).toBe('supported');
    expect(result.modelName).toContain('2025');
    expect(result.declinationDeg).toBeCloseTo(6.7153, 3);
    expect(result.warning).toBeNull();
  });

  it('computes a current-date declination for tonight practice', () => {
    const result = computeDeclination(BRASOV, new Date('2026-11-20T12:00:00Z'));
    expect(result.status).toBe('supported');
    expect(result.declinationDeg).toBeCloseTo(6.5438, 3);
  });

  it('marks the package gap as extrapolated, with a visible warning', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const midway = (WMM_PACKAGE_END_MS + WMM_OFFICIAL_END_MS) / 2;
    const result = computeDeclination(BRASOV, new Date(midway));
    expect(result.status).toBe('extrapolated');
    expect(result.declinationDeg).not.toBeNull();
    expect(result.warning).toContain('Extrapolated WMM2025');
    expect(result.warning).toContain('2029-11-13');
  });

  it('refuses dates beyond the official WMM2025 validity instead of guessing', () => {
    const result = computeDeclination(BRASOV, new Date('2030-01-01T00:00:00Z'));
    expect(result.status).toBe('unsupported');
    expect(result.declinationDeg).toBeNull();
    expect(result.warning).toContain('2029-12-31');
    expect(result.warning).toContain('WMM2030');
  });

  it('refuses dates before the bundled model', () => {
    const result = computeDeclination(BRASOV, new Date('2024-01-01T00:00:00Z'));
    expect(result.status).toBe('unsupported');
    expect(result.declinationDeg).toBeNull();
    expect(result.warning).toContain('2024-11-13');
    expect(WMM_PACKAGE_START_MS).toBeLessThan(WMM_PACKAGE_END_MS);
  });

  it('honours altitude in the WMM point query', () => {
    const low = computeDeclination(
      { ...BRASOV, elevationM: 0 },
      new Date('2029-04-13T21:45:03Z'),
    );
    const high = computeDeclination(
      { ...BRASOV, elevationM: 6000 },
      new Date('2029-04-13T21:45:03Z'),
    );
    expect(low.declinationDeg).not.toBeNull();
    expect(high.declinationDeg).not.toBeNull();
    expect(low.declinationDeg).not.toBeCloseTo(high.declinationDeg as number, 6);
  });
});
