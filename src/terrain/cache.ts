/**
 * IndexedDB cache for DEM tiles and Overpass building responses.
 *
 * Cache failures (Safari private mode, quota) are never fatal: the loader
 * falls back to the network and the UI keeps working.
 */

import { createStore, del, get, keys, set } from 'idb-keyval';
import type { BuildingsResult } from './types';

const DB_NAME = 'apophis-watch-terrain';
const STORE_NAME = 'cache-v1';
const store = createStore(DB_NAME, STORE_NAME);

/** DEM tiles change very rarely; keep them for a year. */
export const TILE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Building footprints change slowly; Overpass data is a snapshot. */
export const BUILDINGS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  version: 1;
  savedAt: number;
  value: T;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function readEntry<T>(key: string, maxAgeMs: number): Promise<T | null> {
  if (!idbAvailable()) return null;
  try {
    const entry = (await get(key, store)) as CacheEntry<T> | undefined;
    if (!entry || entry.version !== 1) return null;
    if (maxAgeMs > 0 && Date.now() - entry.savedAt > maxAgeMs) return null;
    return entry.value;
  } catch {
    return null;
  }
}

async function writeEntry<T>(key: string, value: T): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const entry: CacheEntry<T> = { version: 1, savedAt: Date.now(), value };
    await set(key, entry, store);
  } catch {
    // Quota/private-mode failures are non-fatal.
  }
}

export function tileCacheKey(z: number, x: number, y: number): string {
  return `terrarium/${z}/${x}/${y}`;
}

export interface CachedTile {
  elevations: Float32Array;
  savedAt: number;
}

export async function getCachedTile(
  z: number,
  x: number,
  y: number,
  maxAgeMs = TILE_TTL_MS,
): Promise<CachedTile | null> {
  const entry = await readEntry<{ elevations: Float32Array }>(
    tileCacheKey(z, x, y),
    maxAgeMs,
  );
  if (!entry || entry.elevations.length !== 256 * 256) return null;
  return { elevations: entry.elevations, savedAt: Date.now() };
}

export async function putCachedTile(
  z: number,
  x: number,
  y: number,
  elevations: Float32Array,
): Promise<void> {
  await writeEntry(tileCacheKey(z, x, y), { elevations });
}

export function buildingsCacheKey(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
): string {
  return `overpass/${latitudeDeg.toFixed(5)}/${longitudeDeg.toFixed(5)}/${Math.round(
    radiusM,
  )}`;
}

export async function getCachedBuildings(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
  maxAgeMs = BUILDINGS_TTL_MS,
): Promise<BuildingsResult | null> {
  return readEntry<BuildingsResult>(
    buildingsCacheKey(latitudeDeg, longitudeDeg, radiusM),
    maxAgeMs,
  );
}

export async function putCachedBuildings(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
  result: BuildingsResult,
): Promise<void> {
  await writeEntry(
    buildingsCacheKey(latitudeDeg, longitudeDeg, radiusM),
    result,
  );
}

export async function clearTerrainCache(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const all = await keys(store);
    await Promise.all(
      all
        .filter((key) => String(key).startsWith('terrarium/'))
        .map((key) => del(key, store)),
    );
  } catch {
    // Ignore.
  }
}

export async function clearBuildingCache(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const all = await keys(store);
    await Promise.all(
      all
        .filter((key) => String(key).startsWith('overpass/'))
        .map((key) => del(key, store)),
    );
  } catch {
    // Ignore.
  }
}

export async function cacheKeyCount(prefix: 'terrarium/' | 'overpass/'): Promise<number> {
  if (!idbAvailable()) return 0;
  try {
    const all = await keys(store);
    return all.filter((key) => String(key).startsWith(prefix)).length;
  } catch {
    return 0;
  }
}
