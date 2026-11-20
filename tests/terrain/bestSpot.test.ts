import { describe, expect, it } from 'vitest';
import {
  formatClearPercent,
  generateSearchCandidates,
  heatmapColor,
  searchBestSpotsSync,
  type BestSpotInput,
} from '../../src/terrain/bestSpot';
import { describeBestSpot } from '../../src/terrain/bestSpotText';
import type { ApophisPathSample, BestSpotResult } from '../../src/terrain/types';
import { makeBuilding, makeGrid } from './helpers';

function pathAt(azimuthDeg: number, elevationDeg: number, count = 10): ApophisPathSample[] {
  return Array.from({ length: count }, (_, i) => ({
    utcMs: Date.parse('2029-04-13T22:00:00Z') + i * 60_000,
    azimuthDeg,
    elevationDeg,
    rangeKm: 38_000,
  }));
}

function baseInput(overrides: Partial<BestSpotInput> = {}): BestSpotInput {
  const grid = overrides.grid ?? makeGrid({ halfSizeM: 2_500, spacingM: 10 });
  return {
    grid,
    buildings: [],
    path: pathAt(0, 1),
    candidates: generateSearchCandidates(grid, 1_000, 100),
    eyeHeightM: 1.7,
    marginDeg: 0,
    buildingRadiusM: 1_000,
    radiusM: 1_000,
    spacingM: 100,
    ...overrides,
  };
}

function makeResult(overrides: Partial<BestSpotResult> = {}): BestSpotResult {
  return {
    index: 1,
    eastM: 0,
    northM: 0,
    latitudeDeg: 45,
    longitudeDeg: 25,
    groundElevationM: 600,
    score: 0.5,
    clearSamples: 50,
    totalSamples: 100,
    minClearanceDeg: 1.2,
    maxObstructionDeg: 0.1,
    firstBlockedUtcMs: Date.parse('2029-04-13T22:10:00Z'),
    firstBlockedAzimuthDeg: 90,
    firstBlockedElevationDeg: 1.3,
    firstBlockedHorizonDeg: 0.1,
    firstBlockedSource: 'terrain',
    firstBlockedSourceId: null,
    firstBlockedDistanceM: 800,
    insideBuildingId: null,
    scorePessimistic: 0.5,
    scoreOptimistic: 0.5,
    clearSamplesPessimistic: 50,
    clearSamplesOptimistic: 50,
    minClearanceDegPessimistic: 1.2,
    minClearanceDegOptimistic: 1.2,
    rankPessimistic: 1,
    rankBase: 1,
    rankOptimistic: 1,
    rankSpread: 0,
    blockedByTerrainSamples: 0,
    blockedByRealHeightBuildingSamples: 0,
    blockedByDefaultHeightBuildingSamples: 0,
    blockerBuildingIds: [],
    onlyDefaultHeightBlockers: false,
    nearestBuildingM: null,
    nearestBuildingId: null,
    nearestBuildingHeightSource: null,
    ...overrides,
  };
}

