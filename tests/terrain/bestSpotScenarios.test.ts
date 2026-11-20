import { describe, expect, it } from 'vitest';
import {
  HEIGHT_SCENARIOS,
  scaleDefaultBuildingHeights,
  searchBestSpots,
  searchBestSpotsSync,
  type BestSpotInput,
} from '../../src/terrain/bestSpot';
import { enuToLatLon } from '../../src/terrain/geo';
import type {
  ApophisPathSample,
  BestSpotCandidate,
  BestSpotResult,
  TerrainGrid,
} from '../../src/terrain/types';
import { sampleGridEnu } from '../../src/terrain/terrainGrid';
import { makeBuilding, makeGrid } from './helpers';

function pathAt(azimuthDeg: number, elevationDeg: number, count = 10): ApophisPathSample[] {
  return Array.from({ length: count }, (_, i) => ({
    utcMs: Date.parse('2029-04-13T22:00:00Z') + i * 60_000,
    azimuthDeg,
    elevationDeg,
    rangeKm: 38_000,
  }));
}

function candidateAt(
  grid: TerrainGrid,
  eastM: number,
  northM: number,
  index: number,
): BestSpotCandidate {
  const groundElevationM = sampleGridEnu(grid, eastM, northM);
  if (groundElevationM === null) {
    throw new Error(`candidate (${eastM}, ${northM}) is outside the grid`);
  }
  const latLon = enuToLatLon(
    eastM,
    northM,
    grid.originLatDeg,
    grid.originLonDeg,
  );
  return {
    index,
    eastM,
    northM,
    latitudeDeg: latLon.latitudeDeg,
    longitudeDeg: latLon.longitudeDeg,
    groundElevationM,
  };
}

function inputFor(
  grid: TerrainGrid,
  candidates: BestSpotCandidate[],
  buildings: BestSpotInput['buildings'],
  overrides: Partial<BestSpotInput> = {},
): BestSpotInput {
  return {
    grid,
    buildings,
    path: pathAt(0, 1),
    candidates,
    eyeHeightM: 1.7,
    marginDeg: 0,
    buildingRadiusM: 1_000,
    radiusM: 1_000,
    spacingM: 100,
    ...overrides,
  };
}

/**
 * Two candidates:
 *  - index 0 sits behind a default-height wall 1: blocked at 1.5x, clear at
 *    0.7x and at 1.0x;
 *  - index 1 sits behind a slightly lower explicit-height wall, so it wins on
 *    the pessimistic ranking but loses to index 0 on the base ranking.
 */
function scenarioFixture(): {
  input: BestSpotInput;
  defaultWall: ReturnType<typeof makeBuilding>;
  explicitWall: ReturnType<typeof makeBuilding>;
  grid: TerrainGrid;
} {
  const grid = makeGrid({ halfSizeM: 2_500, spacingM: 10 });
  const defaultWall = makeBuilding({
    id: 10,
    northM: 400,
    widthM: 400,
    depthM: 20,
    heightM: 8,
    heightSource: 'default',
  });
  const explicitWall = makeBuilding({
    id: 11,
    eastM: 500,
    northM: 400,
    widthM: 400,
    depthM: 20,
    heightM: 8.2,
    heightSource: 'height',
  });
  return {
    grid,
    defaultWall,
    explicitWall,
    input: inputFor(
      grid,
      [candidateAt(grid, 0, 0, 0), candidateAt(grid, 500, 0, 1)],
      [defaultWall, explicitWall],
    ),
  };
}

