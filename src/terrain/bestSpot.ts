/**
 * Best-spot scoring.
 *
 * The Apophis path is computed once per search area by ../path.ts. For every
 * candidate we compute the local horizon obstruction (terrain + buildings)
 * and compare it with the SAME path, sample by sample. The score is the
 * fraction of the physical Phase 1 visibility duration that is above both the
 * obstruction and the user's minimum elevation margin.
 *
 * This module is pure and intentionally has no DOM/worker dependencies, so it
 * can run in the browser worker, in a node test, or as a main-thread fallback.
 */

import {
  compass8Long,
  distanceToBoxM,
  enuToLatLon,
  normalizeAzimuth,
  pointInPolygon,
} from './geo';
import { computeHorizonSlopes, slopeToElevationDeg } from './horizon';
import { formatUtcHhMm } from './path';
import { sampleGridEnu } from './terrainGrid';
import type {
  ApophisPathSample,
  BestSpotCandidate,
  BestSpotResult,
  BestSpotSummary,
  HeightScenarios,
  PreparedBuilding,
  TerrainGrid,
} from './types';

/**
 * The three building-height assumptions. Only buildings whose height came
 * from the 8 m OSM fallback (`heightSource === 'default'`) are scaled;
 * explicit height/levels values are kept unchanged.
 */
export const HEIGHT_SCENARIOS: HeightScenarios = {
  base: {
    id: 'base',
    label: 'Base (8 m default ×1.0)',
    multiplier: 1,
  },
  pessimistic: {
    id: 'pessimistic',
    label: 'Pessimistic (12 m default ×1.5)',
    multiplier: 1.5,
  },
  optimistic: {
    id: 'optimistic',
    label: 'Optimistic (5.6 m default ×0.7)',
    multiplier: 0.7,
  },
};

/**
 * Return a building array whose default-height footprints are scaled. Explicit
 * height/levels buildings are returned unchanged (same object).
 */
export function scaleDefaultBuildingHeights(
  buildings: PreparedBuilding[],
  multiplier: number,
): PreparedBuilding[] {
  if (multiplier === 1) return buildings;
  return buildings.map((building) =>
    building.heightSource === 'default'
      ? { ...building, heightM: building.heightM * multiplier }
      : building,
  );
}

export interface BestSpotInput {
  grid: TerrainGrid;
  buildings: PreparedBuilding[];
  path: ApophisPathSample[];
  candidates: BestSpotCandidate[];
  eyeHeightM: number;
  marginDeg: number;
  buildingRadiusM: number;
  radiusM: number;
  spacingM: number;
  /** Terrain ray step; defaults to 1.1 × DEM spacing (faster than the chart). */
  stepM?: number;
  curvature?: boolean;
  noVisibilityWindow?: boolean;
  buildingsIncomplete?: boolean;
}

export interface BestSpotRunOptions {
  onProgress?: (processed: number, total: number) => void;
  shouldCancel?: () => boolean;
  /** Yield to the event loop every N candidates in the async version. */
  yieldEvery?: number;
}

/**
 * Candidate grid centred on the observer. Points outside the DEM are omitted
 * rather than assigned fake elevations.
 */
export function generateSearchCandidates(
  grid: TerrainGrid,
  radiusM: number,
  spacingM: number,
): BestSpotCandidate[] {
  const spacing = Math.max(10, spacingM);
  const steps = Math.floor(radiusM / spacing);
  const candidates: BestSpotCandidate[] = [];
  let index = 0;
  for (let j = -steps; j <= steps; j++) {
    const northM = j * spacing;
    for (let i = -steps; i <= steps; i++) {
      const eastM = i * spacing;
      if (Math.hypot(eastM, northM) > radiusM + 1e-6) continue;
      const groundElevationM = sampleGridEnu(grid, eastM, northM);
      if (groundElevationM === null || !Number.isFinite(groundElevationM)) {
        continue;
      }
      const latLon = enuToLatLon(
        eastM,
        northM,
        grid.originLatDeg,
        grid.originLonDeg,
      );
      candidates.push({
        index: index++,
        eastM,
        northM,
        latitudeDeg: latLon.latitudeDeg,
        longitudeDeg: latLon.longitudeDeg,
        groundElevationM,
      });
    }
  }
  return candidates;
}

