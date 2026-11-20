/**
 * OSM building footprints from Overpass.
 *
 * Policy: one query per settled view, debounced by the caller (>=1 s), cached
 * in IndexedDB, no polling and no automatic retry loop. HTTP 429 surfaces a
 * user-visible cooldown; the UI must not retry until it expires.
 */

import {
  getCachedBuildings,
  putCachedBuildings,
  BUILDINGS_TTL_MS,
} from './cache';
import type { BuildingFeature, BuildingsResult, HeightSource } from './types';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const DEFAULT_BUILDING_RADIUS_M = 1_000;
export const MAX_BUILDING_QUERY_RADIUS_M = 5_000;
export const DEFAULT_BUILDING_HEIGHT_M = 8;
export const METRES_PER_LEVEL = 3;

export class OverpassRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'OverpassRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class OverpassTimeoutError extends Error {
  constructor(message = 'Overpass request timed out') {
    super(message);
    this.name = 'OverpassTimeoutError';
  }
}

export class OverpassRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'OverpassRequestError';
    this.status = status;
  }
}

/** Parse "12", "12.5 m", "40 ft", "40'" into metres. */
export function parseHeightMeters(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*([0-9]+(?:[.,][0-9]+)?)\s*(m|metres?|meters?|ft|feet|')?/i.exec(
    value,
  );
  if (!match) return null;
  const number = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return null;
  const unit = (match[2] ?? '').toLowerCase();
  const metres =
    unit === 'ft' || unit === 'feet' || unit === "'"
      ? number * 0.3048
      : number;
  if (metres <= 0 || metres > 1_500) return null;
  return metres;
}

export function parseLevels(value: string | undefined): number | null {
  if (!value) return null;
  const first = value.split(/[;,]/)[0]?.trim();
  const number = Number(first?.replace(',', '.'));
  if (!Number.isFinite(number) || number < 0 || number > 200) return null;
  return number;
}

export interface BuildingHeightInfo {
  heightM: number;
  heightSource: HeightSource;
  levels: number | null;
}

/**
 * Height priority: building:height -> height -> building:levels × 3 -> 8 m.
 * Invalid higher-priority tags fall through; the source is reported so the
 * UI can show the default share.
 */
export function buildingHeightFromTags(
  tags: Record<string, string>,
): BuildingHeightInfo {
  const fromBuildingHeight = parseHeightMeters(tags['building:height']);
  if (fromBuildingHeight !== null) {
    return {
      heightM: fromBuildingHeight,
      heightSource: 'building:height',
      levels: parseLevels(tags['building:levels']),
    };
  }
  const fromHeight = parseHeightMeters(tags.height);
  if (fromHeight !== null) {
    return {
      heightM: fromHeight,
      heightSource: 'height',
      levels: parseLevels(tags['building:levels']),
    };
  }
  const levels = parseLevels(tags['building:levels']);
  if (levels !== null) {
    return {
      heightM: levels * METRES_PER_LEVEL,
      heightSource: 'levels',
      levels,
    };
  }
  return {
    heightM: DEFAULT_BUILDING_HEIGHT_M,
    heightSource: 'default',
    levels: null,
  };
}

export interface OverpassGeometryPoint {
  lat: number;
  lon: number;
}

export interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: OverpassGeometryPoint[];
}

export interface OverpassResponse {
  version?: number;
  generator?: string;
  osm3s?: { timestamp_osm_base?: string };
  elements?: OverpassElement[];
  remark?: string;
}

/** Parse an Overpass `out geom;` response into building features. */
export function parseOverpassBuildings(
  response: OverpassResponse,
  centerLatDeg: number,
  centerLonDeg: number,
  queryRadiusM: number,
  source: 'network' | 'cache' = 'network',
): BuildingsResult {
  if (!Array.isArray(response.elements)) {
    throw new OverpassRequestError('Overpass response has no elements array');
  }
  const buildings: BuildingFeature[] = [];
  let defaultHeightCount = 0;
  let taggedHeightCount = 0;
  for (const element of response.elements) {
    if (element.type !== 'way') continue;
    const tags = element.tags ?? {};
    if (!tags.building) continue;
    const geometry = element.geometry ?? [];
    if (geometry.length < 3) continue;
    const ring = geometry
      .filter(
        (point) =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lon) &&
          Math.abs(point.lat) <= 90 &&
          Math.abs(point.lon) <= 180,
      )
      .map((point) => ({ lat: point.lat, lon: point.lon }));
    if (ring.length < 3) continue;
    if (
      ring.length > 1 &&
      Math.abs(ring[0].lat - ring[ring.length - 1].lat) < 1e-9 &&
      Math.abs(ring[0].lon - ring[ring.length - 1].lon) < 1e-9
    ) {
      ring.pop();
    }
    if (ring.length < 3) continue;
    const info = buildingHeightFromTags(tags);
    if (info.heightSource === 'default') defaultHeightCount++;
    else taggedHeightCount++;
    buildings.push({
      id: typeof element.id === 'number' ? element.id : buildings.length,
      ring,
      heightM: info.heightM,
      heightSource: info.heightSource,
      levels: info.levels,
      tags,
    });
  }
  return {
    buildings,
    defaultHeightCount,
    taggedHeightCount,
    centerLatDeg,
    centerLonDeg,
    queryRadiusM,
    fetchedAt: Date.now(),
    source,
    osmTimestamp: response.osm3s?.timestamp_osm_base ?? null,
  };
}

