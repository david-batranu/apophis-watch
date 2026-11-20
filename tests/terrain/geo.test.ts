import { describe, expect, it } from 'vitest';
import {
  EARTH_MEAN_RADIUS_M,
  elevationAngleDeg,
  enuToLatLon,
  latLonToEnu,
  parallaxArcsec,
  pointInPolygon,
  triangulatePolygon,
} from '../../src/terrain/geo';
import {
  chooseTerrainZoom,
  groundResolutionM,
  lonLatToWorldPixel,
  pixelSpacingM,
  tileRangeForBbox,
  worldPixelToLonLat,
} from '../../src/terrain/mercator';

const BRASOV = { lat: 45.6427, lon: 25.5887 };

describe('local ENU projection', () => {
  it('round-trips 1 km and 10 km offsets to sub-metre accuracy', () => {
    for (const [east, north] of [
      [1_000, 0],
      [0, 1_000],
      [7_000, -4_000],
      [-9_000, 3_000],
    ]) {
      const latLon = enuToLatLon(east, north, 45, 25);
      const back = latLonToEnu(
        latLon.latitudeDeg,
        latLon.longitudeDeg,
        45,
        25,
      );
      expect(back.eastM).toBeCloseTo(east, 1);
      expect(back.northM).toBeCloseTo(north, 1);
    }
  });

  it('agrees with WGS84 radii at the origin', () => {
    const oneDegreeNorth = latLonToEnu(46, 25, 45, 25);
    expect(oneDegreeNorth.northM).toBeGreaterThan(111_000);
    expect(oneDegreeNorth.northM).toBeLessThan(111_300);
    const oneDegreeEast = latLonToEnu(45, 26, 45, 25);
    expect(oneDegreeEast.eastM).toBeGreaterThan(78_000);
    expect(oneDegreeEast.eastM).toBeLessThan(79_000);
  });
});

describe('Earth curvature and parallax', () => {
  it('uses the spherical sagitta R(1-cos(d/R))', () => {
    const drop5 = EARTH_MEAN_RADIUS_M * (1 - Math.cos(5_000 / EARTH_MEAN_RADIUS_M));
    const drop10 = EARTH_MEAN_RADIUS_M * (1 - Math.cos(10_000 / EARTH_MEAN_RADIUS_M));
    expect(drop5).toBeCloseTo(1.962, 2);
    expect(drop10).toBeCloseTo(7.849, 2);
    // The usual d²/2R approximation is within 1 mm at these distances.
    expect(Math.abs(drop10 - (10_000 * 10_000) / (2 * EARTH_MEAN_RADIUS_M))).toBeLessThan(
      0.001,
    );
  });

  it('makes a flat plane dip below the tangent plane', () => {
    const angle = elevationAngleDeg(0, 2, 5_000);
    expect(angle).toBeCloseTo(
      (Math.atan2(-(2 + 1.9619), 5_000) * 180) / Math.PI,
      3,
    );
    expect(angle).toBeLessThan(-0.04);
  });

  it('reports the 5 km parallax at Apophis ranges', () => {
    expect(parallaxArcsec(5, 38_011.344)).toBeCloseTo(27.132, 2);
    expect(parallaxArcsec(5, 34_591.437)).toBeCloseTo(29.814, 2);
    // 5 km / 38,000 km ≈ 1.32e-4 rad.
    expect(parallaxArcsec(5, 38_000)).toBeGreaterThan(26);
    expect(parallaxArcsec(5, 38_000)).toBeLessThan(28);
  });
});