interface PathBins {
  keys: number[];
  indexOf: Map<number, number>;
}

function pathBins(path: ApophisPathSample[]): PathBins {
  const set = new Set<number>();
  for (const sample of path) {
    set.add(Math.round(normalizeAzimuth(sample.azimuthDeg)) % 360);
  }
  const keys = [...set].sort((a, b) => a - b);
  const indexOf = new Map<number, number>();
  keys.forEach((key, index) => indexOf.set(key, index));
  return { keys, indexOf };
}

interface FirstBlockedSample {
  utcMs: number | null;
  azimuthDeg: number | null;
  elevationDeg: number | null;
  horizonDeg: number;
  source: 'terrain' | 'building' | null;
  sourceId: number | null;
  distanceM: number | null;
}

interface ScenarioEvaluation {
  score: number;
  clearSamples: number;
  totalSamples: number;
  minClearanceDeg: number;
  maxObstructionDeg: number;
  insideBuildingId: number | null;
  firstBlocked: FirstBlockedSample | null;
  blockedByTerrainSamples: number;
  blockedByRealHeightBuildingSamples: number;
  blockedByDefaultHeightBuildingSamples: number;
  blockerBuildingIds: number[];
}

/** Height-scaled building arrays, built once per search. */
interface ScenarioBuildings {
  base: PreparedBuilding[];
  pessimistic: PreparedBuilding[];
  optimistic: PreparedBuilding[];
}

interface SearchContext {
  bins: PathBins;
  stepM: number;
  buildingsById: Map<number, PreparedBuilding>;
  buildings: ScenarioBuildings;
}

function prepareSearch(input: BestSpotInput): SearchContext {
  const buildings = {
    base: input.buildings,
    pessimistic: scaleDefaultBuildingHeights(
      input.buildings,
      HEIGHT_SCENARIOS.pessimistic.multiplier,
    ),
    optimistic: scaleDefaultBuildingHeights(
      input.buildings,
      HEIGHT_SCENARIOS.optimistic.multiplier,
    ),
  };
  return {
    bins: pathBins(input.path),
    stepM:
      input.stepM ??
      Math.max(
        6,
        Math.min(input.grid.spacingEastM, input.grid.spacingNorthM) * 1.1,
      ),
    buildingsById: new Map(
      input.buildings.map((building) => [building.id, building]),
    ),
    buildings,
  };
}

function pointInsideBuilding(
  candidate: BestSpotCandidate,
  eyeElevationM: number,
  buildings: PreparedBuilding[],
): PreparedBuilding | null {
  // A ground-level point inside a footprint is not an observing spot. A
  // rooftop point whose eye is above the roof is allowed.
  for (const building of buildings) {
    if (
      candidate.eastM < building.minEastM ||
      candidate.eastM > building.maxEastM ||
      candidate.northM < building.minNorthM ||
      candidate.northM > building.maxNorthM
    ) {
      continue;
    }
    if (!pointInPolygon(candidate.eastM, candidate.northM, building.ringEnu)) {
      continue;
    }
    if (eyeElevationM < building.baseElevationM + building.heightM - 0.1) {
      return building;
    }
  }
  return null;
}

/**
 * Score one candidate under one height scenario. `collectDetail` enables the
 * base-scenario-only fields (first blocker and blocker classification).
 */
