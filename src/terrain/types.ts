/**
 * Shared terrain types. This module intentionally has no imports so that the
 * pure maths, the Web Worker and the DOM layer can all use the same shapes.
 */

/** East/north offset in metres on the local tangent plane. */
export interface EnuPoint {
  eastM: number;
  northM: number;
}

/** Where a building height came from, in decreasing order of confidence. */
export type HeightSource = 'building:height' | 'height' | 'levels' | 'default';

/** A building footprint parsed from Overpass, in WGS84 degrees. */
export interface BuildingFeature {
  id: number;
  /** Lon/lat ring, first point not repeated. */
  ring: Array<{ lat: number; lon: number }>;
  heightM: number;
  heightSource: HeightSource;
  /** Raw building:levels, when parseable. */
  levels: number | null;
  tags: Record<string, string>;
}

/** Where the footprints in a result came from. */
export type BuildingsSource = 'network' | 'cache' | 'bundled' | 'import';

export interface BuildingsResult {
  buildings: BuildingFeature[];
  /** Number of buildings using the 8 m fallback height. */
  defaultHeightCount: number;
  /** Number of buildings with an explicit height or levels tag. */
  taggedHeightCount: number;
  centerLatDeg: number;
  centerLonDeg: number;
  queryRadiusM: number;
  fetchedAt: number;
  source: BuildingsSource;
  /** Overpass `timestamp_osm_base`, when supplied. */
  osmTimestamp: string | null;
  /** Human-readable provenance, e.g. "Bundled area: Brasov". */
  sourceLabel?: string;
  /** Upstream source endpoint or dataset URL, when known. */
  sourceUrl?: string;
  /** Exact Overpass QL (or importer note) used to obtain the data. */
  sourceQuery?: string;
  /** ISO-8601 retrieval time reported by the source, when known. */
  retrievedAt?: string;
  /** Licence identifier, e.g. "ODbL". */
  license?: string;
  /** Bundled or imported file name, when the result came from a file. */
  fileName?: string;
}

/**
 * A stitched AWS Terrarium DEM plus the local east/north mapping.
 *
 * Row 0 is the northern edge. Cell (0,0) is at
 * (eastOriginM, northOriginM); east increases with column, north decreases
 * with row. `spacingM` is the Web Mercator ground resolution at the observer
 * latitude; across a local grid the true spacing varies by well under 0.2%.
 */
export interface TerrainGrid {
  zoom: number;
  width: number;
  height: number;
  /** Elevation above sea level, metres. NaN marks a missing tile pixel. */
  elevations: Float32Array;
  /** Mean ground spacing, metres (for display). */
  spacingM: number;
  /** Actual east/north ground spacing of one pixel at the observer latitude. */
  spacingEastM: number;
  spacingNorthM: number;
  eastOriginM: number;
  northOriginM: number;
  originLatDeg: number;
  originLonDeg: number;
  /** DEM elevation at the observer position (bilinear sample), metres. */
  observerGroundElevationM: number;
  tileRange: { xMin: number; xMax: number; yMin: number; yMax: number };
  bbox: { south: number; west: number; north: number; east: number };
  requestedTiles: number;
  cachedTiles: number;
  networkTiles: number;
  failedTiles: number;
  createdAt: number;
}

/** A building footprint projected once into the local east/north frame. */
export interface PreparedBuilding {
  id: number;
  ringEnu: EnuPoint[];
  minEastM: number;
  maxEastM: number;
  minNorthM: number;
  maxNorthM: number;
  /** Highest DEM elevation under the footprint, metres above sea level. */
  baseElevationM: number;
  heightM: number;
  heightSource: HeightSource;
  tags: Record<string, string>;
}

export type ObstructionSource = 'terrain' | 'building' | 'none';

export interface HorizonSample {
  azimuthDeg: number;
  /** Geometric, airless elevation angle of the obstruction skyline. */
  elevationDeg: number;
  source: ObstructionSource;
  distanceM: number | null;
  /** Building way id when source === 'building'. */
  sourceId: number | null;
  /** Absolute height of the obstruction top, metres above sea level. */
  topElevationM: number | null;
}

export interface HorizonProfile {
  samples: HorizonSample[];
  stepDeg: number;
  pointLatDeg: number;
  pointLonDeg: number;
  groundElevationM: number;
  eyeHeightM: number;
  eyeElevationM: number;
  maxDistanceM: number;
  /** Number of prepared buildings considered. */
  buildingCount: number;
  generatedAt: number;
}