/** Exact Overpass QL: one building-way query, 25 s server timeout. */
export function buildOverpassQuery(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
): string {
  const radius = Math.round(
    Math.max(1, Math.min(MAX_BUILDING_QUERY_RADIUS_M, radiusM)),
  );
  return `[out:json][timeout:25];way["building"](around:${radius},${latitudeDeg.toFixed(
    6,
  )},${longitudeDeg.toFixed(6)});out geom;`;
}

function parseRetryAfterMs(header: string | null): number {
  if (!header) return 120_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(15 * 60_000, Math.max(10_000, seconds * 1000));
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(10_000, Math.min(15 * 60_000, date - Date.now()));
  }
  return 120_000;
}

export interface FetchBuildingsOptions {
  latitudeDeg: number;
  longitudeDeg: number;
  radiusM: number;
  useCache?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

/**
 * One Overpass request (or one cache read). Never retries. Throws typed
 * errors so the UI can show cooldown/timeout messages.
 */
export async function fetchBuildings(
  options: FetchBuildingsOptions,
): Promise<BuildingsResult> {
  const {
    latitudeDeg,
    longitudeDeg,
    radiusM,
    useCache = true,
    signal,
    timeoutMs = 30_000,
    onProgress,
  } = options;
  const radius = Math.max(
    1,
    Math.min(MAX_BUILDING_QUERY_RADIUS_M, radiusM),
  );
  if (signal?.aborted) {
    const aborted = new Error('Building query cancelled');
    aborted.name = 'AbortError';
    throw aborted;
  }
  if (useCache) {
    onProgress?.('Checking the local building cache…');
    const cached = await getCachedBuildings(
      latitudeDeg,
      longitudeDeg,
      radius,
      BUILDINGS_TTL_MS,
    );
    if (cached) {
      onProgress?.(
        `Loaded ${cached.buildings.length} buildings from cache (${cached.source}).`,
      );
      return { ...cached, source: 'cache' };
    }
  }

  onProgress?.(
    `Querying Overpass for buildings within ${(radius / 1000).toFixed(1)} km…`,
  );
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    // GET keeps the small building query simple and cache-friendly. The
    // endpoint rejects some POST clients behind its nginx front end; GET with
    // an encoded `data` parameter is the documented Overpass form.
    const query = buildOverpassQuery(latitudeDeg, longitudeDeg, radius);
    const url = `${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('Retry-After'),
      );
      throw new OverpassRateLimitError(
        `Overpass rate limit reached (HTTP 429). Wait ${Math.ceil(
          retryAfterMs / 1000,
        )} s before trying again.`,
        retryAfterMs,
      );
    }
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new OverpassRequestError(
        `Overpass is unavailable or at capacity (HTTP ${response.status}). No automatic retry; try again later.`,
        response.status,
      );
    }
    if (!response.ok) {
      const body = (await response.text().catch(() => ''))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      throw new OverpassRequestError(
        `Overpass responded HTTP ${response.status}${
          body ? `: ${body.slice(0, 160)}` : ''
        }`,
        response.status,
      );
    }
    const json = (await response.json()) as OverpassResponse;
    if (json.remark && /timed out|runtime error|out of memory/i.test(json.remark)) {
      throw new OverpassRequestError(`Overpass: ${json.remark}`, null);
    }
    const result = parseOverpassBuildings(
      json,
      latitudeDeg,
      longitudeDeg,
      radius,
      'network',
    );
    void putCachedBuildings(latitudeDeg, longitudeDeg, radius, result);
    onProgress?.(
      `Loaded ${result.buildings.length} buildings; ${
        result.defaultHeightCount
      } use the ${DEFAULT_BUILDING_HEIGHT_M} m default.`,
    );
    return result;
  } catch (error) {
    if (timedOut) {
      throw new OverpassTimeoutError(
        `Overpass did not answer within ${Math.round(timeoutMs / 1000)} s.`,
      );
    }
    if (signal?.aborted) {
      const aborted = new Error('Building query cancelled');
      aborted.name = 'AbortError';
      throw aborted;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Default-height share, 0..1. */
export function defaultHeightShare(result: BuildingsResult): number {
  const total = result.buildings.length;
  return total === 0 ? 0 : result.defaultHeightCount / total;
}