function evaluateScenario(
  input: BestSpotInput,
  candidate: BestSpotCandidate,
  bins: PathBins,
  stepM: number,
  buildings: PreparedBuilding[],
  buildingsById: Map<number, PreparedBuilding>,
  collectDetail: boolean,
): ScenarioEvaluation {
  const point = {
    latitudeDeg: candidate.latitudeDeg,
    longitudeDeg: candidate.longitudeDeg,
    groundElevationM: candidate.groundElevationM,
    eyeHeightM: input.eyeHeightM,
  };
  const eyeElevationM = candidate.groundElevationM + input.eyeHeightM;
  const insideBuilding = pointInsideBuilding(
    candidate,
    eyeElevationM,
    buildings,
  );
  const totalSamples = input.path.length;

  if (insideBuilding !== null || totalSamples === 0) {
    const first = input.path[0] ?? null;
    const isDefaultHeight = insideBuilding?.heightSource === 'default';
    return {
      score: 0,
      clearSamples: 0,
      totalSamples,
      minClearanceDeg: -90,
      maxObstructionDeg: 90,
      insideBuildingId: insideBuilding?.id ?? null,
      firstBlocked: {
        utcMs: first?.utcMs ?? null,
        azimuthDeg: first?.azimuthDeg ?? null,
        elevationDeg: first?.elevationDeg ?? null,
        horizonDeg: 90,
        source: insideBuilding !== null ? 'building' : null,
        sourceId: insideBuilding?.id ?? null,
        distanceM: null,
      },
      blockedByTerrainSamples: 0,
      blockedByRealHeightBuildingSamples:
        insideBuilding !== null && !isDefaultHeight ? totalSamples : 0,
      blockedByDefaultHeightBuildingSamples:
        insideBuilding !== null && isDefaultHeight ? totalSamples : 0,
      blockerBuildingIds:
        insideBuilding !== null ? [insideBuilding.id] : [],
    };
  }

  const slopes = computeHorizonSlopes(input.grid, point, buildings, {
    azimuthsDeg: bins.keys,
    stepDeg: 1,
    buildingMaxDistanceM: input.buildingRadiusM,
    stepM,
    curvature: input.curvature,
  });
  const horizonByBin = new Float64Array(bins.keys.length);
  for (let i = 0; i < bins.keys.length; i++) {
    horizonByBin[i] = slopeToElevationDeg(slopes.slopes[i]);
  }

  let clearSamples = 0;
  let minClearanceDeg = Number.POSITIVE_INFINITY;
  let maxObstructionDeg = -90;
  let firstBlocked: FirstBlockedSample | null = null;
  let blockedByTerrainSamples = 0;
  let blockedByRealHeightBuildingSamples = 0;
  let blockedByDefaultHeightBuildingSamples = 0;
  const blockerBuildingIds: number[] = [];

  for (const sample of input.path) {
    const key = Math.round(normalizeAzimuth(sample.azimuthDeg)) % 360;
    const binIndex = bins.indexOf.get(key);
    if (binIndex === undefined) continue;
    const horizonDeg = horizonByBin[binIndex];
    const clearance = sample.elevationDeg - horizonDeg;
    if (clearance < minClearanceDeg) minClearanceDeg = clearance;
    if (horizonDeg > maxObstructionDeg) maxObstructionDeg = horizonDeg;
    if (clearance >= input.marginDeg) {
      clearSamples++;
      continue;
    }
    if (!collectDetail) continue;

    if (firstBlocked === null) {
      const sourceCode = slopes.sources[binIndex];
      firstBlocked = {
        utcMs: sample.utcMs,
        azimuthDeg: sample.azimuthDeg,
        elevationDeg: sample.elevationDeg,
        horizonDeg,
        source:
          sourceCode === 1 ? 'terrain' : sourceCode === 2 ? 'building' : null,
        sourceId:
          slopes.sourceIds[binIndex] >= 0 ? slopes.sourceIds[binIndex] : null,
        distanceM: Number.isFinite(slopes.distancesM[binIndex])
          ? slopes.distancesM[binIndex]
          : null,
      };
    }

    const sourceCode = slopes.sources[binIndex];
    if (sourceCode === 1) {
      blockedByTerrainSamples++;
    } else if (sourceCode === 2) {
      const sourceId = slopes.sourceIds[binIndex];
      const building =
        sourceId >= 0 ? buildingsById.get(sourceId) : undefined;
      if (building?.heightSource === 'default') {
        blockedByDefaultHeightBuildingSamples++;
      } else {
        blockedByRealHeightBuildingSamples++;
      }
      if (sourceId >= 0 && !blockerBuildingIds.includes(sourceId)) {
        blockerBuildingIds.push(sourceId);
      }
    }
  }

  if (!Number.isFinite(minClearanceDeg)) minClearanceDeg = -90;
  blockerBuildingIds.sort((a, b) => a - b);
  return {
    score: clearSamples / totalSamples,
    clearSamples,
    totalSamples,
    minClearanceDeg,
    maxObstructionDeg,
    insideBuildingId: null,
    firstBlocked,
    blockedByTerrainSamples,
    blockedByRealHeightBuildingSamples,
    blockedByDefaultHeightBuildingSamples,
    blockerBuildingIds,
  };
}

