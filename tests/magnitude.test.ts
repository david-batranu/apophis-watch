import { describe, expect, it } from 'vitest';
import { hgMagnitude } from '../src/ephemeris/magnitude';
import { computeTopocentric } from '../src/ephemeris/topocentric';
import { jdToMs } from '../src/core/time';
import { ephem, validation } from './helpers';

describe('IAU H-G magnitude estimate', () => {
  it('reduces to H + 5 log10(r delta) at zero phase', () => {
    const m = hgMagnitude(19.09, 0.24, 0, 1.0, 0.1);
    expect(m).toBeCloseTo(19.09 + 5 * Math.log10(0.1), 10);
  });

  it('matches Horizons APmag where Horizons prints fractional values', () => {
    let worst = 0;
    let checked = 0;
    for (const entry of validation.observerTruth) {
      for (const sample of entry.samples) {
        if (Math.abs(sample.magnitude - Math.round(sample.magnitude)) < 1e-9) continue;
        const sky = computeTopocentric(ephem, entry.site, new Date(jdToMs(sample.jdUtc)));
        worst = Math.max(worst, Math.abs(sky.magnitude - sample.magnitude));
        checked++;
      }
    }
    console.log(`H-G vs Horizons APmag: ${checked} fractional rows, worst ${worst.toFixed(4)} mag`);
    expect(checked).toBeGreaterThan(20);
    expect(worst).toBeLessThan(0.01);
  });

  it('keeps the phase angle in range at closest approach', () => {
    const sample = validation.observerTruth[0].samples[3];
    const sky = computeTopocentric(ephem, validation.observerTruth[0].site, new Date(jdToMs(sample.jdUtc)));
    expect(sky.phaseAngleDeg).toBeGreaterThan(0);
    expect(sky.phaseAngleDeg).toBeLessThan(180);
    expect(sky.heliocentricDistanceAu).toBeGreaterThan(0.9);
    expect(sky.heliocentricDistanceAu).toBeLessThan(1.1);
    expect(sky.observerDistanceAu).toBeCloseTo(sky.rangeKm / 149597870.7, 9);
  });

  it('is monotonic in phase angle at fixed distances', () => {
    const a = hgMagnitude(19.09, 0.24, 10, 1, 0.1);
    const b = hgMagnitude(19.09, 0.24, 60, 1, 0.1);
    expect(b).toBeGreaterThan(a);
  });
});
