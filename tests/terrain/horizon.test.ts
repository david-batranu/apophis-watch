import { describe, expect, it } from 'vitest';
import {
  computeHorizonProfile,
  horizonElevationAtAzimuth,
} from '../../src/terrain/horizon';
import { EARTH_MEAN_RADIUS_M } from '../../src/terrain/geo';
import { FLAT_POINT, makeBuilding, makeGrid } from './helpers';

const drop = (distanceM: number): number =>
  (distanceM * distanceM) / (2 * EARTH_MEAN_RADIUS_M);

describe('horizon profile from synthetic terrain', () => {
  it('returns a slightly negative skyline for a flat plane with curvature', () => {
    const grid = makeGrid({ halfSizeM: 5_000, spacingM: 10 });
    const profile = computeHorizonProfile(grid, FLAT_POINT, [], {
      azimuthsDeg: [0, 90, 180, 270],
      stepDeg: 1,
      maxDistanceM: 5_000,
    });
    for (const sample of profile.samples) {
      const distance = sample.distanceM!;
      const expected =
        (Math.atan2(
          -(FLAT_POINT.eyeHeightM + drop(distance)),
          distance,
        ) *
          180) /
        Math.PI;
      expect(sample.elevationDeg).toBeCloseTo(expected, 4);
      expect(sample.source).toBe('terrain');
      // With curvature the geometric horizon is the tangent point at
      // sqrt(2 R h) ≈ 4.65 km for a 1.7 m eye, not the last ray sample.
      expect(sample.distanceM).toBeGreaterThan(4_600);
      expect(sample.distanceM).toBeLessThan(4_700);
      expect(sample.elevationDeg).toBeLessThan(-0.04);
    }
  });

  it('shows the curvature difference on a flat plane', () => {
    const grid = makeGrid({ halfSizeM: 5_000, spacingM: 10 });
    const curved = computeHorizonProfile(grid, FLAT_POINT, [], {
      azimuthsDeg: [0],
      maxDistanceM: 5_000,
      curvature: true,
    });
    const flat = computeHorizonProfile(grid, FLAT_POINT, [], {
      azimuthsDeg: [0],
      maxDistanceM: 5_000,
      curvature: false,
    });
    expect(curved.samples[0].elevationDeg).toBeLessThan(
      flat.samples[0].elevationDeg - 0.02,
    );
  });

  it('measures a known 10% uphill slope to the north', () => {
    const grid = makeGrid({
      halfSizeM: 5_000,
      spacingM: 10,
      elevation: (_east, north) => north * 0.1,
    });
    const profile = computeHorizonProfile(grid, FLAT_POINT, [], {
      azimuthsDeg: [0, 180],
      maxDistanceM: 5_000,
    });
    const north = profile.samples.find((sample) => sample.azimuthDeg === 0)!;
    const south = profile.samples.find((sample) => sample.azimuthDeg === 180)!;
    const northDistance = north.distanceM!;
    const southDistance = south.distanceM!;
    const northExpected =
      (Math.atan2(
        (north.topElevationM ?? 0) - FLAT_POINT.eyeHeightM - drop(northDistance),
        northDistance,
      ) *
        180) /
      Math.PI;
    const southExpected =
      (Math.atan2(
        (south.topElevationM ?? 0) - FLAT_POINT.eyeHeightM - drop(southDistance),
        southDistance,
      ) *
        180) /
      Math.PI;
    expect(north.elevationDeg).toBeCloseTo(northExpected, 4);
    expect(south.elevationDeg).toBeCloseTo(southExpected, 4);
    expect(north.elevationDeg).toBeGreaterThan(5.5);
    expect(south.elevationDeg).toBeLessThan(-5.5);
  });

  it('measures a known 2 m wall at 100 m and ignores it outside its azimuth span', () => {
    const grid = makeGrid({ halfSizeM: 2_000, spacingM: 5 });
    const wall = makeBuilding({
      northM: 100,
      widthM: 20,
      depthM: 4,
      heightM: 2,
    });
    const profile = computeHorizonProfile(grid, FLAT_POINT, [wall], {
      azimuthsDeg: [0, 10],
      maxDistanceM: 2_000,
      buildingMaxDistanceM: 500,
    });
    const centre = profile.samples.find((sample) => sample.azimuthDeg === 0)!;
    const side = profile.samples.find((sample) => sample.azimuthDeg === 10)!;
    const expected =
      (Math.atan2(2 - FLAT_POINT.eyeHeightM - drop(98), 98) * 180) /
      Math.PI;
    expect(centre.source).toBe('building');
    expect(centre.sourceId).toBe(1);
    expect(centre.elevationDeg).toBeCloseTo(expected, 3);
    expect(centre.elevationDeg).toBeGreaterThan(0.15);
    expect(side.source).toBe('terrain');
    expect(side.elevationDeg).toBeLessThan(0);
  });

  it('interpolates the 1-degree profile at intermediate azimuths', () => {
    const grid = makeGrid({ halfSizeM: 1_000, spacingM: 10 });
    const profile = computeHorizonProfile(grid, FLAT_POINT, [], {
      stepDeg: 1,
      maxDistanceM: 1_000,
    });
    const at0 = horizonElevationAtAzimuth(profile, 0)!;
    const at359 = horizonElevationAtAzimuth(profile, 359)!;
    const at3595 = horizonElevationAtAzimuth(profile, 359.5)!;
    expect(at3595).toBeCloseTo((at0 + at359) / 2, 6);
  });
});
