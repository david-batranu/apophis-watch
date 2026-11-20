import { describe, expect, it } from 'vitest';
import {
  observerSnapshot,
  computeTopocentric,
} from '../src/ephemeris/topocentric';
import { ephem } from './helpers';

describe('frozen shared interfaces', () => {
  it('guards the ObserverState shape', () => {
    const state = observerSnapshot(
      { latitudeDeg: 45.6427, longitudeDeg: 25.5887, elevationM: 600 },
      ephem.startJdTdb + 1,
    );
    expect(Object.keys(state).sort()).toEqual([
      'ecefKm',
      'eciKm',
      'jdTdb',
      'location',
    ]);
    expect(Object.keys(state.ecefKm).sort()).toEqual(['x', 'y', 'z']);
    expect(Object.keys(state.eciKm).sort()).toEqual(['x', 'y', 'z']);
  });

  it('guards the SkyPosition shape', () => {
    const sky = computeTopocentric(
      ephem,
      { latitudeDeg: 45.6427, longitudeDeg: 25.5887, elevationM: 600 },
      new Date('2029-04-13T21:45:03.557Z'),
    );
    expect(Object.keys(sky).sort()).toEqual([
      'angularDiameterArcsec',
      'angularRateDegPerMin',
      'azimuthDeg',
      'elevationDeg',
      'geometricElevationDeg',
      'heliocentricDistanceAu',
      'jdTdb',
      'magnitude',
      'observerDistanceAu',
      'phaseAngleDeg',
      'rangeKm',
      'rangeRateKmS',
      'refracted',
      'utc',
    ]);
  });

  it('guards the EphemerisProvider shape', () => {
    expect(typeof ephem.stateAtJdTdb).toBe('function');
    expect(typeof ephem.stateAtUtc).toBe('function');
    expect(ephem.startJdTdb).toBeLessThan(ephem.endJdTdb);
    expect(ephem.stepSeconds).toBe(60);
    expect(ephem.targetRadiusKm).toBeGreaterThan(0);
    expect(ephem.absoluteMagnitudeH).toBeGreaterThan(0);
    expect(ephem.slopeG).toBeGreaterThanOrEqual(0);
  });
});
