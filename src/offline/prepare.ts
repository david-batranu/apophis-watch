/**
 * Prepare the selected area for offline use.
 *
 * What is stored:
 *  - the exact ephemeris JSON and star catalogue JSON text,
 *  - AWS Terrarium DEM tiles (explicitly cacheable, CC-BY 4.0),
 *  - OSM building footprints from a bundled area or one polite Overpass query,
 *  - metadata needed to rebuild the offline hillshade base map.
 *
 * What is deliberately NOT stored:
 *  - tile.openstreetmap.org raster tiles (their policy forbids bulk/offline
 *    use). Online map tiles remain a live-viewport-only layer.
 */

import type { ApophisDataFile } from '../ephemeris/types';
import { TableEphemeris } from '../ephemeris/hermite';
import { t } from '../i18n';
import { validateStarCatalogue } from '../sky/catalog';
import { clearBuildingCache, clearTerrainCache, getCachedTile } from '../terrain/cache';
import {
  DEFAULT_BUILDING_HEIGHT_M,
  fetchBuildings,
  type FetchBuildingsOptions,
} from '../terrain/buildings';
import { TERRARIUM_ATTRIBUTION, TERRARIUM_TILE_SIZE } from '../terrain/terrarium';
import { loadTerrainGrid } from '../terrain/terrainGrid';
import type { BuildingsResult } from '../terrain/types';
import type { ObserverConfig } from '../state/store';
import {
  clearPreparedSnapshot,
  isInsidePreparedArea,
  loadPreparedSnapshot,
  requestPersistentStorage,
  savePreparedSnapshot,
  storageInfo,
  type OfflineAreaInfo,
  type OfflineBuildingData,
  type OfflineSnapshot,
  type OfflineTileRef,
} from './snapshot';

export const TERRAIN_RADIUS_MARGIN_M = 4_000;
export const DEFAULT_SEARCH_RADIUS_M = 3_000;
export const DEFAULT_BUILDING_RADIUS_M = 1_000;
export const DEFAULT_SPACING_M = 100;
export const DEFAULT_MARGIN_DEG = 2;
export const MAX_OFFLINE_TERRAIN_TILES = 81;

export type PreparePhase =
  | 'storage'
  | 'ephemeris'
  | 'stars'
  | 'terrain'
  | 'buildings'
  | 'snapshot'
  | 'done';

export interface PrepareProgress {
  phase: PreparePhase;
  message: string;
  fraction: number;
}

export interface PrepareInput {
  observer: ObserverConfig;
  searchRadiusM?: number;
  buildingRadiusM?: number;
  spacingM?: number;
  marginDeg?: number;
  baseUrl: string;
  signal?: AbortSignal;
  onProgress?: (progress: PrepareProgress) => void;
}

export class OfflinePrepareError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OfflinePrepareError';
    this.cause = cause;
  }
}

export class OfflineQuotaError extends OfflinePrepareError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'OfflineQuotaError';
  }
}

