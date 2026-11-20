import { describe, expect, it } from 'vitest';
import {
  buildingAtPoint,
  gridCellEnu,
  gridCellLatLon,
  prepareBuildings,
  sampleGridEnu,
  sampleGridLatLon,
  sceneGroundElevationM,
  tallestBuildingAtPoint,
} from '../../src/terrain/terrainGrid';
import { latLonToEnu } from '../../src/terrain/geo';
import {
  lonLatToWorldPixel,
  pixelSpacingM,
  worldPixelToLonLat,
} from '../../src/terrain/mercator';
import type { BuildingFeature, TerrainGrid } from '../../src/terrain/types';

function makeTileAlignedGrid(size = 16): TerrainGrid {
  const zoom = 14;
  const xMin = 9_353;
  const yMin = 5_848;
  const center = worldPixelToLonLat(
    xMin * 256 + size / 2 + 0.5,
    yMin * 256 + size / 2 + 0.5,
    zoom,
  );
  const corner = worldPixelToLonLat(xMin * 256 + 0.5, yMin * 256 + 0.5, zoom);
  const cornerEnu = latLonToEnu(
    corner.latitudeDeg,
    corner.longitudeDeg,
    center.latitudeDeg,
    center.longitudeDeg,
  );
  const spacing = pixelSpacingM(center.latitudeDeg, zoom);
  const elevations = new Float32Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      elevations[row * size + col] = 600 + col * 10 + row;
    }
  }
  return {
    zoom,
    width: size,
    height: size,
    elevations,
    spacingM: (spacing.eastM + spacing.northM) / 2,
    spacingEastM: spacing.eastM,
    spacingNorthM: spacing.northM,
    eastOriginM: cornerEnu.eastM,
    northOriginM: cornerEnu.northM,
    originLatDeg: center.latitudeDeg,
    originLonDeg: center.longitudeDeg,
    observerGroundElevationM: elevations[(size / 2) * size + size / 2],
    tileRange: { xMin, xMax: xMin, yMin, yMax: yMin },
    bbox: { south: 45.5, west: 25.5, north: 45.7, east: 25.7 },
    requestedTiles: 1,
    cachedTiles: 1,
    networkTiles: 0,
    failedTiles: 0,
    createdAt: 1,
  };
}

function makeCapeTownSlopedGrid(size = 512, gradientE = 20, gradientN = 14): TerrainGrid {
  const zoom = 14;
  const lat = -33.9249;
  const lon = 18.4241;
  const world = lonLatToWorldPixel(lat, lon, zoom);
  const xMin = Math.floor((world.x - size / 2) / 256);
  const yMin = Math.floor((world.y - size / 2) / 256);
  const center = worldPixelToLonLat(
    xMin * 256 + size / 2 + 0.5,
    yMin * 256 + size / 2 + 0.5,
    zoom,
  );
  const corner = worldPixelToLonLat(xMin * 256 + 0.5, yMin * 256 + 0.5, zoom);
  const cornerEnu = latLonToEnu(
    corner.latitudeDeg,
    corner.longitudeDeg,
    center.latitudeDeg,
    center.longitudeDeg,
  );
  const spacing = pixelSpacingM(center.latitudeDeg, zoom);
  const elevations = new Float32Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      elevations[row * size + col] = 10 + col * gradientE + row * gradientN;
    }
  }
  const grid: TerrainGrid = {
    zoom,
    width: size,
    height: size,
    elevations,
    spacingM: (spacing.eastM + spacing.northM) / 2,
    spacingEastM: spacing.eastM,
    spacingNorthM: spacing.northM,
    eastOriginM: cornerEnu.eastM,
    northOriginM: cornerEnu.northM,
    originLatDeg: center.latitudeDeg,
    originLonDeg: center.longitudeDeg,
    observerGroundElevationM: 0,
    tileRange: { xMin, xMax: xMin, yMin, yMax: yMin },
    bbox: { south: -34.1, west: 18.2, north: -33.7, east: 18.6 },
    requestedTiles: 1,
    cachedTiles: 0,
    networkTiles: 1,
    failedTiles: 0,
    createdAt: 1,
  };
  const mercator = sampleGridLatLon(grid, center.latitudeDeg, center.longitudeDeg);
  grid.observerGroundElevationM = mercator ?? Number.NaN;
  return grid;
}

