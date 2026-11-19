import { describe, expect, it } from 'vitest';
import { jdToMs } from '../src/core/time';
import {
  computeTopocentric,
  horizontalSeparationDeg,
} from '../src/ephemeris/topocentric';
import { refractedElevationDeg } from '../src/ephemeris/refraction';
import { ephem, validation } from './helpers';

describe('topocentric az/el validation against JPL Horizons', () => {
  it('is under 1 arcminute at all five sites and seven epochs', () => {
    let overallMax = 0;
    const table: string[] = [];
    for (const entry of validation.observerTruth) {
      let siteMax = 0;
      let siteMaxAt = '';
      let rangeMax = 0;
      let magMax = 0;
      let sizeMax = 0;
      for (const sample of entry.samples) {
        const date = new Date(jdToMs(sample.jdUtc));
        const sky = computeTopocentric(ephem, entry.site, date);
        const sepArcmin =
          horizontalSeparationDeg(
            sky.azimuthDeg,
            sky.elevationDeg,
            sample.azimuthDeg,
            sample.elevationDeg,
          ) * 60;
        if (sepArcmin > siteMax) {
          siteMax = sepArcmin;
          siteMaxAt = sample.utc;
        }
        rangeMax = Math.max(
          rangeMax,
          Math.abs(sky.rangeKm - sample.rangeAu * 149597870.7),
        );
        // Horizons prints APmag as an integer ("7.") above ~6.5, so only
        // compare rows where it supplied a fractional magnitude.
        if (Math.abs(sample.magnitude - Math.round(sample.magnitude)) > 1e-9) {
          magMax = Math.max(magMax, Math.abs(sky.magnitude - sample.magnitude));
        }
        sizeMax = Math.max(
          sizeMax,
          Math.abs(sky.angularDiameterArcsec - sample.angularDiameterArcsec),
        );
        expect(Number.isFinite(sky.azimuthDeg)).toBe(true);
        expect(sky.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(sky.azimuthDeg).toBeLessThan(360);
        expect(sky.elevationDeg).toBeGreaterThanOrEqual(-90);
        expect(sky.elevationDeg).toBeLessThanOrEqual(90);
        expect(sky.refracted).toBe(false);
      }
      overallMax = Math.max(overallMax, siteMax);
      table.push(
        `| ${entry.site.name} | ${siteMax.toFixed(3)} | ${siteMaxAt} | ${rangeMax.toFixed(3)} | ${sizeMax.toFixed(6)} |`,
      );
      expect(siteMax).toBeLessThan(1);
      expect(rangeMax).toBeLessThan(0.2);
      expect(magMax).toBeLessThan(0.01);
      expect(sizeMax).toBeLessThan(0.01);
    }
    console.log(
      '\nObserver validation (az/el separation, arcmin)\n' +
        '| site | max arcmin | epoch | max range km | max size arcsec |\n' +
        '|---|---|---|---|---|\n' +
        table.join('\n') +
        `\nOVERALL MAX: ${overallMax.toFixed(3)} arcmin`,
    );
    expect(overallMax).toBeLessThan(1);
  });

  it('proves stellar aberration is applied and materially improves the fit', () => {
    let maxEffect = 0;
    let maxTruthWith = 0;
    let maxTruthWithout = 0;
    for (const entry of validation.observerTruth) {
      for (const sample of entry.samples) {
        const date = new Date(jdToMs(sample.jdUtc));
        const withAberration = computeTopocentric(ephem, entry.site, date);
        const withoutAberration = computeTopocentric(ephem, entry.site, date, {
          aberration: false,
        });
        maxTruthWith = Math.max(
          maxTruthWith,
          horizontalSeparationDeg(
            withAberration.azimuthDeg,
            withAberration.elevationDeg,
            sample.azimuthDeg,
            sample.elevationDeg,
          ) * 60,
        );
        maxTruthWithout = Math.max(
          maxTruthWithout,
          horizontalSeparationDeg(
            withoutAberration.azimuthDeg,
            withoutAberration.elevationDeg,
            sample.azimuthDeg,
            sample.elevationDeg,
          ) * 60,
        );
        maxEffect = Math.max(
          maxEffect,
          horizontalSeparationDeg(
            withAberration.azimuthDeg,
            withAberration.elevationDeg,
            withoutAberration.azimuthDeg,
            withoutAberration.elevationDeg,
          ) * 60,
        );
      }
    }
    console.log(
      `Aberration: max effect ${maxEffect.toFixed(3)}', max error with ${maxTruthWith.toFixed(3)}', without ${maxTruthWithout.toFixed(3)}'`,
    );
    expect(maxEffect).toBeGreaterThan(0.2);
    expect(maxEffect).toBeLessThan(0.6);
    expect(maxTruthWith).toBeLessThan(0.1);
    expect(maxTruthWithout).toBeGreaterThan(0.2);
  });

  it('puts Honolulu below the horizon at closest approach', () => {
    const honolulu = validation.observerTruth.find((s) => s.site.name.includes('Honolulu'));
    expect(honolulu).toBeDefined();
    const caSample = honolulu!.samples[3];
    const sky = computeTopocentric(ephem, honolulu!.site, new Date(jdToMs(caSample.jdUtc)));
    expect(sky.elevationDeg).toBeLessThan(0);
    expect(caSample.elevationDeg).toBeLessThan(0);
  });

  it('reports range and angular size at closest approach', () => {
    const brasov = validation.observerTruth[0];
    const caSample = brasov.samples[3];
    const sky = computeTopocentric(ephem, brasov.site, new Date(jdToMs(caSample.jdUtc)));
    console.log(
      `Brasov CA: az ${sky.azimuthDeg.toFixed(3)}°, el ${sky.elevationDeg.toFixed(3)}°, ` +
        `range ${sky.rangeKm.toFixed(1)} km, angular size ${sky.angularDiameterArcsec.toFixed(3)}″, ` +
        `V=${sky.magnitude.toFixed(3)}, rate ${sky.angularRateDegPerMin.toFixed(3)}°/min`,
    );
    expect(sky.rangeKm).toBeGreaterThan(30_000);
    expect(sky.rangeKm).toBeLessThan(40_000);
    expect(sky.angularDiameterArcsec).toBeGreaterThan(1.5);
    expect(sky.angularDiameterArcsec).toBeLessThan(2.5);
    expect(sky.angularRateDegPerMin).toBeGreaterThan(0);
  });

  it('applies Bennett refraction only when requested', () => {
    expect(refractedElevationDeg(0)).toBeGreaterThan(0.4);
    expect(refractedElevationDeg(0)).toBeLessThan(0.7);
    expect(refractedElevationDeg(20)).toBeGreaterThan(20);
    expect(refractedElevationDeg(20)).toBeLessThan(20.05);
    expect(refractedElevationDeg(-5)).toBe(-5);
  });
});