function abortError(): Error {
  const error = new Error(t('offline.cancelled'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function jsonBytes(value: unknown): number {
  return textBytes(JSON.stringify(value));
}

function labelFor(observer: ObserverConfig): string {
  return `${observer.latitudeDeg.toFixed(4)}°, ${observer.longitudeDeg.toFixed(4)}°`;
}

function buildingsFromSnapshot(snapshot: OfflineSnapshot): BuildingsResult | null {
  if (!snapshot.buildings) return null;
  try {
    const parsed = JSON.parse(snapshot.buildings.json) as BuildingsResult;
    return {
      ...parsed,
      source: snapshot.buildings.source,
      sourceLabel: snapshot.buildings.sourceLabel ?? undefined,
      sourceUrl: snapshot.buildings.sourceUrl ?? undefined,
      sourceQuery: snapshot.buildings.sourceQuery ?? undefined,
      retrievedAt: snapshot.buildings.retrievedAt,
      fileName: snapshot.buildings.fileName ?? undefined,
      license: 'ODbL',
      osmTimestamp: snapshot.buildings.osmTimestamp,
      fetchedAt: Date.parse(snapshot.buildings.retrievedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function buildingMetadata(result: BuildingsResult): OfflineBuildingData {
  const json = JSON.stringify(result);
  return {
    json,
    bytes: textBytes(json),
    count: result.buildings.length,
    defaultHeightCount: result.defaultHeightCount,
    taggedHeightCount: result.taggedHeightCount,
    source: result.source,
    sourceLabel: result.sourceLabel ?? null,
    sourceUrl: result.sourceUrl ?? null,
    sourceQuery: result.sourceQuery ?? null,
    retrievedAt: result.retrievedAt ?? new Date(result.fetchedAt).toISOString(),
    osmTimestamp: result.osmTimestamp,
    fileName: result.fileName ?? null,
  };
}

async function fetchJson(
  url: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<{ text: string; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new OfflinePrepareError(
      t('offline.downloadFailed', { label, error: String(error) }),
      error,
    );
  }
  if (!response.ok) {
    throw new OfflinePrepareError(
      t('offline.downloadHttp', { label, status: response.status }),
    );
  }
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text) };
  } catch (error) {
    throw new OfflinePrepareError(
      t('offline.invalidJson', { label }),
      error,
    );
  }
}

export interface PrepareResult {
  snapshot: OfflineSnapshot;
  warnings: string[];
}

/**
 * Build and persist a complete offline snapshot. The caller supplies the
 * selected observer, search radii and an AbortSignal for the Cancel button.
 */
export async function prepareOfflineArea(input: PrepareInput): Promise<PrepareResult> {
  const {
    observer,
    baseUrl,
    signal,
    onProgress,
  } = input;
  const searchRadiusM = input.searchRadiusM ?? DEFAULT_SEARCH_RADIUS_M;
  const buildingRadiusM = input.buildingRadiusM ?? DEFAULT_BUILDING_RADIUS_M;
  const spacingM = input.spacingM ?? DEFAULT_SPACING_M;
  const marginDeg = input.marginDeg ?? DEFAULT_MARGIN_DEG;
  const terrainRadiusM = searchRadiusM + TERRAIN_RADIUS_MARGIN_M;
  const requiredBuildingRadiusM = Math.min(
    5_000,
    Math.max(buildingRadiusM, searchRadiusM + buildingRadiusM),
  );
  const warnings: string[] = [];

  const report = (phase: PreparePhase, message: string, fraction: number): void => {
    onProgress?.({ phase, message, fraction: Math.min(1, Math.max(0, fraction)) });
  };

  throwIfAborted(signal);
  report('storage', t('offline.requestStorage'), 0.01);
  const persisted = await requestPersistentStorage();
  if (!persisted) {
    warnings.push(t('offline.storageWarning'));
  }
  const before = await storageInfo();
  throwIfAborted(signal);

  report('ephemeris', t('offline.downloadingEphemeris'), 0.05);
  const ephemeris = await fetchJson(
    `${baseUrl}data/apophis-2029.json`,
    signal,
    t('offline.ephemerisLabel'),
  );
  const ephemerisData = ephemeris.json as ApophisDataFile;
  try {
    new TableEphemeris(ephemerisData);
  } catch (error) {
    throw new OfflinePrepareError(t('offline.invalidEphemeris'), error);
  }
  if (!ephemerisData.target?.solution || !ephemerisData.source?.retrievedAt) {
    throw new OfflinePrepareError(t('offline.missingMetadata'));
  }

  report('stars', t('offline.downloadingStars'), 0.1);
  let stars: OfflineSnapshot['stars'] = null;
  try {
    const starFile = await fetchJson(
      `${baseUrl}data/stars.json`,
      signal,
      t('offline.starsLabel'),
    );
    const catalogue = validateStarCatalogue(starFile.json);
    stars = {
      text: starFile.text,
      bytes: textBytes(starFile.text),
      retrievedAt: catalogue.metadata.retrievedAt,
      source: catalogue.metadata.source,
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    warnings.push(
      t('offline.starsUnavailable', {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  throwIfAborted(signal);

  report('terrain', t('offline.downloadingTerrain'), 0.15);
  let grid;
  try {
    grid = await loadTerrainGrid({
      latitudeDeg: observer.latitudeDeg,
      longitudeDeg: observer.longitudeDeg,
      radiusM: terrainRadiusM,
      maxTiles: MAX_OFFLINE_TERRAIN_TILES,
      maxZoom: 14,
      useCache: true,
      signal,
      onProgress: (progress) => {
        if (progress.phase === 'planning') {
          report('terrain', progress.message, 0.15);
          return;
        }
        const tileFraction = progress.total > 0 ? progress.loaded / progress.total : 0;
        report(
          'terrain',
          progress.message,
          0.15 + tileFraction * 0.52,
        );
      },
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new OfflinePrepareError(
      t('offline.terrainFailed', {
        message: error instanceof Error ? error.message : String(error),
      }),
      error,
    );
  }
  throwIfAborted(signal);

  const tiles: OfflineTileRef[] = [];
  let missingTiles = 0;
  for (let y = grid.tileRange.yMin; y <= grid.tileRange.yMax; y++) {
    for (let x = grid.tileRange.xMin; x <= grid.tileRange.xMax; x++) {
      tiles.push({ x, y });
      const cached = await getCachedTile(grid.zoom, x, y, 0);
      if (!cached) missingTiles++;
    }
  }
  if (missingTiles > grid.failedTiles) {
    throw new OfflineQuotaError(
      t('offline.missingTiles', { count: missingTiles }),
    );
  }
  if (grid.failedTiles > 0) {
    warnings.push(t('offline.failedTiles', { count: grid.failedTiles }));
  }
  report(
    'terrain',
    t('offline.cachedTiles', { count: tiles.length, zoom: grid.zoom }),
    0.68,
  );

  report('buildings', t('offline.fetchingBuildings'), 0.7);
  let buildings: BuildingsResult | null = null;
  try {
    buildings = await fetchBuildings({
      latitudeDeg: observer.latitudeDeg,
      longitudeDeg: observer.longitudeDeg,
      radiusM: requiredBuildingRadiusM,
      baseUrl,
      allowBundled: true,
      signal,
      onProgress: (message) => report('buildings', message, 0.78),
      timeoutMs: 45_000,
    } satisfies FetchBuildingsOptions);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    warnings.push(
      t('offline.buildingsUnavailable', {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  throwIfAborted(signal);

  report('snapshot', t('offline.writingSnapshot'), 0.92);
  const terrainBytes = tiles.length * TERRARIUM_TILE_SIZE * TERRARIUM_TILE_SIZE * 4;
  const buildingData = buildings ? buildingMetadata(buildings) : null;
  const area: OfflineAreaInfo = {
    label: labelFor(observer),
    latitudeDeg: observer.latitudeDeg,
    longitudeDeg: observer.longitudeDeg,
    groundElevationM: observer.groundElevationM,
    eyeHeightM: observer.eyeHeightM,
    searchRadiusM,
    requestedBuildingRadiusM: buildingRadiusM,
    buildingRadiusM: requiredBuildingRadiusM,
    spacingM,
    marginDeg,
    terrainRadiusM,
    terrainZoom: grid.zoom,
    terrainTiles: tiles,
    bbox: grid.bbox,
  };
  const ephemerisRecord = {
    text: ephemeris.text,
    bytes: textBytes(ephemeris.text),
    provider: ephemerisData.source.provider,
    solution: ephemerisData.target.solution,
    retrievedAt: ephemerisData.source.retrievedAt,
    queryUrl: ephemerisData.source.queryUrl ?? null,
  };
  const totalBytes =
    ephemerisRecord.bytes +
    (stars?.bytes ?? 0) +
    terrainBytes +
    (buildingData?.bytes ?? 0);

  const snapshot: OfflineSnapshot = {
    version: 1,
    preparedAt: Date.now(),
    appVersion:
      typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development',
    area,
    ephemeris: ephemerisRecord,
    stars,
    buildings: buildingData,
    terrain: {
      tileCount: tiles.length,
      bytes: terrainBytes,
      failedTiles: grid.failedTiles,
      attribution: TERRARIUM_ATTRIBUTION,
    },
    baseMap: {
      kind: 'hillshade',
      source: 'AWS Terrarium DEM (Mapzen/joerd)',
      note: t('offline.baseMapNote'),
      bytes: 0,
    },
    totalBytes,
    warnings,
  };

  try {
    await savePreparedSnapshot(snapshot);
  } catch (error) {
    throw new OfflineQuotaError(t('offline.snapshotFailed'), error);
  }
  const after = await storageInfo();
  if (
    after.quotaBytes !== null &&
    after.usageBytes !== null &&
    after.usageBytes > after.quotaBytes * 0.9
  ) {
    warnings.push(t('offline.storageNearlyFull'));
  }
  if (before.persisted !== after.persisted && after.persisted) {
    warnings.push(t('offline.persistentGranted'));
  }
  report('done', t('offline.done'), 1);
  return { snapshot, warnings };
}

export interface OfflineIntegrity {
  ok: boolean;
  missingTiles: number;
  totalTiles: number;
  hasEphemeris: boolean;
  hasStars: boolean;
  hasBuildings: boolean;
  message: string | null;
}

/** Check that the prepared snapshot's data still exists in storage. */
export async function verifyPreparedSnapshot(): Promise<OfflineIntegrity | null> {
  const snapshot = await loadPreparedSnapshot();
  if (!snapshot) return null;
  let missingTiles = 0;
  for (const tile of snapshot.area.terrainTiles) {
    const cached = await getCachedTile(
      snapshot.area.terrainZoom,
      tile.x,
      tile.y,
      0,
    );
    if (!cached) missingTiles++;
  }
  const hasEphemeris = snapshot.ephemeris.text.length > 100;
  const hasStars = !!snapshot.stars && snapshot.stars.text.length > 100;
  const hasBuildings = !!snapshot.buildings;
  const ok = missingTiles === 0 && hasEphemeris;
  const message = ok
    ? null
    : missingTiles > 0
      ? t('offline.verifyMissingTiles', {
          missing: missingTiles,
          total: snapshot.area.terrainTiles.length,
        })
      : t('offline.verifyEphemeris');
  return {
    ok,
    missingTiles,
    totalTiles: snapshot.area.terrainTiles.length,
    hasEphemeris,
    hasStars,
    hasBuildings,
    message,
  };
}

export async function clearOfflineData(): Promise<void> {
  await clearPreparedSnapshot();
  await Promise.all([clearTerrainCache(), clearBuildingCache()]);
}

/** Convenience for the offline UI: does the snapshot cover this observer? */
export function snapshotCoversObserver(
  snapshot: OfflineSnapshot,
  observer: ObserverConfig,
): boolean {
  return isInsidePreparedArea(
    snapshot,
    observer.latitudeDeg,
    observer.longitudeDeg,
  );
}

export {
  loadPreparedSnapshot,
  savePreparedSnapshot,
  storageInfo,
  requestPersistentStorage,
  buildingsFromSnapshot,
  DEFAULT_BUILDING_HEIGHT_M,
};
