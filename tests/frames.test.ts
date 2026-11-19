import { describe, expect, it } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import { astroTimeFromJdTdb, jdTdbFromDate } from '../src/core/time';
import { ecefToEqj, eqjToEcef, eqjToEqd } from '../src/ephemeris/frames';
import {
  ecefToGeodetic,
  geodeticToEcef,
  WGS84_A_KM,
  WGS84_B_KM,
} from '../src/ephemeris/wgs84';
import { norm, sub, vec3, type Vec3 } from '../src/core/vec3';

const SITES = [
  { latitudeDeg: 45.6427, longitudeDeg: 25.5887, elevationM: 600 },
  { latitudeDeg: -33.9249, longitudeDeg: 18.4241, elevationM: 15 },
  { latitudeDeg: 78.2232, longitudeDeg: 15.6469, elevationM: 10 },
];

describe('WGS84 observer geometry', () => {
  it('has the correct ellipsoid axes', () => {
    const equator = geodeticToEcef({ latitudeDeg: 0, longitudeDeg: 0, elevationM: 0 });
    const pole = geodeticToEcef({ latitudeDeg: 90, longitudeDeg: 0, elevationM: 0 });
    expect(equator.x).toBeCloseTo(WGS84_A_KM, 6);
    expect(pole.z).toBeCloseTo(WGS84_B_KM, 6);
  });

  it('round-trips geodetic -> ECEF -> geodetic to sub-millimetre', () => {
    for (const site of SITES) {
      const back = ecefToGeodetic(geodeticToEcef(site));
      expect(back.latitudeDeg).toBeCloseTo(site.latitudeDeg, 7);
      expect(Math.abs(back.longitudeDeg - site.longitudeDeg)).toBeLessThan(1e-7);
      expect(Math.abs(back.elevationM - site.elevationM)).toBeLessThan(0.001);
    }
  });

  it('matches astronomy-engine WGS84 observer vectors at 2029 epoch', () => {
    const date = new Date('2029-04-13T21:45:03.557Z');
    const time = astroTimeFromJdTdb(jdTdbFromDate(date));
    let worstM = 0;
    for (const site of SITES) {
      const ours = ecefToEqj(geodeticToEcef(site), time);
      const astro = Astronomy.ObserverVector(
        time,
        new Astronomy.Observer(site.latitudeDeg, site.longitudeDeg, site.elevationM),
        false,
      );
      const theirs: Vec3 = {
        x: astro.x * Astronomy.KM_PER_AU,
        y: astro.y * Astronomy.KM_PER_AU,
        z: astro.z * Astronomy.KM_PER_AU,
      };
      worstM = Math.max(worstM, norm(sub(ours, theirs)) * 1000);
    }
    console.log(`WGS84/EQJ observer agreement: worst ${worstM.toFixed(3)} m`);
    expect(worstM).toBeLessThan(1);
  });

  it('uses astronomy-engine rotation matrices in the correct direction', () => {
    const date = new Date('2029-04-13T21:45:03.557Z');
    const time = astroTimeFromJdTdb(jdTdbFromDate(date));
    const v = vec3(1, 0, 0);
    const ours = eqjToEqd(v, time);
    const theirs = Astronomy.RotateVector(
      Astronomy.Rotation_EQJ_EQD(time),
      new Astronomy.Vector(v.x, v.y, v.z, time),
    );
    expect(ours.x).toBeCloseTo(theirs.x, 12);
    expect(ours.y).toBeCloseTo(theirs.y, 12);
    expect(ours.z).toBeCloseTo(theirs.z, 12);
    // A transposed application would be ~0.012 rad (0.7 deg) wrong in 2029.
    expect(Math.abs(ours.y - theirs.y)).toBeLessThan(1e-10);
    expect(Math.abs(ours.y)).toBeGreaterThan(1e-4);
  });

  it('round-trips ICRF <-> Earth-fixed at the metre level', () => {
    const date = new Date('2029-04-13T21:45:03.557Z');
    const time = astroTimeFromJdTdb(jdTdbFromDate(date));
    for (const site of SITES) {
      const ecef = geodeticToEcef(site);
      const back = eqjToEcef(ecefToEqj(ecef, time), time);
      expect(norm(sub(back, ecef)) * 1000).toBeLessThan(0.001);
    }
  });
});
