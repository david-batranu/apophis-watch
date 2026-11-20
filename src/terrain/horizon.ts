/**
 * Horizon profile from a candidate point: terrain + buildings, 1° or finer.
 *
 * The profile is an airless geometric elevation angle. Earth curvature is
 * included as the spherical sagitta d²/(2R); at 15 km this is 17.7 m and is
 * not negligible for a 1.7 m eye.
 *
 * The inner routine works in slope (tan elevation) space so the ray march
 * needs no atan2 per terrain sample. That matters when the best-spot worker
 * evaluates thousands of candidates.
 */

import {
  EARTH_MEAN_RADIUS_M,
  RAD,
  distanceToBoxM,
  elevationAngleDeg,
  latLonToEnu,
  normalizeAzimuth,
} from './geo';
import type {
  HorizonProfile,
  HorizonSample,
  ObstructionSource,
  PreparedBuilding,
  TerrainGrid,
} from './types';

export interface HorizonPointInput {
  latitudeDeg: number;
  longitudeDeg: number;
  groundElevationM: number;
  eyeHeightM: number;
}

export interface HorizonOptions {
  /** Exact azimuths to evaluate. Defaults to 0, 1, … 359°. */
  azimuthsDeg?: number[];
  /** Bin width used to map building samples to an azimuth. Default 1°. */
  stepDeg?: number;
  /** Maximum terrain ray distance, metres. */
  maxDistanceM?: number;
  /** Only buildings within this distance are considered, metres. */
  buildingMaxDistanceM?: number;
  /** Terrain ray step; defaults to 0.9 × DEM spacing. */
  stepM?: number;
  /** Building edge sampling step, metres. */
  buildingStepM?: number;
  /** Include Earth curvature (default true). */
  curvature?: boolean;
  earthRadiusM?: number;
  /** Optional cancellation callback, polled per azimuth. */
  shouldCancel?: () => boolean;
}

export interface HorizonSlopes {
  azimuthsDeg: number[];
  /** tan(elevation angle); -Infinity means no obstruction found. */
  slopes: Float64Array;
  sources: Uint8Array;
  distancesM: Float32Array;
  topElevationsM: Float32Array;
  sourceIds: Int32Array;
}

const SOURCE_NONE = 0;
const SOURCE_TERRAIN = 1;
const SOURCE_BUILDING = 2;

function sourceToCode(source: ObstructionSource): number {
  return source === 'terrain'
    ? SOURCE_TERRAIN
    : source === 'building'
      ? SOURCE_BUILDING
      : SOURCE_NONE;
}

function codeToSource(code: number): ObstructionSource {
  return code === SOURCE_TERRAIN
    ? 'terrain'
    : code === SOURCE_BUILDING
      ? 'building'
      : 'none';
}

function maxDistanceToGridCorner(
  grid: TerrainGrid,
  eastM: number,
  northM: number,
): number {
  const eastMin = grid.eastOriginM;
  const eastMax = grid.eastOriginM + (grid.width - 1) * grid.spacingEastM;
  const northMax = grid.northOriginM;
  const northMin = grid.northOriginM - (grid.height - 1) * grid.spacingNorthM;
  const dx = Math.max(Math.abs(eastM - eastMin), Math.abs(eastM - eastMax));
  const dy = Math.max(Math.abs(northM - northMin), Math.abs(northM - northMax));
  return Math.hypot(dx, dy);
}

/**
 * Compute obstruction slopes at the requested azimuths. This is the shared
 * core used by the chart/3D horizon and by the best-spot worker.
 */