function scoreCandidate(
  input: BestSpotInput,
  candidate: BestSpotCandidate,
  context: SearchContext,
): BestSpotResult {
  const base = evaluateScenario(
    input,
    candidate,
    context.bins,
    context.stepM,
    context.buildings.base,
    context.buildingsById,
    true,
  );
  const pessimistic = evaluateScenario(
    input,
    candidate,
    context.bins,
    context.stepM,
    context.buildings.pessimistic,
    context.buildingsById,
    false,
  );
  const optimistic = evaluateScenario(
    input,
    candidate,
    context.bins,
    context.stepM,
    context.buildings.optimistic,
    context.buildingsById,
    false,
  );

  return {
    ...candidate,
    score: base.score,
    clearSamples: base.clearSamples,
    totalSamples: base.totalSamples,
    minClearanceDeg: base.minClearanceDeg,
    maxObstructionDeg: base.maxObstructionDeg,
    firstBlockedUtcMs: base.firstBlocked?.utcMs ?? null,
    firstBlockedAzimuthDeg: base.firstBlocked?.azimuthDeg ?? null,
    firstBlockedElevationDeg: base.firstBlocked?.elevationDeg ?? null,
    firstBlockedHorizonDeg: base.firstBlocked?.horizonDeg ?? null,
    firstBlockedSource: base.firstBlocked?.source ?? null,
    firstBlockedSourceId: base.firstBlocked?.sourceId ?? null,
    firstBlockedDistanceM: base.firstBlocked?.distanceM ?? null,
    insideBuildingId: base.insideBuildingId,

    scorePessimistic: pessimistic.score,
    scoreOptimistic: optimistic.score,
    clearSamplesPessimistic: pessimistic.clearSamples,
    clearSamplesOptimistic: optimistic.clearSamples,
    minClearanceDegPessimistic: pessimistic.minClearanceDeg,
    minClearanceDegOptimistic: optimistic.minClearanceDeg,
    rankPessimistic: 0,
    rankBase: 0,
    rankOptimistic: 0,
    rankSpread: 0,

    blockedByTerrainSamples: base.blockedByTerrainSamples,
    blockedByRealHeightBuildingSamples:
      base.blockedByRealHeightBuildingSamples,
    blockedByDefaultHeightBuildingSamples:
      base.blockedByDefaultHeightBuildingSamples,
    blockerBuildingIds: base.blockerBuildingIds,
    onlyDefaultHeightBlockers:
      base.blockedByDefaultHeightBuildingSamples > 0 &&
      base.blockedByRealHeightBuildingSamples === 0 &&
      base.blockedByTerrainSamples === 0,

    nearestBuildingM: null,
    nearestBuildingId: null,
    nearestBuildingHeightSource: null,
  };
}

function sortByBase(results: BestSpotResult[]): BestSpotResult[] {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.minClearanceDeg !== a.minClearanceDeg) {
      return b.minClearanceDeg - a.minClearanceDeg;
    }
    return a.index - b.index;
  });
}