describe('Web Mercator tile maths', () => {
  it('has the standard ground resolution at the equator', () => {
    expect(groundResolutionM(0, 0)).toBeCloseTo(156_543.0339, 3);
    expect(groundResolutionM(0, 1)).toBeCloseTo(78_271.5169, 3);
  });

  it('round-trips Brasov through world pixels', () => {
    const pixel = lonLatToWorldPixel(BRASOV.lat, BRASOV.lon, 14);
    const back = worldPixelToLonLat(pixel.x, pixel.y, 14);
    expect(back.latitudeDeg).toBeCloseTo(BRASOV.lat, 9);
    expect(back.longitudeDeg).toBeCloseTo(BRASOV.lon, 9);
  });

  it('chooses z14 and 64 tiles for a 6 km radius at Brasov', () => {
    const choice = chooseTerrainZoom(BRASOV.lat, BRASOV.lon, 6_000, 64);
    expect(choice.zoom).toBe(14);
    expect(choice.tileCount).toBe(64);
    expect(choice.resolutionM).toBeCloseTo(6.6799, 3);
    expect(choice.tileRange).toEqual({
      xMin: 9_353,
      xMax: 9_360,
      yMin: 5_848,
      yMax: 5_855,
    });
  });

  it('keeps east and north pixel scales within 0.5% of each other', () => {
    const spacing = pixelSpacingM(BRASOV.lat, 14);
    expect(spacing.eastM).toBeCloseTo(6.6914, 3);
    expect(spacing.northM).toBeCloseTo(6.6694, 3);
    expect(
      Math.abs(spacing.eastM - spacing.northM) / spacing.eastM,
    ).toBeLessThan(0.005);
  });

  it('computes a tile range covering a bbox', () => {
    const range = tileRangeForBbox(
      { south: 45.55, west: 25.5, north: 45.73, east: 25.68 },
      14,
    );
    expect(range.xMin).toBeLessThanOrEqual(9_353);
    expect(range.xMax).toBeGreaterThanOrEqual(9_360);
    expect(range.yMin).toBeLessThanOrEqual(5_848);
    expect(range.yMax).toBeGreaterThanOrEqual(5_855);
  });
});

describe('polygon helpers', () => {
  const ring = [
    { eastM: 0, northM: 0 },
    { eastM: 10, northM: 0 },
    { eastM: 10, northM: 10 },
    { eastM: 0, northM: 10 },
  ];

  it('detects points inside and outside a footprint', () => {
    expect(pointInPolygon(5, 5, ring)).toBe(true);
    expect(pointInPolygon(15, 5, ring)).toBe(false);
  });

  it('normalises a clockwise concave L-ring before ear clipping', () => {
    // Same 8 x 8 L-shape as below, but wound clockwise.
    const clockwise = [
      { eastM: 0, northM: 0 },
      { eastM: 0, northM: 10 },
      { eastM: 4, northM: 10 },
      { eastM: 4, northM: 4 },
      { eastM: 10, northM: 4 },
      { eastM: 10, northM: 0 },
    ];
    const triangles = triangulatePolygon(clockwise);
    expect(triangles.length / 3).toBe(4);
    let area = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = clockwise[triangles[i]];
      const b = clockwise[triangles[i + 1]];
      const c = clockwise[triangles[i + 2]];
      const signed =
        (b.eastM - a.eastM) * (c.northM - a.northM) -
        (c.eastM - a.eastM) * (b.northM - a.northM);
      expect(signed).toBeGreaterThan(0);
      area += signed / 2;
    }
    expect(area).toBeCloseTo(64, 6);
  });

  it('triangulates a concave footprint without losing area', () => {
    const lShape = [
      { eastM: 0, northM: 0 },
      { eastM: 10, northM: 0 },
      { eastM: 10, northM: 4 },
      { eastM: 4, northM: 4 },
      { eastM: 4, northM: 10 },
      { eastM: 0, northM: 10 },
    ];
    const triangles = triangulatePolygon(lShape);
    expect(triangles.length).toBeGreaterThanOrEqual(12);
    let area = 0;
    for (let i = 0; i < triangles.length; i += 3) {
      const a = lShape[triangles[i]];
      const b = lShape[triangles[i + 1]];
      const c = lShape[triangles[i + 2]];
      area +=
        Math.abs(
          (b.eastM - a.eastM) * (c.northM - a.northM) -
            (c.eastM - a.eastM) * (b.northM - a.northM),
        ) / 2;
    }
    expect(area).toBeCloseTo(64, 6);
  });
});