describe('best-spot scoring', () => {
  it('scores a clear candidate at 100% and a building-blocked candidate at 0%', () => {
    const wall = makeBuilding({
      northM: 500,
      widthM: 400,
      depthM: 20,
      heightM: 20,
    });
    const summary = searchBestSpotsSync(
      baseInput({ buildings: [wall] }),
    );
    const centre = summary.candidates.find(
      (candidate) => candidate.eastM === 0 && candidate.northM === 0,
    )!;
    const east = summary.candidates.find(
      (candidate) => candidate.eastM === 500 && candidate.northM === 0,
    )!;
    expect(centre.score).toBe(0);
    expect(centre.firstBlockedSource).toBe('building');
    expect(centre.firstBlockedSourceId).toBe(wall.id);
    expect(centre.firstBlockedAzimuthDeg).toBe(0);
    expect(centre.firstBlockedElevationDeg).toBe(1);
    expect(centre.firstBlockedHorizonDeg).toBeGreaterThan(2);
    expect(east.score).toBe(1);
    expect(summary.top[0].score).toBe(1);
    expect(summary.pathSamples).toBe(10);
  });

  it('applies the user minimum elevation margin', () => {
    const lowWall = makeBuilding({
      northM: 100,
      widthM: 80,
      depthM: 4,
      heightM: 2,
    });
    const candidates = generateSearchCandidates(makeGrid(), 0, 100);
    const one = candidates[0];
    const strict = searchBestSpotsSync(
      baseInput({
        grid: makeGrid({ halfSizeM: 500, spacingM: 5 }),
        buildings: [lowWall],
        candidates: [one],
        marginDeg: 1,
      }),
    );
    const relaxed = searchBestSpotsSync(
      baseInput({
        grid: makeGrid({ halfSizeM: 500, spacingM: 5 }),
        buildings: [lowWall],
        candidates: [one],
        marginDeg: 0.5,
      }),
    );
    expect(strict.candidates[0].score).toBe(0);
    expect(relaxed.candidates[0].score).toBe(1);
  });

  it('is reproducible for identical inputs', () => {
    const wall = makeBuilding({
      northM: 500,
      widthM: 400,
      depthM: 20,
      heightM: 20,
    });
    const input = baseInput({ buildings: [wall] });
    const a = searchBestSpotsSync(input);
    const b = searchBestSpotsSync(input);
    expect(a.candidates.map((candidate) => [candidate.index, candidate.score])).toEqual(
      b.candidates.map((candidate) => [candidate.index, candidate.score]),
    );
    expect(
      a.top.map((candidate) => [
        candidate.index,
        candidate.score,
        candidate.minClearanceDeg,
      ]),
    ).toEqual(
      b.top.map((candidate) => [
        candidate.index,
        candidate.score,
        candidate.minClearanceDeg,
      ]),
    );
  });

  it('marks a search with no physical visibility window as empty', () => {
    const summary = searchBestSpotsSync(baseInput({ path: [] }));
    expect(summary.noVisibilityWindow).toBe(true);
    expect(summary.top.every((result) => result.score === 0)).toBe(true);
    expect(describeBestSpot(summary.candidates[0])).toContain(
      'Apophis is not visible from this location during the pass',
    );
  });

  it('cancels cooperatively and reports partial progress', () => {
    const input = baseInput();
    const summary = searchBestSpotsSync(input, {
      shouldCancel: () => true,
    });
    expect(summary.cancelled).toBe(true);
    expect(summary.processed).toBeLessThan(input.candidates.length);
  });

  it('generates a circular grid and skips points outside the DEM', () => {
    const grid = makeGrid({ halfSizeM: 1_000, spacingM: 10 });
    const candidates = generateSearchCandidates(grid, 1_000, 100);
    expect(candidates.length).toBe(317);
    for (const candidate of candidates) {
      expect(Math.hypot(candidate.eastM, candidate.northM)).toBeLessThanOrEqual(
        1_000.0001,
      );
    }
  });

  it('describes the obstruction direction and first blocked time', () => {
    const result = makeResult({
      index: 7,
      eastM: -120,
      northM: 240,
      latitudeDeg: 45.1,
      longitudeDeg: 25.2,
      score: 0.78,
      clearSamples: 78,
      totalSamples: 100,
      minClearanceDeg: -1.2,
      maxObstructionDeg: 4.4,
      firstBlockedUtcMs: Date.parse('2029-04-13T22:10:00Z'),
      firstBlockedAzimuthDeg: 225,
      firstBlockedElevationDeg: 1.0,
      firstBlockedHorizonDeg: 3.0,
      firstBlockedSource: 'building',
      firstBlockedSourceId: 123,
      firstBlockedDistanceM: 420,
    });
    const reason = describeBestSpot(result, {
      timeZone: 'Europe/Bucharest',
      marginDeg: 2,
    });
    expect(reason).toContain('Blocked by buildings to the south-west');
    expect(reason).toContain('22:10 UTC');
    expect(reason).toContain('78%');
    expect(reason).toContain('lowest clearance -1.2°');
  });

  it('uses a margin-specific reason when the path is above the horizon', () => {
    const result = makeResult({
      score: 0.5,
      clearSamples: 50,
      totalSamples: 100,
      minClearanceDeg: 1.2,
      maxObstructionDeg: 0.1,
      firstBlockedUtcMs: Date.parse('2029-04-13T22:10:00Z'),
      firstBlockedAzimuthDeg: 90,
      firstBlockedElevationDeg: 1.3,
      firstBlockedHorizonDeg: 0.1,
      firstBlockedSource: 'terrain',
      firstBlockedSourceId: null,
      firstBlockedDistanceM: 800,
    });
    const reason = describeBestSpot(result);
    expect(reason).toContain('less than the 1.2° margin');
  });

  it('never rounds a 99.9% result up to 100%', () => {
    expect(formatClearPercent(1)).toBe('100');
    expect(formatClearPercent(0.99995)).toBe('100');
    expect(formatClearPercent(0.9992)).toBe('99.9');
    expect(formatClearPercent(0.78)).toBe('78');
  });

  it('uses the configured margin in the margin-limited reason', () => {
    const result = makeResult({
      score: 0.9992,
      clearSamples: 99,
      totalSamples: 100,
      minClearanceDeg: 1.2,
      maxObstructionDeg: 0.1,
      firstBlockedUtcMs: Date.parse('2029-04-13T22:10:00Z'),
      firstBlockedAzimuthDeg: 90,
      firstBlockedElevationDeg: 1.3,
      firstBlockedHorizonDeg: 0.1,
      firstBlockedSource: 'terrain',
      firstBlockedSourceId: null,
      firstBlockedDistanceM: 800,
    });
    const reason = describeBestSpot(result, { marginDeg: 2 });
    expect(reason).toContain('2.0° margin');
    expect(reason).toContain('99.9%');
    expect(reason).not.toContain('100%');
  });

  it('maps scores to a red-yellow-green heatmap', () => {
    expect(heatmapColor(0)).toContain('hsl(0.0');
    expect(heatmapColor(0.5)).toContain('hsl(60.0');
    expect(heatmapColor(1)).toContain('hsl(120.0');
  });
});
