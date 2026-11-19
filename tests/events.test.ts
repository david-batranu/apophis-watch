import { describe, expect, it } from 'vitest';
import {
  computeVisibility,
  findAltitudeEvents,
  findClosestApproach,
  findTopocentricClosestApproach,
  sunAltitudeDeg,
} from '../src/ephemeris/events';
import {
  apparentHorizontalAtJd,
  computeTopocentric,
} from '../src/ephemeris/topocentric';
import { ephem, validation } from './helpers';

describe('close approach and visibility', () => {
  it('derives geocentric CA within 2 s of independent Horizons truth', () => {
    const ca = findClosestApproach(ephem);
    const truthMs = Date.parse(validation.closestApproachTruth.refinedUtc);
    console.log(
      `Geocentric CA: UTC ${ca.utc.toISOString()}, TDB JD ${ca.jdTdb.toFixed(9)}, ` +
        `${ca.geocentricDistanceKm.toFixed(3)} km from centre, ` +
        `${ca.surfaceDistanceKm.toFixed(3)} km above the WGS84 surface; ` +
        `sub-point ${ca.subPointLatDeg.toFixed(3)}, ${ca.subPointLonDeg.toFixed(3)}`,
    );
    expect(Math.abs(ca.utc.getTime() - truthMs)).toBeLessThan(2000);
    expect(Math.abs(ca.geocentricDistanceKm - validation.closestApproachTruth.geocentricDistanceKm)).toBeLessThan(0.2);
    expect(ca.geocentricDistanceKm).toBeGreaterThan(37_900);
    expect(ca.geocentricDistanceKm).toBeLessThan(38_100);
    expect(ca.surfaceDistanceKm).toBeGreaterThan(31_500);
    expect(ca.surfaceDistanceKm).toBeLessThan(31_800);
    expect(ca.surfaceUtc).toBeInstanceOf(Date);
    expect(Math.abs(ca.surfaceJdTdb - ca.jdTdb) * 24 * 60).toBeLessThan(10);
    expect(ca.surfaceRadiusKm).toBeGreaterThan(6_350);
    expect(ca.surfaceRadiusKm).toBeLessThan(6_400);
    expect(ca.surfaceDistanceKm + ca.surfaceRadiusKm).toBeGreaterThan(37_900);
    expect(ca.surfaceDistanceKm + ca.surfaceRadiusKm).toBeLessThan(38_100);
    // Independent verifier values at the surface minimum. The longitude is
    // Earth-fixed; using ICRF would give ~+125 deg (off by GAST).
    expect(ca.subPointLatDeg).toBeCloseTo(28.9823, 2);
    expect(ca.subPointLonDeg).toBeCloseTo(-43.1042, 2);
    expect(ca.surfaceRadiusKm).toBeCloseTo(6373.1485, 2);
    expect(ca.surfaceDistanceKm).toBeCloseTo(31638.196, 1);
    expect(ca.subPointLonDeg).toBeLessThan(0);
  });

  it('derives topocentric CA for Brasov and matches the 10 s Horizons truth', () => {
    const site = validation.topocentricClosestApproachTruth.site;
    const topo = findTopocentricClosestApproach(ephem, site);
    const truthMs = Date.parse(validation.topocentricClosestApproachTruth.refinedUtc);
    const geocentric = findClosestApproach(ephem);
    const offsetSeconds = (topo.utc.getTime() - geocentric.utc.getTime()) / 1000;
    console.log(
      `Topocentric CA (${site.name}): UTC ${topo.utc.toISOString()}, TDB JD ${topo.jdTdb.toFixed(9)}, ` +
        `range ${topo.rangeKm.toFixed(3)} km, ${offsetSeconds.toFixed(1)} s from geocentric CA`,
    );
    // The range minimum is shallow, but the fine 10 s truth lets us require
    // agreement within 2 s (actual ~0.09 s); this catches a copied
    // geocentric time or a sloppy minimiser.
    expect(Math.abs(topo.utc.getTime() - truthMs)).toBeLessThan(2000);
    expect(Math.abs(topo.rangeKm - validation.topocentricClosestApproachTruth.rangeKm)).toBeLessThan(0.1);
    expect(offsetSeconds).toBeLessThan(-120);
    expect(offsetSeconds).toBeGreaterThan(-900);
    expect(topo.rangeKm).toBeLessThan(geocentric.geocentricDistanceKm);
  });

  it('finds a visible dark-sky window at Brasov', () => {
    const ca = findClosestApproach(ephem);
    const result = computeVisibility(ephem, validation.observerTruth[0].site, ca.jdTdb, {
      startJdTdb: ca.jdTdb - 0.5,
      endJdTdb: ca.jdTdb + 0.5,
      stepSeconds: 120,
    });
    console.log(
      `Brasov visibility: ${result.intervals.length} interval(s), ` +
        `max el ${result.maxElevationDeg.toFixed(2)}° at ${result.maxElevationUtc?.toISOString()}, ` +
        `Moon ${(result.moon.illuminationFraction * 100).toFixed(1)}% at ${result.moon.separationDeg.toFixed(1)}° separation`,
    );
    expect(result.intervals.length).toBe(2);
    expect(result.maxElevationDeg).toBeGreaterThan(20);
    for (const interval of result.intervals) {
      expect(interval.endJdTdb).toBeGreaterThan(interval.startJdTdb);
      expect(interval.startUtc).toBeInstanceOf(Date);
      // A visibility boundary must sit on one of the two thresholds:
      // Apophis elevation = 0 or Sun altitude = -6.
      for (const jd of [interval.startJdTdb, interval.endJdTdb]) {
        const alt = apparentHorizontalAtJd(
          ephem,
          validation.observerTruth[0].site,
          jd,
        ).geometricElevationDeg;
        const sun = sunAltitudeDeg(validation.observerTruth[0].site, jd);
        expect(Math.min(Math.abs(alt), Math.abs(sun + 6))).toBeLessThan(0.01);
      }
    }
    const mid = (result.intervals[0].startJdTdb + result.intervals[0].endJdTdb) / 2;
    const sky = computeTopocentric(ephem, validation.observerTruth[0].site, result.moon.utc);
    expect(mid).toBeGreaterThan(ca.jdTdb - 1);
    expect(sky.angularDiameterArcsec).toBeGreaterThan(0);
    // Independent verifier values at the reference time (longest interval
    // midpoint): 0.1814% illuminated, 148.572 deg separation, phase 175.118.
    expect(result.moon.illuminationFraction).toBeCloseTo(0.001814, 5);
    expect(result.moon.separationDeg).toBeCloseTo(148.572, 1);
    expect(result.moon.phaseAngleDeg).toBeCloseTo(175.118, 1);
  });

  it('explains that Longyearbyen never gets a Sun-below-minus-6-degree window', () => {
    const site = validation.observerTruth.find((s) => s.site.name.includes('Longyearbyen'))!.site;
    const ca = findClosestApproach(ephem);
    const result = computeVisibility(ephem, site, ca.jdTdb, {
      startJdTdb: ca.jdTdb - 0.5,
      endJdTdb: ca.jdTdb + 0.5,
      stepSeconds: 300,
    });
    console.log(`Longyearbyen visibility: ${result.reason}`);
    expect(result.intervals.length).toBe(0);
    expect(result.reason).toMatch(/Sun/i);
  });

  it('finds altitude events and the highest point of the pass', () => {
    const ca = findClosestApproach(ephem);
    const events = findAltitudeEvents(
      ephem,
      validation.observerTruth[0].site,
      ca.jdTdb - 0.5,
      ca.jdTdb + 0.5,
      60,
      ca.jdTdb,
    );
    expect(events.maxElevationDeg).toBeGreaterThan(20);
    expect(events.transitJdTdb).not.toBeNull();
    expect(events.riseJdTdb).not.toBeNull();
    expect(events.setJdTdb).not.toBeNull();
    if (events.riseJdTdb !== null && events.setJdTdb !== null) {
      expect(events.setJdTdb).toBeGreaterThan(events.riseJdTdb);
    }
  });
});
