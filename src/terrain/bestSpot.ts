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
  PreparedBuilding,
  TerrainGrid,
} from './types';

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

function scoreOne(
  input: BestSpotInput,
  candidate: BestSpotCandidate,
  bins: PathBins,
  stepM: number,
): BestSpotResult {
  const point = {
    latitudeDeg: candidate.latitudeDeg,
    longitudeDeg: candidate.longitudeDeg,
    groundElevationM: candidate.groundElevationM,
    eyeHeightM: input.eyeHeightM,
  };
  const eyeElevationM = candidate.groundElevationM + input.eyeHeightM;

  // A ground-level point inside a building footprint is not an observing spot.
  // A rooftop point whose eye is above the roof is allowed.
  let insideBuildingId: number | null = null;
  for (const building of input.buildings) {
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
      insideBuildingId = building.id;
      break;
    }
  }

  const totalSamples = input.path.length;
  if (insideBuildingId !== null || totalSamples === 0) {
    const first = input.path[0] ?? null;
    return {
      ...candidate,
      score: 0,
      clearSamples: 0,
      totalSamples,
      minClearanceDeg: -90,
      maxObstructionDeg: 90,
      firstBlockedUtcMs: first?.utcMs ?? null,
      firstBlockedAzimuthDeg: first?.azimuthDeg ?? null,
      firstBlockedElevationDeg: first?.elevationDeg ?? null,
      firstBlockedHorizonDeg: 90,
      firstBlockedSource: insideBuildingId !== null ? 'building' : null,
      firstBlockedSourceId: insideBuildingId,
      firstBlockedDistanceM: null,
      insideBuildingId,
    };
  }

  const slopes = computeHorizonSlopes(input.grid, point, input.buildings, {
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
  let firstBlocked: {
    utcMs: number;
    azimuthDeg: number;
    elevationDeg: number;
    horizonDeg: number;
    source: 'terrain' | 'building' | null;
    sourceId: number | null;
    distanceM: number | null;
  } | null = null;

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
    } else if (firstBlocked === null) {
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
  }

  if (!Number.isFinite(minClearanceDeg)) minClearanceDeg = -90;
  return {
    ...candidate,
    score: clearSamples / totalSamples,
    clearSamples,
    totalSamples,
    minClearanceDeg,
    maxObstructionDeg,
    firstBlockedUtcMs: firstBlocked?.utcMs ?? null,
    firstBlockedAzimuthDeg: firstBlocked?.azimuthDeg ?? null,
    firstBlockedElevationDeg: firstBlocked?.elevationDeg ?? null,
    firstBlockedHorizonDeg: firstBlocked?.horizonDeg ?? null,
    firstBlockedSource: firstBlocked?.source ?? null,
    firstBlockedSourceId: firstBlocked?.sourceId ?? null,
    firstBlockedDistanceM: firstBlocked?.distanceM ?? null,
    insideBuildingId: null,
  };
}

function sortRanked(results: BestSpotResult[]): BestSpotResult[] {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.minClearanceDeg !== a.minClearanceDeg) {
      return b.minClearanceDeg - a.minClearanceDeg;
    }
    return a.index - b.index;
  });
}

function buildSummary(
  input: BestSpotInput,
  results: BestSpotResult[],
  startMs: number,
  cancelled: boolean,
): BestSpotSummary {
  return {
    candidates: results,
    top: sortRanked(results).slice(0, 10),
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
  const bins = pathBins(input.path);
  const stepM =
    input.stepM ??
    Math.max(6, Math.min(input.grid.spacingEastM, input.grid.spacingNorthM) * 1.1);
  const results: BestSpotResult[] = [];
  const total = input.candidates.length;
  const progressEvery = Math.max(1, Math.floor(total / 100));
  for (let i = 0; i < total; i++) {
    if (options.shouldCancel?.()) {
      return buildSummary(input, results, startMs, true);
    }
    results.push(scoreOne(input, input.candidates[i], bins, stepM));
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
  const bins = pathBins(input.path);
  const stepM =
    input.stepM ??
    Math.max(6, Math.min(input.grid.spacingEastM, input.grid.spacingNorthM) * 1.1);
  const results: BestSpotResult[] = [];
  const total = input.candidates.length;
  const progressEvery = Math.max(1, Math.floor(total / 100));
  const yieldEvery = Math.max(1, options.yieldEvery ?? 150);
  for (let i = 0; i < total; i++) {
    if (options.shouldCancel?.()) {
      return buildSummary(input, results, startMs, true);
    }
    results.push(scoreOne(input, input.candidates[i], bins, stepM));
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