/** One sample of the topocentric Apophis path, computed once per area. */
export interface ApophisPathSample {
  utcMs: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

export interface PathSector {
  minAzimuthDeg: number;
  maxAzimuthDeg: number;
  /** Clockwise span from min to max, degrees (0..360). */
  spanDeg: number;
  minElevationDeg: number;
  maxElevationDeg: number;
  /** True when the sector crosses 0/360 and cannot be drawn as one interval. */
  wrapsNorth: boolean;
}

export interface ParallaxReport {
  baselineKm: number;
  rangeKm: number;
  /** Angular shift for a 5 km (or configured) baseline, arcseconds. */
  arcsec: number;
  utcMs: number;
  label: string;
}

export interface ApophisPathInfo {
  samples: ApophisPathSample[];
  sector: PathSector;
  /** Worst-case (smallest range) 5 km parallax over the visible path. */
  parallax: ParallaxReport;
  /** Parallax at the geocentric closest approach range, for reference. */
  parallaxAtGeocentricCa: ParallaxReport;
  /** Observer key the path was computed for. */
  observerKey: string;
  generatedAt: number;
}

export type BestSpotObstruction = 'terrain' | 'building';

export interface BestSpotCandidate {
  index: number;
  eastM: number;
  northM: number;
  latitudeDeg: number;
  longitudeDeg: number;
  groundElevationM: number;
}

/** Identifies one of the three building-height assumptions. */
export type HeightScenarioKey = 'base' | 'pessimistic' | 'optimistic';

/** A building-height assumption applied to OSM default-height buildings. */
export interface HeightScenarioDefinition {
  id: HeightScenarioKey;
  /** Human-readable label, e.g. "Pessimistic (default ×1.5)". */
  label: string;
  /** Multiplier applied only to buildings with heightSource === 'default'. */
  multiplier: number;
}

/** The three height assumptions used for every candidate. */
export type HeightScenarios = Record<HeightScenarioKey, HeightScenarioDefinition>;

export interface BestSpotResult extends BestSpotCandidate {
  /**
   * Base-scenario fraction 0..1 of the physical visibility window above the
   * horizon + margin. Kept as `score` for backward compatibility; `top` is
   * ranked by `scorePessimistic`.
   */
  score: number;
  clearSamples: number;
  totalSamples: number;
  /** Smallest (path elevation - obstruction) along the path, degrees. */
  minClearanceDeg: number;
  maxObstructionDeg: number;
  firstBlockedUtcMs: number | null;
  firstBlockedAzimuthDeg: number | null;
  firstBlockedElevationDeg: number | null;
  firstBlockedHorizonDeg: number | null;
  firstBlockedSource: BestSpotObstruction | null;
  firstBlockedSourceId: number | null;
  firstBlockedDistanceM: number | null;
  /** Building id when the candidate falls inside a footprint. */
  insideBuildingId: number | null;

  /** Score when default-height buildings are scaled by 1.5 (12 m). */
  scorePessimistic: number;
  /** Score when default-height buildings are scaled by 0.7 (5.6 m). */
  scoreOptimistic: number;
  clearSamplesPessimistic: number;
  clearSamplesOptimistic: number;
  /** Smallest clearance under the pessimistic building heights, degrees. */
  minClearanceDegPessimistic: number;
  /** Smallest clearance under the optimistic building heights, degrees. */
  minClearanceDegOptimistic: number;
  /** 1-based rank among all processed candidates (pessimistic order). */
  rankPessimistic: number;
  /** 1-based rank among all processed candidates (base order). */
  rankBase: number;
  /** 1-based rank among all processed candidates (optimistic order). */
  rankOptimistic: number;
  /** Absolute pessimistic-vs-optimistic rank difference. */
  rankSpread: number;

  /**
   * Base-scenario blocked path samples, classified by the obstruction that
   * defines the horizon in that sample's azimuth bin.
   */
  blockedByTerrainSamples: number;
  blockedByRealHeightBuildingSamples: number;
  blockedByDefaultHeightBuildingSamples: number;
  /** Unique building ids blocking base-scenario samples, ascending. */
  blockerBuildingIds: number[];
  /**
   * True only when the base scenario has at least one blocker and every
   * blocker is a default-height building (no terrain or explicit-height
   * building blockers). Such a spot is especially sensitive to the height
   * assumption.
   */
  onlyDefaultHeightBlockers: boolean;

  /**
   * Exact 2-D point-to-footprint distance, metres (0 when inside). Populated
   * for the top 10 results only; null elsewhere.
   */
  nearestBuildingM: number | null;
  nearestBuildingId: number | null;
  nearestBuildingHeightSource: HeightSource | null;
}

export interface BestSpotSummary {
  candidates: BestSpotResult[];
  /** Pessimistic top 10 (ranked by scorePessimistic). */
  top: BestSpotResult[];
  /** Labels and multipliers for the three height assumptions. */
  heightScenarios: HeightScenarios;
  processed: number;
  total: number;
  elapsedMs: number;
  radiusM: number;
  spacingM: number;
  eyeHeightM: number;
  marginDeg: number;
  pathSamples: number;
  /** True if no physical visibility interval exists at the search centre. */
  noVisibilityWindow: boolean;
  /** True if the search used fewer buildings than requested (coverage gap). */
  buildingsIncomplete: boolean;
  /** True when a cooperative cancel stopped the search early. */
  cancelled?: boolean;
}