export function computeHorizonSlopes(
  grid: TerrainGrid,
  point: HorizonPointInput,
  buildings: PreparedBuilding[],
  options: HorizonOptions = {},
): HorizonSlopes {
  const stepDeg = options.stepDeg ?? 1;
  const count = Math.max(1, Math.round(360 / stepDeg));
  const azimuths =
    options.azimuthsDeg && options.azimuthsDeg.length > 0
      ? options.azimuthsDeg.map(normalizeAzimuth)
      : Array.from({ length: count }, (_, i) => i * stepDeg);
  const slopes = new Float64Array(azimuths.length);
  slopes.fill(-Infinity);
  const sources = new Uint8Array(azimuths.length);
  const distances = new Float32Array(azimuths.length);
  distances.fill(Number.NaN);
  const topElevations = new Float32Array(azimuths.length);
  topElevations.fill(Number.NaN);
  const sourceIds = new Int32Array(azimuths.length);
  sourceIds.fill(-1);

  const pointEnu = latLonToEnu(
    point.latitudeDeg,
    point.longitudeDeg,
    grid.originLatDeg,
    grid.originLonDeg,
  );
  const eyeElevationM = point.groundElevationM + point.eyeHeightM;
  const earthRadius = options.earthRadiusM ?? EARTH_MEAN_RADIUS_M;
  const curvature = options.curvature !== false;
  const dropFor = (distanceM: number): number =>
    curvature ? (distanceM * distanceM) / (2 * earthRadius) : 0;

  const col0 = (pointEnu.eastM - grid.eastOriginM) / grid.spacingEastM;
  const row0 = (grid.northOriginM - pointEnu.northM) / grid.spacingNorthM;
  const insideGrid =
    col0 >= 0 &&
    col0 <= grid.width - 1 &&
    row0 >= 0 &&
    row0 <= grid.height - 1;

  const cornerDistance = maxDistanceToGridCorner(
    grid,
    pointEnu.eastM,
    pointEnu.northM,
  );
  const maxDistance = Math.min(
    options.maxDistanceM ?? cornerDistance,
    cornerDistance,
  );
  // Nearest-cell sampling at ~0.9 x DEM spacing keeps the march cheap. The
  // verifier measured <=0.055 deg on a synthetic ridge and 0.127 deg against
  // an independent real-DEM march; both are sub-bin for a 1-degree profile.
  const stepM =
    options.stepM ??
    Math.max(4, Math.min(grid.spacingEastM, grid.spacingNorthM) * 0.9);

  // Map a rounded azimuth bin to an output slot. Step is usually 1°.
  const binToIndex = new Map<number, number>();
  for (let i = 0; i < azimuths.length; i++) {
    binToIndex.set(Math.round(azimuths[i] / stepDeg) % count, i);
  }

  if (insideGrid) {
    for (let a = 0; a < azimuths.length; a++) {
      if (options.shouldCancel?.()) break;
      const az = azimuths[a] * (Math.PI / 180);
      const dColPerM = Math.sin(az) / grid.spacingEastM;
      const dRowPerM = -Math.cos(az) / grid.spacingNorthM;
      let bestSlope = -Infinity;
      let bestDistance = Number.NaN;
      let bestTop = Number.NaN;
      let col = col0 + dColPerM * stepM;
      let row = row0 + dRowPerM * stepM;
      for (let d = stepM; d <= maxDistance; d += stepM) {
        const c = Math.round(col);
        const r = Math.round(row);
        if (c < 0 || c >= grid.width || r < 0 || r >= grid.height) break;
        const h = grid.elevations[r * grid.width + c];
        if (Number.isFinite(h)) {
          const slope = (h - eyeElevationM - dropFor(d)) / d;
          if (slope > bestSlope) {
            bestSlope = slope;
            bestDistance = d;
            bestTop = h;
          }
        }
        col += dColPerM * stepM;
        row += dRowPerM * stepM;
      }
      if (bestSlope > -Infinity) {
        slopes[a] = bestSlope;
        sources[a] = SOURCE_TERRAIN;
        distances[a] = bestDistance;
        topElevations[a] = bestTop;
      }
    }
  }

  const maxBuildingDistance =
    options.buildingMaxDistanceM ?? 1_000;
  const buildingStepM = options.buildingStepM ?? 2;
  for (const building of buildings) {
    if (
      distanceToBoxM(
        pointEnu.eastM,
        pointEnu.northM,
        building.minEastM,
        building.maxEastM,
        building.minNorthM,
        building.maxNorthM,
      ) > maxBuildingDistance
    ) {
      continue;
    }
    const roofElevationM = building.baseElevationM + building.heightM;
    const ring = building.ringEnu;
    for (let i = 0; i < ring.length; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % ring.length];
      const edgeLength = Math.hypot(
        p2.eastM - p1.eastM,
        p2.northM - p1.northM,
      );
      if (edgeLength <= 0) continue;
      const samples = Math.max(1, Math.ceil(edgeLength / buildingStepM));
      for (let k = 0; k < samples; k++) {
        const t = k / samples;
        const east = p1.eastM + (p2.eastM - p1.eastM) * t;
        const north = p1.northM + (p2.northM - p1.northM) * t;
        const dx = east - pointEnu.eastM;
        const dy = north - pointEnu.northM;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.5) continue;
        const azimuth = normalizeAzimuth(Math.atan2(dx, dy) * RAD);
        const index = binToIndex.get(Math.round(azimuth / stepDeg) % count);
        if (index === undefined) continue;
        const slope =
          (roofElevationM - eyeElevationM - dropFor(distance)) / distance;
        if (slope > slopes[index]) {
          slopes[index] = slope;
          sources[index] = SOURCE_BUILDING;
          distances[index] = distance;
          topElevations[index] = roofElevationM;
          sourceIds[index] = building.id;
        }
      }
    }
  }

  return {
    azimuthsDeg: azimuths,
    slopes,
    sources,
    distancesM: distances,
    topElevationsM: topElevations,
    sourceIds,
  };
}