function scenarioSnapshot(result: BestSpotResult): Record<string, unknown> {
  return {
    index: result.index,
    score: result.score,
    scorePessimistic: result.scorePessimistic,
    scoreOptimistic: result.scoreOptimistic,
    clearSamples: result.clearSamples,
    clearSamplesPessimistic: result.clearSamplesPessimistic,
    clearSamplesOptimistic: result.clearSamplesOptimistic,
    minClearanceDeg: result.minClearanceDeg,
    minClearanceDegPessimistic: result.minClearanceDegPessimistic,
    minClearanceDegOptimistic: result.minClearanceDegOptimistic,
    rankPessimistic: result.rankPessimistic,
    rankBase: result.rankBase,
    rankOptimistic: result.rankOptimistic,
    rankSpread: result.rankSpread,
    nearestBuildingM: result.nearestBuildingM,
    nearestBuildingId: result.nearestBuildingId,
    nearestBuildingHeightSource: result.nearestBuildingHeightSource,
  };
}

describe('best-spot height scenarios', () => {
  it('scales default-height buildings and changes scores and ranks', () => {
    const { input, defaultWall, explicitWall } = scenarioFixture();
    const summary = searchBestSpotsSync(input);
    const behindDefault = summary.candidates[0];
    const behindExplicit = summary.candidates[1];

    // Base 8 m clears the 1 degree path; 12 m blocks it; 5.6 m clears it.
    expect(behindDefault.score).toBe(1);
    expect(behindDefault.scoreOptimistic).toBe(1);
    expect(behindDefault.scorePessimistic).toBe(0);
    expect(behindDefault.score - behindDefault.scorePessimistic).toBe(1);
    expect(behindDefault.minClearanceDegPessimistic).toBeLessThan(0);

    // Base ranking: the default wall is farther/lower than the explicit wall.
    expect(behindDefault.rankBase).toBe(1);
    expect(behindExplicit.rankBase).toBe(2);
    // Pessimistic ranking: only the default wall grows, so the order flips.
    expect(behindDefault.rankPessimistic).toBe(2);
    expect(behindExplicit.rankPessimistic).toBe(1);
    expect(behindDefault.rankSpread).toBe(1);
    expect(behindExplicit.rankSpread).toBe(1);

    // Input buildings are not mutated by scaling.
    expect(defaultWall.heightM).toBe(8);
    expect(explicitWall.heightM).toBe(8.2);
  });

  it('uses the pessimistic score as the primary top order', () => {
    const summary = searchBestSpotsSync(scenarioFixture().input);

    expect(summary.top.map((result) => result.index)).toEqual([1, 0]);
    expect(summary.top.map((result) => result.rankPessimistic)).toEqual([1, 2]);
    expect(summary.top[0].scorePessimistic).toBe(1);
    expect(summary.top[1].scorePessimistic).toBe(0);
    for (let i = 1; i < summary.top.length; i++) {
      expect(summary.top[i - 1].scorePessimistic).toBeGreaterThanOrEqual(
        summary.top[i].scorePessimistic,
      );
    }
    // Base and optimistic rankings are reported alongside the primary one.
    expect(summary.top[0].rankBase).toBe(2);
    expect(summary.top[0].rankOptimistic).toBe(2);
    expect(summary.heightScenarios.base.multiplier).toBe(1);
    expect(summary.heightScenarios.pessimistic.multiplier).toBe(1.5);
    expect(summary.heightScenarios.optimistic.multiplier).toBe(0.7);
    expect(summary.heightScenarios.pessimistic.label).toContain('1.5');
  });

  it('never scales explicit height or levels buildings', () => {
    const grid = makeGrid({ halfSizeM: 1_000, spacingM: 10 });
    const explicit = makeBuilding({
      id: 1,
      northM: 300,
      widthM: 100,
      depthM: 10,
      heightM: 12,
      heightSource: 'height',
    });
    const levels = makeBuilding({
      id: 2,
      eastM: 300,
      northM: 300,
      widthM: 100,
      depthM: 10,
      heightM: 30,
      heightSource: 'levels',
    });
    const scaled = scaleDefaultBuildingHeights([explicit, levels], 1.5);
    expect(scaled[0].heightM).toBe(12);
    expect(scaled[1].heightM).toBe(30);
    expect(explicit.heightM).toBe(12);
    expect(levels.heightM).toBe(30);

    const summary = searchBestSpotsSync(
      inputFor(
        grid,
        [
          candidateAt(grid, 0, 0, 0),
          candidateAt(grid, 300, 0, 1),
          candidateAt(grid, -300, 0, 2),
        ],
        [explicit, levels],
      ),
    );
    for (const result of summary.candidates) {
      expect(result.scorePessimistic).toBe(result.score);
      expect(result.scoreOptimistic).toBe(result.score);
      expect(result.clearSamplesPessimistic).toBe(result.clearSamples);
      expect(result.clearSamplesOptimistic).toBe(result.clearSamples);
      expect(result.minClearanceDegPessimistic).toBe(result.minClearanceDeg);
      expect(result.minClearanceDegOptimistic).toBe(result.minClearanceDeg);
    }
  });

  it('classifies blockers as terrain, real-height or default-height', () => {
    const flatGrid = makeGrid({ halfSizeM: 1_000, spacingM: 10 });
    const defaultWall = makeBuilding({
      id: 21,
      northM: 100,
      widthM: 100,
      depthM: 10,
      heightM: 8,
      heightSource: 'default',
    });
    const realWall = makeBuilding({
      id: 22,
      northM: 100,
      widthM: 100,
      depthM: 10,
      heightM: 20,
      heightSource: 'height',
    });

    const blockedByDefault = searchBestSpotsSync(
      inputFor(
        flatGrid,
        [candidateAt(flatGrid, 0, 0, 0)],
        [defaultWall],
      ),
    ).candidates[0];
    expect(blockedByDefault.score).toBe(0);
    expect(blockedByDefault.blockedByDefaultHeightBuildingSamples).toBe(10);
    expect(blockedByDefault.blockedByRealHeightBuildingSamples).toBe(0);
    expect(blockedByDefault.blockedByTerrainSamples).toBe(0);
    expect(blockedByDefault.blockerBuildingIds).toEqual([21]);
    expect(blockedByDefault.onlyDefaultHeightBlockers).toBe(true);

    const blockedByReal = searchBestSpotsSync(
      inputFor(flatGrid, [candidateAt(flatGrid, 0, 0, 0)], [realWall]),
    ).candidates[0];
    expect(blockedByReal.score).toBe(0);
    expect(blockedByReal.blockedByDefaultHeightBuildingSamples).toBe(0);
    expect(blockedByReal.blockedByRealHeightBuildingSamples).toBe(10);
    expect(blockedByReal.blockerBuildingIds).toEqual([22]);
    expect(blockedByReal.onlyDefaultHeightBlockers).toBe(false);

    const ridgeGrid = makeGrid({
      halfSizeM: 2_000,
      spacingM: 10,
      elevation: (_eastM, northM) =>
        northM >= 1_000 && northM <= 1_100 ? 100 : 0,
    });
    const blockedByTerrain = searchBestSpotsSync(
      inputFor(ridgeGrid, [candidateAt(ridgeGrid, 0, 0, 0)], []),
    ).candidates[0];
    expect(blockedByTerrain.score).toBe(0);
    expect(blockedByTerrain.firstBlockedSource).toBe('terrain');
    expect(blockedByTerrain.blockedByTerrainSamples).toBe(10);
    expect(blockedByTerrain.blockedByDefaultHeightBuildingSamples).toBe(0);
    expect(blockedByTerrain.blockedByRealHeightBuildingSamples).toBe(0);
    expect(blockedByTerrain.blockerBuildingIds).toEqual([]);
    expect(blockedByTerrain.onlyDefaultHeightBlockers).toBe(false);
  });

  it('computes exact nearest footprint distance, including 0 inside', () => {
    const grid = makeGrid({ halfSizeM: 1_000, spacingM: 10 });
    const square = makeBuilding({
      id: 31,
      eastM: 100,
      northM: 0,
      widthM: 20,
      depthM: 20,
      heightM: 3,
      heightSource: 'height',
    });
    const summary = searchBestSpotsSync(
      inputFor(
        grid,
        [candidateAt(grid, 0, 0, 0), candidateAt(grid, 100, 0, 1)],
        [square],
      ),
    );
    const outside = summary.candidates[0];
    const inside = summary.candidates[1];

    expect(outside.nearestBuildingM).toBe(90);
    expect(outside.nearestBuildingId).toBe(31);
    expect(outside.nearestBuildingHeightSource).toBe('height');
    expect(inside.nearestBuildingM).toBe(0);
    expect(inside.nearestBuildingId).toBe(31);
    expect(inside.insideBuildingId).toBe(31);
  });

  it('only computes nearest buildings for the top 10', () => {
    const grid = makeGrid({ halfSizeM: 2_000, spacingM: 10 });
    const building = makeBuilding({
      id: 41,
      northM: 100,
      widthM: 20,
      depthM: 10,
      heightM: 2,
      heightSource: 'height',
    });
    const candidates = Array.from({ length: 15 }, (_, i) =>
      candidateAt(grid, i * 100, 0, i),
    );
    const summary = searchBestSpotsSync(
      inputFor(grid, candidates, [building]),
    );
    expect(summary.top).toHaveLength(10);
    expect(
      summary.top.every((result) => result.nearestBuildingM !== null),
    ).toBe(true);
    const topIndexes = new Set(summary.top.map((result) => result.index));
    for (const result of summary.candidates) {
      if (topIndexes.has(result.index)) continue;
      expect(result.nearestBuildingM).toBeNull();
      expect(result.nearestBuildingId).toBeNull();
      expect(result.nearestBuildingHeightSource).toBeNull();
    }
  });

  it('returns score 1 under every scenario when there are no buildings', () => {
    const grid = makeGrid({ halfSizeM: 500, spacingM: 10 });
    const summary = searchBestSpotsSync(
      inputFor(grid, [candidateAt(grid, 0, 0, 0)], []),
    );
    const result = summary.candidates[0];
    expect(result.score).toBe(1);
    expect(result.scorePessimistic).toBe(1);
    expect(result.scoreOptimistic).toBe(1);
    expect(result.nearestBuildingM).toBeNull();
    expect(result.nearestBuildingId).toBeNull();
    expect(result.nearestBuildingHeightSource).toBeNull();
    expect(result.blockerBuildingIds).toEqual([]);
    expect(result.onlyDefaultHeightBlockers).toBe(false);
  });

  it('keeps cooperative cancellation in the async loop', async () => {
    const { input } = scenarioFixture();
    let checks = 0;
    const summary = await searchBestSpots(input, {
      shouldCancel: () => checks++ > 0,
      yieldEvery: 1,
    });
    expect(summary.cancelled).toBe(true);
    expect(summary.processed).toBe(1);
    expect(summary.candidates).toHaveLength(1);
    expect(summary.top).toHaveLength(1);
    expect(summary.top[0].rankPessimistic).toBe(1);
  });

  it('is reproducible, and sync and async produce identical scenario fields', async () => {
    const { input } = scenarioFixture();
    const first = searchBestSpotsSync(input);
    const second = searchBestSpotsSync(input);
    const asyncResult = await searchBestSpots(input, { yieldEvery: 1 });

    expect(second.top.map((result) => result.index)).toEqual(
      first.top.map((result) => result.index),
    );
    expect(second.top.map(scenarioSnapshot)).toEqual(
      first.top.map(scenarioSnapshot),
    );
    expect(second.candidates.map(scenarioSnapshot)).toEqual(
      first.candidates.map(scenarioSnapshot),
    );
    expect(asyncResult.top.map((result) => result.index)).toEqual(
      first.top.map((result) => result.index),
    );
    expect(asyncResult.top.map(scenarioSnapshot)).toEqual(
      first.top.map(scenarioSnapshot),
    );
    expect(asyncResult.candidates.map(scenarioSnapshot)).toEqual(
      first.candidates.map(scenarioSnapshot),
    );
    expect(asyncResult.heightScenarios).toEqual(first.heightScenarios);
    expect(HEIGHT_SCENARIOS.base.multiplier).toBe(1);
  });
});
