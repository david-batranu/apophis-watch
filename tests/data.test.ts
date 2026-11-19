import { describe, expect, it } from 'vitest';
import { data, validation } from './helpers';

describe('committed ephemeris provenance', () => {
  it('records the Horizons query, retrieval date and solution', () => {
    expect(data.source.provider).toBe('NASA/JPL Horizons');
    expect(data.source.queryUrl).toContain('ssd.jpl.nasa.gov/api/horizons.api');
    expect(data.source.query.CENTER).toContain('500@399');
    expect(data.source.query.REF_PLANE).toContain('FRAME');
    expect(data.source.query.REF_SYSTEM).toContain('ICRF');
    expect(data.source.query.VEC_TABLE).toContain('2');
    expect(data.source.query.TIME_TYPE).toContain('TDB');
    expect(data.source.query.OUT_UNITS).toContain('KM-S');
    expect(data.source.apiVersion).toBeTruthy();
    expect(data.source.horizonsClock).toMatch(/2026/);
    expect(Number.isFinite(Date.parse(data.source.retrievedAt))).toBe(true);
    expect(data.target.solution).toMatch(/JPL#/);
    expect(data.target.absoluteMagnitudeH).toBeCloseTo(19.09, 2);
    expect(data.target.slopeG).toBeCloseTo(0.24, 2);
    expect(data.target.radiusKm).toBeCloseTo(0.17, 3);
  });

  it('is a TDB cubic-Hermite table with 60 s spacing', () => {
    expect(data.schemaVersion).toBe(1);
    expect(data.time.scale).toBe('TDB');
    expect(data.time.interpolation).toBe('cubic-hermite');
    expect(data.time.stepSeconds).toBe(60);
    expect(data.time.ttMinusUtcSeconds).toBe(69.184);
    expect(data.time.leapSeconds).toBe(37);
    expect(data.vectors.length).toBeGreaterThan(2900);
    let worstStepError = 0;
    for (let i = 1; i < data.vectors.length; i++) {
      worstStepError = Math.max(
        worstStepError,
        Math.abs((data.vectors[i][0] - data.vectors[i - 1][0]) * 86400 - 60),
      );
    }
    expect(worstStepError).toBeLessThan(1e-4);
  });

  it('contains finite state vectors spanning more than 48 hours', () => {
    let previous = -Infinity;
    for (const row of data.vectors) {
      expect(row).toHaveLength(7);
      for (const value of row) expect(Number.isFinite(value)).toBe(true);
      expect(row[0]).toBeGreaterThan(previous);
      previous = row[0];
    }
    const spanHours = (data.time.jdEnd - data.time.jdStart) * 24;
    expect(spanHours).toBeGreaterThan(48);
    expect(spanHours).toBeLessThan(50);
  });

  it('has a separate validation truth set with at least five sites', () => {
    expect(validation.source.provider).toBe('NASA/JPL Horizons');
    expect(validation.observerTruth.length).toBeGreaterThanOrEqual(5);
    for (const entry of validation.observerTruth) {
      expect(entry.samples).toHaveLength(7);
      for (const sample of entry.samples) {
        expect(Number.isFinite(sample.azimuthDeg)).toBe(true);
        expect(Number.isFinite(sample.elevationDeg)).toBe(true);
        expect(sample.rangeAu).toBeGreaterThan(0);
      }
    }
    expect(validation.interpolation.samples.length).toBeGreaterThan(1000);
    expect(validation.closestApproachTruth.samples.length).toBe(37);
    expect(validation.topocentricClosestApproachTruth.samples.length).toBe(25);
  });
});