/** Full profile with decoded sources, for the chart and the 3D horizon line. */
export function computeHorizonProfile(
  grid: TerrainGrid,
  point: HorizonPointInput,
  buildings: PreparedBuilding[],
  options: HorizonOptions = {},
): HorizonProfile {
  const slopes = computeHorizonSlopes(grid, point, buildings, options);
  const samples: HorizonSample[] = slopes.azimuthsDeg.map((azimuthDeg, i) => {
    const slope = slopes.slopes[i];
    const source = codeToSource(slopes.sources[i]);
    return {
      azimuthDeg,
      elevationDeg: Number.isFinite(slope)
        ? Math.atan(slope) * RAD
        : -90,
      source,
      distanceM: Number.isFinite(slopes.distancesM[i])
        ? slopes.distancesM[i]
        : null,
      sourceId: slopes.sourceIds[i] >= 0 ? slopes.sourceIds[i] : null,
      topElevationM: Number.isFinite(slopes.topElevationsM[i])
        ? slopes.topElevationsM[i]
        : null,
    };
  });
  return {
    samples,
    stepDeg: options.stepDeg ?? 1,
    pointLatDeg: point.latitudeDeg,
    pointLonDeg: point.longitudeDeg,
    groundElevationM: point.groundElevationM,
    eyeHeightM: point.eyeHeightM,
    eyeElevationM: point.groundElevationM + point.eyeHeightM,
    maxDistanceM:
      options.maxDistanceM ??
      maxDistanceToGridCorner(
        grid,
        latLonToEnu(
          point.latitudeDeg,
          point.longitudeDeg,
          grid.originLatDeg,
          grid.originLonDeg,
        ).eastM,
        latLonToEnu(
          point.latitudeDeg,
          point.longitudeDeg,
          grid.originLatDeg,
          grid.originLonDeg,
        ).northM,
      ),
    buildingCount: buildings.length,
    generatedAt: Date.now(),
  };
}

/**
 * Elevation angle for one already-computed slope. Exposed for the best-spot
 * worker, which keeps arrays instead of per-sample objects.
 */
export function slopeToElevationDeg(slope: number): number {
  return Number.isFinite(slope) ? Math.atan(slope) * RAD : -90;
}

/** Linear interpolation of a 1°-or-finer profile at an arbitrary azimuth. */
export function horizonElevationAtAzimuth(
  profile: HorizonProfile,
  azimuthDeg: number,
): number | null {
  const count = profile.samples.length;
  if (count === 0) return null;
  const step = profile.stepDeg;
  const position = normalizeAzimuth(azimuthDeg) / step;
  const i0 = Math.floor(position) % count;
  const i1 = (i0 + 1) % count;
  const t = position - Math.floor(position);
  const a = profile.samples[i0]?.elevationDeg;
  const b = profile.samples[i1]?.elevationDeg;
  if (a === undefined || b === undefined) return null;
  return a + (b - a) * t;
}

/** Convenience for tests and readouts: angle to a synthetic target. */
export function horizonAngleToTargetDeg(
  point: HorizonPointInput,
  targetGroundElevationM: number,
  targetHeightM: number,
  distanceM: number,
  curvature = true,
): number {
  return elevationAngleDeg(
    targetGroundElevationM + targetHeightM,
    point.groundElevationM + point.eyeHeightM,
    distanceM,
    curvature ? EARTH_MEAN_RADIUS_M : Number.POSITIVE_INFINITY,
  );
}

export { sourceToCode };