describe('terrain grid sampling', () => {
  it('samples cell centres in local ENU and geodetic coordinates', () => {
    const grid = makeTileAlignedGrid(16);
    for (const [col, row] of [
      [0, 0],
      [4, 3],
      [9, 9],
      [15, 15],
    ]) {
      const expected = grid.elevations[row * grid.width + col];
      const enu = gridCellEnu(grid, col, row);
      expect(sampleGridEnu(grid, enu.eastM, enu.northM)).toBeCloseTo(expected, 3);
      const latLon = gridCellLatLon(grid, col, row);
      expect(
        sampleGridLatLon(grid, latLon.latitudeDeg, latLon.longitudeDeg),
      ).toBeCloseTo(expected, 2);
    }
  });

  it('returns null outside the grid rectangle', () => {
    const grid = makeTileAlignedGrid(8);
    expect(sampleGridEnu(grid, 1e9, 0)).toBeNull();
    expect(sampleGridEnu(grid, 0, -1e9)).toBeNull();
  });

  it('anchors the local scene on the ENU sample, not the Mercator observer sample', () => {
    const grid = makeCapeTownSlopedGrid();
    const mercator = sampleGridLatLon(
      grid,
      grid.originLatDeg,
      grid.originLonDeg,
    )!;
    const enu = sampleGridEnu(grid, 0, 0)!;
    expect(Number.isFinite(mercator)).toBe(true);
    expect(Number.isFinite(enu)).toBe(true);
    // At Cape Town the constant-spacing ENU grid and the Mercator pixel
    // sample differ by ~0.9 m on this deliberately steep synthetic slope.
    expect(Math.abs(mercator - enu)).toBeGreaterThan(0.5);
    expect(grid.observerGroundElevationM).toBeCloseTo(mercator, 3);
    expect(sceneGroundElevationM(grid)).toBeCloseTo(enu, 6);
    expect(Math.abs(sceneGroundElevationM(grid) - grid.observerGroundElevationM)).toBeGreaterThan(
      0.5,
    );
  });

  it('prepares building rings in ENU with a conservative base elevation', () => {
    const grid = makeTileAlignedGrid(16);
    const center = gridCellLatLon(grid, 8, 8);
    const ring = [
      { lat: center.latitudeDeg - 0.00005, lon: center.longitudeDeg - 0.00005 },
      { lat: center.latitudeDeg - 0.00005, lon: center.longitudeDeg + 0.00005 },
      { lat: center.latitudeDeg + 0.00005, lon: center.longitudeDeg + 0.00005 },
      { lat: center.latitudeDeg + 0.00005, lon: center.longitudeDeg - 0.00005 },
    ];
    const feature: BuildingFeature = {
      id: 42,
      ring,
      heightM: 18,
      heightSource: 'levels',
      levels: 6,
      tags: { building: 'yes' },
    };
    const prepared = prepareBuildings(grid, [feature]);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].ringEnu).toHaveLength(4);
    expect(prepared[0].baseElevationM).toBeGreaterThan(600);
    expect(
      prepared[0].baseElevationM,
    ).toBeGreaterThanOrEqual(grid.observerGroundElevationM);
    const centreEnu = gridCellEnu(grid, 8, 8);
    expect(buildingAtPoint(prepared, centreEnu.eastM, centreEnu.northM)?.id).toBe(
      42,
    );
    expect(tallestBuildingAtPoint(prepared, centreEnu.eastM, centreEnu.northM)?.id).toBe(
      42,
    );
    expect(buildingAtPoint(prepared, 1e9, 1e9)).toBeNull();
  });
});