function sortByPessimistic(results: BestSpotResult[]): BestSpotResult[] {
  return [...results].sort((a, b) => {
    if (b.scorePessimistic !== a.scorePessimistic) {
      return b.scorePessimistic - a.scorePessimistic;
    }
    if (b.minClearanceDegPessimistic !== a.minClearanceDegPessimistic) {
      return b.minClearanceDegPessimistic - a.minClearanceDegPessimistic;
    }
    // Base score is the documented third tie-break, then candidate index.
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
}

function sortByOptimistic(results: BestSpotResult[]): BestSpotResult[] {
  return [...results].sort((a, b) => {
    if (b.scoreOptimistic !== a.scoreOptimistic) {
      return b.scoreOptimistic - a.scoreOptimistic;
    }
    if (b.minClearanceDegOptimistic !== a.minClearanceDegOptimistic) {
      return b.minClearanceDegOptimistic - a.minClearanceDegOptimistic;
    }
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
}

function segmentDistanceM(
  eastM: number,
  northM: number,
  a: { eastM: number; northM: number },
  b: { eastM: number; northM: number },
): number {
  const dx = b.eastM - a.eastM;
  const dy = b.northM - a.northM;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t =
      ((eastM - a.eastM) * dx + (northM - a.northM) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(eastM - (a.eastM + dx * t), northM - (a.northM + dy * t));
}

/** Exact 2-D point-to-footprint distance; 0 when inside the polygon. */
function pointToPolygonDistanceM(
  eastM: number,
  northM: number,
  ring: Array<{ eastM: number; northM: number }>,
): number {
  if (pointInPolygon(eastM, northM, ring)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    best = Math.min(best, segmentDistanceM(eastM, northM, a, b));
  }
  return best;
}

function nearestBuilding(
  candidate: BestSpotCandidate,
  buildings: PreparedBuilding[],
): { building: PreparedBuilding; distanceM: number } | null {
  let best: { building: PreparedBuilding; distanceM: number } | null = null;
  for (const building of buildings) {
    const boxDistance = distanceToBoxM(
      candidate.eastM,
      candidate.northM,
      building.minEastM,
      building.maxEastM,
      building.minNorthM,
      building.maxNorthM,
    );
    if (best !== null && boxDistance > best.distanceM) continue;
    const distanceM = pointToPolygonDistanceM(
      candidate.eastM,
      candidate.northM,
      building.ringEnu,
    );
    if (!Number.isFinite(distanceM)) continue;
    if (
      best === null ||
      distanceM < best.distanceM ||
      (distanceM === best.distanceM && building.id < best.building.id)
    ) {
      best = { building, distanceM };
    }
  }
  return best;
}

function buildSummary(
  input: BestSpotInput,
  results: BestSpotResult[],
  startMs: number,
  cancelled: boolean,
): BestSpotSummary {
  const baseOrder = sortByBase(results);
  baseOrder.forEach((result, index) => {
    result.rankBase = index + 1;
  });
  const pessimisticOrder = sortByPessimistic(results);
  pessimisticOrder.forEach((result, index) => {
    result.rankPessimistic = index + 1;
  });
  const optimisticOrder = sortByOptimistic(results);
  optimisticOrder.forEach((result, index) => {
    result.rankOptimistic = index + 1;
  });
  for (const result of results) {
    result.rankSpread = Math.abs(
      result.rankPessimistic - result.rankOptimistic,
    );
  }

  // Nearest footprints are only needed for the ten displayed results.
  const top = pessimisticOrder.slice(0, 10);
  for (const result of top) {
    const nearest = nearestBuilding(result, input.buildings);
    if (nearest !== null) {
      result.nearestBuildingM = nearest.distanceM;
      result.nearestBuildingId = nearest.building.id;
      result.nearestBuildingHeightSource = nearest.building.heightSource;
    }
  }

  return {
    candidates: results,
    top,
    heightScenarios: {
      base: { ...HEIGHT_SCENARIOS.base },
      pessimistic: { ...HEIGHT_SCENARIOS.pessimistic },
      optimistic: { ...HEIGHT_SCENARIOS.optimistic },
    },
    processed: results.length,
    total: input.candidates.length,
    elapsedMs: Date.now() - startMs,
    radiusM: input.radiusM,
    spacingM: input.spacingM,
    eyeHeightM: input.eyeHeightM,
    marginDeg: input.marginDeg,
    pathSamples: input.path.length,
    noVisibilityWindow:
      input.noVisibilityWindow === true || input.path.length === 0,
    buildingsIncomplete: input.buildingsIncomplete === true,
    cancelled,
  };
}

/** Synchronous scoring core, used by tests and the non-worker fallback. */
export function searchBestSpotsSync(
  input: BestSpotInput,
  options: BestSpotRunOptions = {},
): BestSpotSummary {
  const startMs = Date.now();
  const context = prepareSearch(input);
  const results: BestSpotResult[] = [];
  const total = input.candidates.length;
  const progressEvery = Math.max(1, Math.floor(total / 100));
  for (let i = 0; i < total; i++) {
    if (options.shouldCancel?.()) {
      return buildSummary(input, results, startMs, true);
    }
    results.push(scoreCandidate(input, input.candidates[i], context));
    if ((i + 1) % progressEvery === 0 || i === total - 1) {
      options.onProgress?.(i + 1, total);
    }
  }
  return buildSummary(input, results, startMs, false);
}

/**
 * Async scoring loop for the worker. Yields periodically so a `cancel`
 * message can be handled between chunks; progress is reported 100 times.
 */
export async function searchBestSpots(
  input: BestSpotInput,
  options: BestSpotRunOptions = {},
): Promise<BestSpotSummary> {
  const startMs = Date.now();
  const context = prepareSearch(input);
  const results: BestSpotResult[] = [];
  const total = input.candidates.length;
  const progressEvery = Math.max(1, Math.floor(total / 100));
  const yieldEvery = Math.max(1, options.yieldEvery ?? 150);
  for (let i = 0; i < total; i++) {
    if (options.shouldCancel?.()) {
      return buildSummary(input, results, startMs, true);
    }
    results.push(scoreCandidate(input, input.candidates[i], context));
    if ((i + 1) % progressEvery === 0 || i === total - 1) {
      options.onProgress?.(i + 1, total);
    }
    if ((i + 1) % yieldEvery === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return buildSummary(input, results, startMs, false);
}

export interface ReasonOptions {
  /** Optional IANA zone used to append a local time. */
  timeZone?: string;
  /** User's minimum elevation margin, degrees (defaults to the shortfall). */
  marginDeg?: number;
}

/**
 * One-decimal clear percentage that never rounds a 99.9% result up to 100%.
 * Exact 1.0 prints as "100".
 */
export function formatClearPercent(score: number): string {
  if (score >= 0.99995) return '100';
  const tenths = Math.floor(Math.max(0, Math.min(1, score)) * 1000) / 10;
  return tenths.toFixed(1).replace(/\.0$/, '');
}

function localHhMm(utcMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(new Date(utcMs));
  } catch {
    return '';
  }
}

/**
 * Plain-language reason, including the obstruction direction and first
 * blocked time: "Buildings to the SW block from 22:10 UTC".
 */
export function describeBestSpot(
  result: BestSpotResult,
  options: ReasonOptions = {},
): string {
  if (result.insideBuildingId !== null) {
    return `Inside OSM building ${result.insideBuildingId}; not a ground-level observing spot. Choose a rooftop eye height or another point.`;
  }
  if (result.totalSamples === 0) {
    return 'No physical Phase 1 visibility window at this location.';
  }
  if (result.score >= 0.999_999) {
    return `Clear for the whole visible window (minimum clearance ${result.minClearanceDeg.toFixed(
      1,
    )}°).`;
  }
  if (result.firstBlockedUtcMs === null) {
    return `${Math.round(result.score * 100)}% of the visible window is clear.`;
  }
  const time = formatUtcHhMm(result.firstBlockedUtcMs);
  const local = options.timeZone
    ? localHhMm(result.firstBlockedUtcMs, options.timeZone)
    : '';
  const when = local ? `${time} UTC (${local} local)` : `${time} UTC`;
  const source =
    result.firstBlockedSource === 'building'
      ? 'buildings'
      : result.firstBlockedSource === 'terrain'
        ? 'terrain'
        : 'the horizon';
  const direction =
    result.firstBlockedAzimuthDeg === null
      ? ''
      : ` to the ${compass8Long(result.firstBlockedAzimuthDeg)}`;
  const horizonDeg = result.firstBlockedHorizonDeg;
  const elevationDeg = result.firstBlockedElevationDeg;
  const marginLimited =
    horizonDeg !== null &&
    elevationDeg !== null &&
    elevationDeg > horizonDeg + 0.01;
  if (marginLimited) {
    const margin =
      options.marginDeg ?? Math.max(0, Math.abs(result.minClearanceDeg));
    const verb = result.firstBlockedSource === 'building' ? 'leave' : 'leaves';
    return `${source[0].toUpperCase()}${source.slice(
      1,
    )}${direction} ${verb} less than the ${margin.toFixed(
      1,
    )}° margin from Apophis at ${when}; ${formatClearPercent(
      result.score,
    )}% of the visible window is clear.`;
  }
  return `Blocked by ${source}${direction} from ${when}; ${formatClearPercent(
    result.score,
  )}% of the visible window is clear (minimum clearance ${result.minClearanceDeg.toFixed(
    1,
  )}°).`;
}

/** Heatmap colour: red (blocked) → yellow → green (clear). */
export function heatmapColor(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  const hue = 120 * clamped;
  return `hsl(${hue.toFixed(1)} 75% 45%)`;
}
