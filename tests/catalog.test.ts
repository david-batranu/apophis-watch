import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateStarCatalogue } from '../src/sky/catalog';

const catalogue = validateStarCatalogue(
  JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/data/stars.json'), 'utf8'),
  ),
);

describe('bundled HYG star catalogue', () => {
  it('uses J2000 RA degrees, not HYG hours', () => {
    const byName = new Map(
      catalogue.stars.filter((s) => s.name).map((s) => [s.name!, s]),
    );
    const checks = [
      ['Sirius', 101.287, -16.716],
      ['Capella', 79.172, 45.998],
      ['Vega', 279.234, 38.784],
      ['Polaris', 37.95, 89.264],
    ] as const;
    for (const [name, ra, dec] of checks) {
      const star = byName.get(name);
      expect(star, name).toBeDefined();
      expect(star!.raDeg, name).toBeCloseTo(ra, 2);
      expect(star!.decDeg, name).toBeCloseTo(dec, 2);
    }
  });

  it('covers the whole sky instead of a 0-24 degree strip', () => {
    const ras = catalogue.stars.map((s) => s.raDeg);
    expect(Math.min(...ras)).toBeLessThan(5);
    expect(Math.max(...ras)).toBeGreaterThan(350);
    for (const star of catalogue.stars) {
      expect(star.raDeg).toBeGreaterThanOrEqual(0);
      expect(star.raDeg).toBeLessThan(360);
      expect(star.decDeg).toBeGreaterThanOrEqual(-90);
      expect(star.decDeg).toBeLessThanOrEqual(90);
    }
    expect(catalogue.stars.length).toBe(1615);
    expect(catalogue.stars.every((s) => s.mag < 5)).toBe(true);
  });

  it('has constellation polylines spanning the real sky', () => {
    expect(catalogue.constellations.length).toBe(90);
    const allPoints = catalogue.constellations.flatMap((c) =>
      c.segments.flat(),
    );
    expect(allPoints.length).toBeGreaterThan(700);
    expect(Math.max(...allPoints.map((p) => p[0]))).toBeGreaterThan(350);
    expect(Math.min(...allPoints.map((p) => p[0]))).toBeLessThan(10);
  });

  it('records the HYG and ConstellationLines licences and attribution', () => {
    expect(catalogue.metadata.source).toContain('HYG');
    expect(catalogue.metadata.source).toContain('ConstellationLines');
    expect(catalogue.metadata.license).toContain('CC BY-SA 4.0');
    expect(catalogue.metadata.license).toContain('CC BY 4.0');
    expect(catalogue.metadata.attribution).toContain('David Nash');
    expect(catalogue.metadata.attribution).toContain('Marc van der Sluys');
    expect(catalogue.metadata.magnitudeLimit).toBe(5);
    expect(catalogue.metadata.starCount).toBe(catalogue.stars.length);
  });
});
