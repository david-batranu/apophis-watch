/**
 * Offline prepared-area snapshot.
 *
 * This is deliberately separate from the service-worker precache. The app
 * shell can update, but the prepared ephemeris/star/terrain/building snapshot
 * is only replaced by an explicit "Prepare for offline" action or cleared by
 * the user.
 */

import { createStore, del, get, set } from 'idb-keyval';

const DB_NAME = 'apophis-watch-offline';
const STORE_NAME = 'prepared-v1';
const STORE = createStore(DB_NAME, STORE_NAME);
const SNAPSHOT_KEY = 'prepared-area-v1';

export interface OfflineTileRef {
  x: number;
  y: number;
}

export interface OfflineAreaInfo {
  label: string;
  latitudeDeg: number;
  longitudeDeg: number;
  groundElevationM: number | null;
  eyeHeightM: number;
  searchRadiusM: number;
  /** Requested horizon/building radius from the UI, metres. */
  requestedBuildingRadiusM?: number;
  /** Prepared Overpass/bundled coverage: search + requested building radius. */
  buildingRadiusM: number;
  spacingM: number;
  marginDeg: number;
  terrainRadiusM: number;
  terrainZoom: number;
  terrainTiles: OfflineTileRef[];
  bbox: { south: number; west: number; north: number; east: number };
}

export interface OfflineEphemerisData {
  text: string;
  bytes: number;
  provider: string;
  solution: string;
  retrievedAt: string;
  queryUrl: string | null;
}

export interface OfflineStarData {
  text: string;
  bytes: number;
  retrievedAt: string;
  source: string;
}

export interface OfflineBuildingData {
  json: string;
  bytes: number;
  count: number;
  defaultHeightCount: number;
  taggedHeightCount: number;
  source: 'network' | 'cache' | 'bundled' | 'import';
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourceQuery: string | null;
  retrievedAt: string;
  osmTimestamp: string | null;
  fileName: string | null;
}

export interface OfflineSnapshot {
  version: 1;
  preparedAt: number;
  appVersion: string;
  area: OfflineAreaInfo;
  ephemeris: OfflineEphemerisData;
  stars: OfflineStarData | null;
  buildings: OfflineBuildingData | null;
  terrain: {
    tileCount: number;
    bytes: number;
    failedTiles: number;
    attribution: string;
  };
  baseMap: {
    kind: 'hillshade';
    source: string;
    note: string;
    bytes: 0;
  };
  totalBytes: number;
  warnings: string[];
}

export interface StorageInfo {
  supported: boolean;
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function loadPreparedSnapshot(): Promise<OfflineSnapshot | null> {
  if (!idbAvailable()) return null;
  try {
    const value = (await get(SNAPSHOT_KEY, STORE)) as OfflineSnapshot | undefined;
    if (!value || value.version !== 1) return null;
    return value;
  } catch {
    return null;
  }
}

export async function savePreparedSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  if (!idbAvailable()) {
    throw new Error('IndexedDB is unavailable, so offline data cannot be stored.');
  }
  await set(SNAPSHOT_KEY, snapshot, STORE);
}

export async function clearPreparedSnapshot(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await del(SNAPSHOT_KEY, STORE);
  } catch {
    // Clearing is best-effort; the UI reports the remaining state.
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { supported: false, persisted: false, usageBytes: null, quotaBytes: null };
  }
  let persisted = false;
  try {
    persisted = await navigator.storage.persisted();
  } catch {
    persisted = false;
  }
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    const estimate = await navigator.storage.estimate();
    usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null;
    quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null;
  } catch {
    // Estimate is optional.
  }
  return { supported: true, persisted, usageBytes, quotaBytes };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Distance on a sphere, metres. */
export function distanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radius = 6_371_008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isInsidePreparedArea(
  snapshot: OfflineSnapshot,
  latitudeDeg: number,
  longitudeDeg: number,
): boolean {
  const distance = distanceM(
    snapshot.area.latitudeDeg,
    snapshot.area.longitudeDeg,
    latitudeDeg,
    longitudeDeg,
  );
  // The terrain grid is larger than the search radius; keep a small margin so
  // a point at the very edge still has cached DEM coverage.
  return distance <= snapshot.area.searchRadiusM + 250;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
  const value = bytes / 1000 ** exponent;
  try {
    return `${new Intl.NumberFormat('ro-RO', {
      maximumFractionDigits: exponent === 0 ? 0 : 1,
      minimumFractionDigits: exponent === 0 ? 0 : 1,
    }).format(value)} ${units[exponent]}`;
  } catch {
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }
}

export function formatPreparedDate(ms: number, timeZone = 'Europe/Bucharest'): string {
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
