/**
 * OSM building footprints from Overpass.
 *
 * Policy: one query per settled view, debounced by the caller (>=1 s), cached
 * in IndexedDB, no polling and no automatic retry loop. HTTP 429 surfaces a
 * user-visible cooldown; the UI must not retry until it expires.
 */

import { t } from '../i18n';
import {
  getCachedBuildings,
  putCachedBuildings,
  BUILDINGS_TTL_MS,
} from './cache';
import {
  DEFAULT_AREAS_BASE_URL,
  findBundledArea,
  loadBundledAreaManifest,
  loadBundledBuildings,
  OSM_LICENSE,
} from './bundledAreas';
import type {
  BuildingFeature,
  BuildingsResult,
  BuildingsSource,
  HeightSource,
} from './types';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** EU mirror recommended first for European longitudes. */
export const OVERPASS_DRESEL_EU_ENDPOINT =
  'https://ovp.dresel.systems/api/interpreter';
/** North-American mirror at the same host. */
export const OVERPASS_DRESEL_NA_ENDPOINT =
  'https://ovp.dresel.systems/api-na/interpreter';
export const DEFAULT_BUILDING_RADIUS_M = 1_000;
export const MAX_BUILDING_QUERY_RADIUS_M = 5_000;
export const DEFAULT_BUILDING_HEIGHT_M = 8;
export const METRES_PER_LEVEL = 3;
/** Documented Overpass backoff for 502/504; a bounded retry, never a loop. */
export const LIVE_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000] as const;
/** The fallback endpoint may be retried at most this many times. */
export const LIVE_MAX_ATTEMPTS_PER_ENDPOINT = 3;

/**
 * Two live endpoints only: the recommended mirror nearest the view, then
 * overpass-api.de. Serial by construction; callers never overlap requests.
 */
export function liveOverpassEndpoints(longitudeDeg: number): string[] {
  const northAmerica =
    longitudeDeg >= -170 && longitudeDeg <= -30;
  return [
    northAmerica ? OVERPASS_DRESEL_NA_ENDPOINT : OVERPASS_DRESEL_EU_ENDPOINT,
    OVERPASS_ENDPOINT,
  ];
}

export class OverpassRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'OverpassRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class OverpassTimeoutError extends Error {
  constructor(message = t('terrain.buildingsTimeoutDefault')) {
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
  source: BuildingsSource = 'network',
): BuildingsResult {
  if (!Array.isArray(response.elements)) {
    throw new OverpassRequestError(t('terrain.buildingsNoElements'));
  }
  const buildings: BuildingFeature[] = [];
  let defaultHeightCount = 0;
  let taggedHeightCount = 0;
  for (const element of response.elements) {
    if (element.type !== 'way') continue;
    const tags = element.tags ?? {};
    const buildingTag = tags.building?.trim().toLowerCase();
    // `building=no` is explicitly used on OSM to mark non-buildings (e.g.
    // construction site outlines). Do not turn it into an 8 m obstruction.
    if (!buildingTag || buildingTag === 'no') continue;
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
  /** App base URL for `data/areas/index.json`; defaults to `/`. */
  baseUrl?: string;
  /** Try a fully-covering bundled area after a cache miss. Default true. */
  allowBundled?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
  /**
   * Bounded backoff for retryable live failures. Defaults to the documented
   * 30/60/120 s; callers only override it in tests.
   */
  retryBackoffMs?: readonly number[];
}

function abortError(): Error {
  // Internal abort payload; the UI discards aborted requests instead of showing it.
  const aborted = new Error('Building query cancelled');
  aborted.name = 'AbortError';
  return aborted;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return signal?.aborted ? Promise.reject(abortError()) : Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function endpointLabel(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
}

function cleanErrorBody(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface EndpointOutcome {
  result: BuildingsResult | null;
  error: unknown;
  retryable: boolean;
  /** 406 or an unreachable host: do not repeat it on this endpoint. */
  moveToNextEndpoint: boolean;
  nextEndpointReason?: 'http-406' | 'network';
}

async function requestBuildingsFromEndpoint(
  endpoint: string,
  query: string,
  latitudeDeg: number,
  longitudeDeg: number,
  radius: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<EndpointOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    // GET with an encoded `data` parameter is the documented Overpass form.
    const url = `${endpoint}?data=${encodeURIComponent(query)}`;
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
        t('terrain.buildingsRateLimit', {
          seconds: Math.ceil(retryAfterMs / 1000),
        }),
        retryAfterMs,
      );
    }
    if (
      response.status === 406 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
    ) {
      const body = cleanErrorBody(await response.text().catch(() => ''));
      return {
        result: null,
        error: new OverpassRequestError(
          t('terrain.buildingsEndpointError', {
            endpoint: endpointLabel(endpoint),
            status: response.status,
            body: body
              ? t('terrain.buildingsHttpBody', {
                  body: body.slice(0, 160),
                })
              : '',
          }),
          response.status,
        ),
        retryable: true,
        moveToNextEndpoint: response.status === 406,
        nextEndpointReason:
          response.status === 406 ? 'http-406' : undefined,
      };
    }
    if (!response.ok) {
      const body = cleanErrorBody(await response.text().catch(() => ''));
      throw new OverpassRequestError(
        t('terrain.buildingsResponseError', {
          status: response.status,
          body: body
            ? t('terrain.buildingsHttpBody', {
                body: body.slice(0, 160),
              })
            : '',
        }),
        response.status,
      );
    }
    let json: OverpassResponse;
    try {
      json = (await response.json()) as OverpassResponse;
    } catch {
      throw new OverpassRequestError(
        t('terrain.buildingsInvalidJson'),
        response.status,
      );
    }
    if (
      json.remark &&
      /timed out|runtime error|out of memory/i.test(json.remark)
    ) {
      throw new OverpassRequestError(
        t('terrain.buildingsRemark', { remark: json.remark }),
        null,
      );
    }
    const result = parseOverpassBuildings(
      json,
      latitudeDeg,
      longitudeDeg,
      radius,
      'network',
    );
    return {
      result,
      error: null,
      retryable: false,
      moveToNextEndpoint: false,
    };
  } catch (error) {
    if (timedOut) {
      return {
        result: null,
        error: new OverpassTimeoutError(
          t('terrain.buildingsTimeout', {
            seconds: Math.round(timeoutMs / 1000),
          }),
        ),
        retryable: false,
        moveToNextEndpoint: false,
      };
    }
    if (signal?.aborted) throw abortError();
    if (error instanceof OverpassRateLimitError) throw error;
    if (error instanceof OverpassRequestError) throw error;
    // Network failure (DNS, offline, CORS): try the other endpoint once, but
    // do not sit through a 30 s backoff for what is usually a local failure.
    return {
      result: null,
      error,
      retryable: true,
      moveToNextEndpoint: true,
      nextEndpointReason: 'network',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Use a bundled area only when it covers the whole requested circle. A partial
 * area is never used: that would silently under-report nearby obstructions.
 */
async function loadBundledIfCovered(
  baseUrl: string,
  allowBundled: boolean,
  latitudeDeg: number,
  longitudeDeg: number,
  radius: number,
  signal: AbortSignal | undefined,
  onProgress: ((message: string) => void) | undefined,
): Promise<BuildingsResult | null> {
  if (!allowBundled) return null;
  try {
    onProgress?.(t('terrain.buildingsProgressCheckingBundled'));
    const manifest = await loadBundledAreaManifest(baseUrl, { signal });
    const area = findBundledArea(
      manifest,
      latitudeDeg,
      longitudeDeg,
      radius,
    );
    if (!area) {
      if (manifest.areas.length > 0) {
        onProgress?.(
          t('terrain.buildingsProgressNoBundledCoverage'),
        );
      }
      return null;
    }
    if (signal?.aborted) throw abortError();
    onProgress?.(
      t('terrain.buildingsProgressLoadingBundled', {
        area: area.name,
        radius: (radius / 1000).toFixed(1),
      }),
    );
    const bundled = await loadBundledBuildings(baseUrl, area, { signal });
    if (signal?.aborted) throw abortError();
    onProgress?.(
      t('terrain.buildingsProgressLoadedBundled', {
        count: bundled.buildings.length,
        area: area.name,
      }),
    );
    // The caller asked about this centre/radius; the file covers at least it.
    return {
      ...bundled,
      centerLatDeg: latitudeDeg,
      centerLonDeg: longitudeDeg,
      queryRadiusM: radius,
    };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw abortError();
    onProgress?.(t('terrain.buildingsProgressBundledUnavailable'));
    return null;
  }
}

/**
 * Cached or bundled footprints when available, otherwise one serial live
 * query against at most two Overpass endpoints. Retries are bounded (30, 60,
 * 120 s) and stop on 429; there is no polling or background loop.
 */
export async function fetchBuildings(
  options: FetchBuildingsOptions,
): Promise<BuildingsResult> {
  const {
    latitudeDeg,
    longitudeDeg,
    radiusM,
    useCache = true,
    baseUrl = DEFAULT_AREAS_BASE_URL,
    allowBundled = true,
    signal,
    timeoutMs = 30_000,
    onProgress,
    retryBackoffMs = LIVE_RETRY_BACKOFF_MS,
  } = options;
  const radius = Math.max(
    1,
    Math.min(MAX_BUILDING_QUERY_RADIUS_M, radiusM),
  );
  if (signal?.aborted) throw abortError();
  if (useCache) {
    onProgress?.(t('terrain.buildingsProgressCheckingCache'));
    const cached = await getCachedBuildings(
      latitudeDeg,
      longitudeDeg,
      radius,
      BUILDINGS_TTL_MS,
    );
    if (cached) {
      onProgress?.(
        t('terrain.buildingsProgressCacheHit', {
          count: cached.buildings.length,
          source: cached.source,
        }),
      );
      return { ...cached, source: 'cache' };
    }
  }

  const bundled = await loadBundledIfCovered(
    baseUrl,
    allowBundled,
    latitudeDeg,
    longitudeDeg,
    radius,
    signal,
    onProgress,
  );
  if (bundled) return bundled;

  const query = buildOverpassQuery(latitudeDeg, longitudeDeg, radius);
  const endpoints = liveOverpassEndpoints(longitudeDeg);
  let lastError: unknown = null;
  let backoffIndex = 0;
  let skipBackoff = false;

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
    const endpoint = endpoints[endpointIndex];
    const attempts =
      endpointIndex === 0 ? 1 : LIVE_MAX_ATTEMPTS_PER_ENDPOINT;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if ((endpointIndex > 0 || attempt > 0) && !skipBackoff) {
        const wait =
          retryBackoffMs[
            Math.min(backoffIndex, Math.max(0, retryBackoffMs.length - 1))
          ] ?? 60_000;
        backoffIndex++;
        onProgress?.(
          t('terrain.buildingsProgressRetry', {
            action:
              attempt > 0
                ? t('terrain.buildingsProgressRetryAction')
                : t('terrain.buildingsProgressFallbackAction'),
            endpoint: endpointLabel(endpoint),
            seconds: Math.round(wait / 1000),
          }),
        );
        await sleepAbortable(wait, signal);
      }
      skipBackoff = false;
      if (signal?.aborted) throw abortError();
      onProgress?.(
        t('terrain.buildingsProgressQuerying', {
          endpoint: endpointLabel(endpoint),
          radius: (radius / 1000).toFixed(1),
        }),
      );
      const outcome = await requestBuildingsFromEndpoint(
        endpoint,
        query,
        latitudeDeg,
        longitudeDeg,
        radius,
        timeoutMs,
        signal,
      );
      if (outcome.result) {
        const result: BuildingsResult = {
          ...outcome.result,
          sourceUrl: outcome.result.sourceUrl ?? endpoint,
          sourceQuery: outcome.result.sourceQuery ?? query,
          license: outcome.result.license ?? OSM_LICENSE,
          retrievedAt:
            outcome.result.retrievedAt ?? new Date().toISOString(),
        };
        void putCachedBuildings(
          latitudeDeg,
          longitudeDeg,
          radius,
          result,
        );
        onProgress?.(
          t('terrain.buildingsProgressLoaded', {
            count: result.buildings.length,
            defaultCount: result.defaultHeightCount,
            defaultHeight: DEFAULT_BUILDING_HEIGHT_M,
          }),
        );
        return result;
      }
      lastError = outcome.error;
      if (!outcome.retryable) throw outcome.error;
      if (outcome.moveToNextEndpoint) {
        if (endpointIndex < endpoints.length - 1) {
          onProgress?.(
            outcome.nextEndpointReason === 'network'
              ? t('terrain.buildingsProgressUnreachable', {
                  endpoint: endpointLabel(endpoint),
                })
              : t('terrain.buildingsProgressHttp406', {
                  endpoint: endpointLabel(endpoint),
                }),
          );
        }
        skipBackoff = true;
        break;
      }
      if (endpointIndex === 0) break;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new OverpassRequestError(t('terrain.buildingsAllFailed'));
}

/** Default-height share, 0..1. */
export function defaultHeightShare(result: BuildingsResult): number {
  const total = result.buildings.length;
  return total === 0 ? 0 : result.defaultHeightCount / total;
}
