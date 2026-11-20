/**
 * Bundled/imported building footprints.
 *
 * A bundled area is a static GeoJSON snapshot plus a small JSON sidecar and an
 * entry in `data/areas/index.json`. The app prefers a bundled area when it
 * fully covers the requested circle, so a known observing site works offline
 * without another Overpass query.
 *
 * All bundled OSM data is © OpenStreetMap contributors, ODbL 1.0. Nothing here
 * invents footprints or heights: geometry and height tags come from the file,
 * and `buildingHeightFromTags` applies exactly the same priority as the live
 * Overpass parser.
 */

import {
  buildingHeightFromTags,
  parseHeightMeters,
  parseLevels,
  parseOverpassBuildings,
  type OverpassResponse,
} from './buildings';
import type {
  BuildingFeature,
  BuildingsResult,
  BuildingsSource,
  HeightSource,
} from './types';

export const DEFAULT_AREAS_BASE_URL = '/';
export const AREAS_DIRECTORY = 'data/areas/';
export const AREAS_MANIFEST_FILE = 'index.json';
export const OSM_LICENSE = 'ODbL';
export const OSM_LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Earth radius used only for conservative footprint coverage checks. */
const EARTH_RADIUS_M = 6_371_008.8;
/** A little slack so a 1.5 km area still covers a 1.5 km request. */
const COVERAGE_SLACK_M = 1;

export class BundledAreaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundledAreaError';
  }
}

export interface BundledAreaEntry {
  slug: string;
  name: string;
  centerLatDeg: number;
  centerLonDeg: number;
  radiusM: number;
  file: string;
  metadataFile?: string;
  buildingCount?: number;
  defaultHeightCount?: number;
  taggedHeightCount?: number;
  retrievedAt?: string;
  osmTimestamp?: string | null;
  license?: string;
  attribution?: string;
  /** Upstream Overpass endpoint that produced the snapshot. */
  sourceEndpoint?: string;
  /** Exact Overpass QL used to produce the snapshot. */
  sourceQuery?: string;
}

export interface BundledAreaManifest {
  schemaVersion?: number;
  generatedAt?: string;
  license?: string;
  attribution?: string;
  areas: BundledAreaEntry[];
}

/** Provenance carried by an imported GeoJSON/Overpass document. */
export interface ImportedBuildingsOptions {
  source?: 'bundled' | 'import';
  sourceLabel?: string;
  sourceUrl?: string;
  sourceQuery?: string;
  retrievedAt?: string;
  license?: string;
  fileName?: string;
  osmTimestamp?: string | null;
}

export interface LoadBundledOptions {
  signal?: AbortSignal;
  /** Injectable fetch, mainly for tests. */
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  const string = nonEmptyString(value);
  return string ?? undefined;
}

function isHeightSource(value: unknown): value is HeightSource {
  return (
    value === 'building:height' ||
    value === 'height' ||
    value === 'levels' ||
    value === 'default'
  );
}

/** Join the app base URL with `data/areas/`. */
export function areasDirectoryUrl(
  baseUrl: string = DEFAULT_AREAS_BASE_URL,
): string {
  const trimmed = (baseUrl ?? '').trim();
  if (trimmed === '' || trimmed === '.') return AREAS_DIRECTORY;
  return trimmed.endsWith('/')
    ? `${trimmed}${AREAS_DIRECTORY}`
    : `${trimmed}/${AREAS_DIRECTORY}`;
}

/** URL for a file inside `data/areas/`, without double-encoding. */
export function areaFileUrl(
  baseUrl: string,
  fileName: string,
): string {
  const encoded = fileName
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${areasDirectoryUrl(baseUrl)}${encoded}`;
}

function normaliseAreaEntry(raw: unknown): BundledAreaEntry | null {
  if (!isRecord(raw)) return null;
  const slug = nonEmptyString(raw.slug);
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const name = nonEmptyString(raw.name) ?? slug;

  const center = isRecord(raw.center) ? raw.center : null;
  const centerLatDeg =
    finiteNumber(center?.latitudeDeg ?? center?.lat ?? raw.centerLatDeg) ??
    finiteNumber(raw.latitudeDeg);
  const centerLonDeg =
    finiteNumber(center?.longitudeDeg ?? center?.lon ?? raw.centerLonDeg) ??
    finiteNumber(raw.longitudeDeg);
  const radiusM = finiteNumber(raw.radiusM ?? raw.radius);
  if (
    centerLatDeg === null ||
    centerLonDeg === null ||
    radiusM === null ||
    Math.abs(centerLatDeg) > 90 ||
    Math.abs(centerLonDeg) > 180 ||
    radiusM <= 0
  ) {
    return null;
  }

  const file = nonEmptyString(raw.file) ?? `${slug}.geojson`;
  return {
    slug,
    name,
    centerLatDeg,
    centerLonDeg,
    radiusM,
    file,
    metadataFile: stringOrUndefined(raw.metadataFile),
    buildingCount: finiteNumber(raw.buildingCount) ?? undefined,
    defaultHeightCount: finiteNumber(raw.defaultHeightCount) ?? undefined,
    taggedHeightCount: finiteNumber(raw.taggedHeightCount) ?? undefined,
    retrievedAt: stringOrUndefined(raw.retrievedAt),
    osmTimestamp:
      raw.osmTimestamp === null
        ? null
        : stringOrUndefined(raw.osmTimestamp),
    license: stringOrUndefined(raw.license),
    attribution: stringOrUndefined(raw.attribution),
    sourceEndpoint: stringOrUndefined(raw.sourceEndpoint),
    sourceQuery: stringOrUndefined(raw.sourceQuery),
  };
}

/** Parse and validate a manifest. Invalid individual entries are skipped. */
export function normaliseBundledAreaManifest(
  value: unknown,
): BundledAreaManifest {
  if (Array.isArray(value)) {
    return {
      areas: value
        .map(normaliseAreaEntry)
        .filter((entry): entry is BundledAreaEntry => entry !== null),
    };
  }
  if (!isRecord(value) || !Array.isArray(value.areas)) {
    throw new BundledAreaError(
      'Bundled area manifest must contain an "areas" array.',
    );
  }
  return {
    schemaVersion: finiteNumber(value.schemaVersion) ?? undefined,
    generatedAt: stringOrUndefined(value.generatedAt),
    license: stringOrUndefined(value.license),
    attribution: stringOrUndefined(value.attribution),
    areas: value.areas
      .map(normaliseAreaEntry)
      .filter((entry): entry is BundledAreaEntry => entry !== null),
  };
}

/**
 * Load `data/areas/index.json`. A missing manifest means "no bundled areas",
 * which is a normal state, not an error.
 */
export async function loadBundledAreaManifest(
  baseUrl: string = DEFAULT_AREAS_BASE_URL,
  options: LoadBundledOptions = {},
): Promise<BundledAreaManifest> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = areaFileUrl(baseUrl, AREAS_MANIFEST_FILE);
  const response = await doFetch(url, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
    credentials: 'omit',
  });
  if (response.status === 404) {
    return { areas: [] };
  }
  if (!response.ok) {
    throw new BundledAreaError(
      `Bundled area manifest responded HTTP ${response.status}.`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new BundledAreaError('Bundled area manifest is not valid JSON.');
  }
  return normaliseBundledAreaManifest(value);
}

function distanceM(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (latB - latA) * toRad;
  const dLon = (lonB - lonA) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * toRad) * Math.cos(latB * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Find the smallest bundled area that fully covers a requested circle.
 *
 * Coverage is conservative: the distance between the requested centre and the
 * area centre plus the requested radius must fit inside the area radius.
 * Partial coverage is never returned, because silently using footprints that
 * stop at the edge would make a horizon look clearer than it is.
 */
export function findBundledArea(
  manifest: BundledAreaManifest,
  latitudeDeg: number,
  longitudeDeg: number,
  requiredRadiusM: number,
): BundledAreaEntry | null {
  if (
    !Number.isFinite(latitudeDeg) ||
    !Number.isFinite(longitudeDeg) ||
    !Number.isFinite(requiredRadiusM)
  ) {
    return null;
  }
  const radius = Math.max(0, requiredRadiusM);
  let best: BundledAreaEntry | null = null;
  let bestDistance = Infinity;
  for (const area of manifest.areas) {
    if (area.radiusM + COVERAGE_SLACK_M < radius) continue;
    const centreDistance = distanceM(
      latitudeDeg,
      longitudeDeg,
      area.centerLatDeg,
      area.centerLonDeg,
    );
    if (centreDistance + radius > area.radiusM + COVERAGE_SLACK_M) continue;
    if (
      best === null ||
      area.radiusM < best.radiusM - 1e-6 ||
      (Math.abs(area.radiusM - best.radiusM) <= 1e-6 &&
        centreDistance < bestDistance)
    ) {
      best = area;
      bestDistance = centreDistance;
    }
  }
  return best;
}

interface TopLevelMetadata {
  sourceLabel?: string;
  sourceUrl?: string;
  sourceQuery?: string;
  retrievedAt?: string;
  license?: string;
  osmTimestamp?: string | null;
}

function readTopLevelMetadata(value: unknown): TopLevelMetadata {
  if (!isRecord(value)) return {};
  const sourceObject = isRecord(value.source) ? value.source : null;
  const sourceString =
    typeof value.source === 'string' ? value.source.trim() : '';
  const name = nonEmptyString(value.name);
  const osm3s = isRecord(value.osm3s) ? value.osm3s : null;
  return {
    sourceLabel:
      sourceString.length > 0
        ? sourceString
        : name
          ? `Imported area: ${name}`
          : undefined,
    sourceUrl:
      stringOrUndefined(value.sourceEndpoint) ??
      stringOrUndefined(sourceObject?.endpoint) ??
      stringOrUndefined(sourceObject?.url),
    sourceQuery:
      stringOrUndefined(value.sourceQuery) ??
      stringOrUndefined(sourceObject?.query),
    retrievedAt:
      stringOrUndefined(value.retrievedAt) ??
      stringOrUndefined(sourceObject?.retrievedAt),
    license:
      stringOrUndefined(value.license) ??
      stringOrUndefined(sourceObject?.license),
    osmTimestamp:
      value.osmTimestamp === null
        ? null
        : stringOrUndefined(value.osmTimestamp) ??
          stringOrUndefined(sourceObject?.osmTimestamp) ??
          stringOrUndefined(osm3s?.timestamp_osm_base),
  };
}

function mergeMetadata(
  top: TopLevelMetadata,
  options: ImportedBuildingsOptions,
): Required<Pick<ImportedBuildingsOptions, 'source'>> &
  Omit<ImportedBuildingsOptions, 'source'> {
  return {
    source: options.source ?? 'import',
    sourceLabel: options.sourceLabel ?? top.sourceLabel,
    sourceUrl: options.sourceUrl ?? top.sourceUrl,
    sourceQuery: options.sourceQuery ?? top.sourceQuery,
    retrievedAt: options.retrievedAt ?? top.retrievedAt,
    license: options.license ?? top.license,
    fileName: options.fileName,
    osmTimestamp:
      options.osmTimestamp !== undefined
        ? options.osmTimestamp
        : top.osmTimestamp,
  };
}

function withProvenance(
  result: BuildingsResult,
  metadata: ReturnType<typeof mergeMetadata>,
): BuildingsResult {
  return {
    ...result,
    source: metadata.source,
    sourceLabel: metadata.sourceLabel,
    sourceUrl: metadata.sourceUrl,
    sourceQuery: metadata.sourceQuery,
    retrievedAt: metadata.retrievedAt,
    license: metadata.license,
    fileName: metadata.fileName,
    osmTimestamp:
      metadata.osmTimestamp !== undefined
        ? metadata.osmTimestamp
        : result.osmTimestamp,
  };
}

type Ring = Array<{ lat: number; lon: number }>;

function samePoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1e-12 && Math.abs(a.lon - b.lon) < 1e-12;
}

/**
 * Convert one GeoJSON linear ring ([lon, lat] pairs) into a lon/lat ring with
 * no repeated closing point. Invalid, degenerate or out-of-range rings return
 * null rather than a made-up footprint.
 */
function normaliseGeoJsonRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null;
  const ring: Ring = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lon = finiteNumber(point[0]);
    const lat = finiteNumber(point[1]);
    if (
      lon === null ||
      lat === null ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      return null;
    }
    const next = { lat, lon };
    const previous = ring[ring.length - 1];
    if (!previous || !samePoint(previous, next)) ring.push(next);
  }
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) return null;
  // Translate to the first vertex before the shoelace sum. Coordinates near
  // 45°N/25°E otherwise lose the zero-area test to cancellation, and a
  // collinear "ring" must never become a fake obstruction.
  const originLon = ring[0].lon;
  const originLat = ring[0].lat;
  let twiceArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twiceArea +=
      (a.lon - originLon) * (b.lat - originLat) -
      (b.lon - originLon) * (a.lat - originLat);
  }
  if (Math.abs(twiceArea) < 1e-14) return null;
  return ring;
}

/** Outer rings only: BuildingFeature cannot represent holes, so they are ignored. */
function outerRingsFromGeometry(geometry: unknown): Ring[] {
  if (!isRecord(geometry)) return [];
  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates)) return [];
    const ring = normaliseGeoJsonRing(geometry.coordinates[0]);
    return ring ? [ring] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) return [];
    const rings: Ring[] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon)) continue;
      const ring = normaliseGeoJsonRing(polygon[0]);
      if (ring) rings.push(ring);
    }
    return rings;
  }
  return [];
}

function tagsFromProperties(
  properties: Record<string, unknown>,
): Record<string, string> {
  const tags: Record<string, string> = {};
  if (isRecord(properties.tags)) {
    for (const [key, value] of Object.entries(properties.tags)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        tags[key] = String(value);
      }
    }
  }
  const excluded = new Set([
    'tags',
    'heightM',
    'heightSource',
    'levels',
    'osmId',
    'id',
    '@id',
    'type',
  ]);
  for (const [key, value] of Object.entries(properties)) {
    if (excluded.has(key) || key in tags) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      tags[key] = String(value);
    }
  }
  return tags;
}

function heightInfoForFeature(
  properties: Record<string, unknown>,
  tags: Record<string, string>,
): {
  tags: Record<string, string>;
  heightM: number;
  heightSource: HeightSource;
  levels: number | null;
} {
  const levels = finiteNumber(properties.levels);
  if (
    levels !== null &&
    levels >= 0 &&
    levels <= 200 &&
    tags['building:levels'] === undefined
  ) {
    tags['building:levels'] = String(levels);
  }
  const hasHeightKeys =
    tags['building:height'] !== undefined ||
    tags.height !== undefined ||
    tags['building:levels'] !== undefined;
  const info = buildingHeightFromTags(tags);
  if (hasHeightKeys) {
    return { tags, ...info };
  }
  // Third-party GeoJSON often has no OSM tags at all. Preserve an explicit
  // height when present; never invent one beyond the normal 8 m fallback.
  const explicitHeight = finiteNumber(properties.heightM);
  if (
    explicitHeight !== null &&
    explicitHeight > 0 &&
    explicitHeight <= 1_500
  ) {
    return {
      tags,
      heightM: explicitHeight,
      heightSource: isHeightSource(properties.heightSource)
        ? properties.heightSource
        : 'height',
      levels: levels !== null && levels >= 0 && levels <= 200 ? levels : null,
    };
  }
  if (typeof tags.height === 'string') {
    const parsed = parseHeightMeters(tags.height);
    if (parsed !== null) {
      return {
        tags,
        heightM: parsed,
        heightSource: 'height',
        levels: parseLevels(tags['building:levels']),
      };
    }
  }
  return { tags, ...info };
}

function numericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    const match = /([0-9]+)\s*$/.exec(value);
    if (match) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id)) return id;
    }
  }
  return null;
}

function osmTimestampOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const osm3s = isRecord(value.osm3s) ? value.osm3s : null;
  return stringOrUndefined(osm3s?.timestamp_osm_base) ?? null;
}

/**
 * Parse a GeoJSON FeatureCollection (or Feature, or array of Features).
 * Polygon and MultiPolygon outer rings are supported; invalid rings are
 * skipped. Height priority is identical to the live Overpass parser.
 */
export function parseGeoJsonBuildings(
  geojson: unknown,
  centerLatDeg: number,
  centerLonDeg: number,
  queryRadiusM: number,
  options: ImportedBuildingsOptions = {},
): BuildingsResult {
  let features: unknown[];
  if (Array.isArray(geojson)) {
    features = geojson;
  } else if (isRecord(geojson) && geojson.type === 'FeatureCollection') {
    if (!Array.isArray(geojson.features)) {
      throw new BundledAreaError(
        'GeoJSON FeatureCollection has no features array.',
      );
    }
    features = geojson.features;
  } else if (isRecord(geojson) && geojson.type === 'Feature') {
    features = [geojson];
  } else {
    throw new BundledAreaError(
      'Imported building data is not a GeoJSON FeatureCollection.',
    );
  }

  const top = readTopLevelMetadata(geojson);
  const metadata = mergeMetadata(top, options);
  const buildings: BuildingFeature[] = [];
  let defaultHeightCount = 0;
  let taggedHeightCount = 0;
  let fallbackId = 1;
  const usedIds = new Set<number>();

  const nextId = (base: number | null, part: number, parts: number): number => {
    let id =
      base !== null && Number.isSafeInteger(base)
        ? parts > 1
          ? base * 100 + part
          : base
        : fallbackId++;
    if (!Number.isSafeInteger(id)) id = fallbackId++;
    while (usedIds.has(id)) id = fallbackId++;
    usedIds.add(id);
    return id;
  };

  for (const feature of features) {
    if (!isRecord(feature) || !isRecord(feature.geometry)) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const rings = outerRingsFromGeometry(feature.geometry);
    if (rings.length === 0) continue;
    const height = heightInfoForFeature(properties, tagsFromProperties(properties));
    if (height.tags.building?.trim().toLowerCase() === 'no') continue;
    const baseId =
      numericId(feature.id) ??
      numericId(properties.osmId) ??
      numericId(properties.id) ??
      numericId(properties['@id']);
    for (let part = 0; part < rings.length; part++) {
      const id = nextId(baseId, part, rings.length);
      if (height.heightSource === 'default') defaultHeightCount++;
      else taggedHeightCount++;
      buildings.push({
        id,
        ring: rings[part],
        heightM: height.heightM,
        heightSource: height.heightSource,
        levels: height.levels,
        tags: height.tags,
      });
    }
  }

  return withProvenance(
    {
      buildings,
      defaultHeightCount,
      taggedHeightCount,
      centerLatDeg,
      centerLonDeg,
      queryRadiusM,
      fetchedAt: Date.now(),
      source: metadata.source,
      osmTimestamp: null,
    },
    metadata,
  );
}

/**
 * Parse either GeoJSON or an Overpass `out geom;` JSON document from text.
 * Useful for files a user drops in without a sidecar.
 */
export function parseImportedBuildings(
  text: string,
  centerLatDeg: number,
  centerLonDeg: number,
  queryRadiusM: number,
  options: ImportedBuildingsOptions = {},
): BuildingsResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BundledAreaError('Imported building data is not valid JSON.');
  }
  if (isRecord(value) && Array.isArray(value.elements)) {
    const response = value as unknown as OverpassResponse;
    const result = parseOverpassBuildings(
      response,
      centerLatDeg,
      centerLonDeg,
      queryRadiusM,
      options.source ?? 'import',
    );
    const top = readTopLevelMetadata(value);
    return withProvenance(
      result,
      mergeMetadata(
        {
          ...top,
          osmTimestamp: top.osmTimestamp ?? osmTimestampOf(value),
        },
        options,
      ),
    );
  }
  return parseGeoJsonBuildings(
    value,
    centerLatDeg,
    centerLonDeg,
    queryRadiusM,
    options,
  );
}

interface SidecarMetadata {
  sourceEndpoint?: string;
  sourceQuery?: string;
  retrievedAt?: string;
  osmTimestamp?: string | null;
  license?: string;
  attribution?: string;
  name?: string;
}

function readSidecar(value: unknown): SidecarMetadata {
  if (!isRecord(value)) return {};
  const source = isRecord(value.source) ? value.source : null;
  return {
    sourceEndpoint:
      stringOrUndefined(source?.endpoint) ??
      stringOrUndefined(value.sourceEndpoint),
    sourceQuery:
      stringOrUndefined(source?.query) ?? stringOrUndefined(value.sourceQuery),
    retrievedAt:
      stringOrUndefined(source?.retrievedAt) ??
      stringOrUndefined(value.retrievedAt),
    osmTimestamp:
      value.osmTimestamp === null
        ? null
        : stringOrUndefined(source?.osmTimestamp) ??
          stringOrUndefined(value.osmTimestamp),
    license: stringOrUndefined(value.license),
    attribution: stringOrUndefined(value.attribution),
    name: stringOrUndefined(value.name),
  };
}

/**
 * Load one bundled area's GeoJSON plus its optional sidecar. The result keeps
 * the source endpoint, query, retrieval time, OSM timestamp and file name.
 */
export async function loadBundledBuildings(
  baseUrl: string,
  area: BundledAreaEntry,
  options: LoadBundledOptions = {},
): Promise<BuildingsResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = areaFileUrl(baseUrl, area.file);
  const response = await doFetch(url, {
    headers: { Accept: 'application/geo+json, application/json' },
    signal: options.signal,
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new BundledAreaError(
      `Bundled area "${area.name}" responded HTTP ${response.status}.`,
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (options.signal?.aborted) {
      const aborted = new Error('Building query cancelled');
      aborted.name = 'AbortError';
      throw aborted;
    }
    throw error instanceof Error
      ? error
      : new BundledAreaError(`Could not read bundled area "${area.name}".`);
  }

  const result = parseImportedBuildings(
    text,
    area.centerLatDeg,
    area.centerLonDeg,
    area.radiusM,
    {
      source: 'bundled',
      sourceLabel: `Bundled area: ${area.name}`,
      sourceUrl: area.sourceEndpoint,
      sourceQuery: area.sourceQuery,
      retrievedAt: area.retrievedAt,
      license: area.license,
      fileName: area.file,
    },
  );

  let sidecar: SidecarMetadata = {};
  if (area.metadataFile) {
    try {
      const metadataResponse = await doFetch(
        areaFileUrl(baseUrl, area.metadataFile),
        {
          headers: { Accept: 'application/json' },
          signal: options.signal,
          credentials: 'omit',
        },
      );
      if (metadataResponse.ok) {
        sidecar = readSidecar(await metadataResponse.json());
      }
    } catch (error) {
      if (options.signal?.aborted) {
        const aborted = new Error('Building query cancelled');
        aborted.name = 'AbortError';
        throw aborted;
      }
      // A missing/broken sidecar must not discard otherwise valid footprints.
      sidecar = {};
    }
  }

  return {
    ...result,
    source: 'bundled',
    sourceLabel: `Bundled area: ${sidecar.name ?? area.name}`,
    sourceUrl: sidecar.sourceEndpoint ?? area.sourceEndpoint ?? url,
    sourceQuery: sidecar.sourceQuery ?? area.sourceQuery ?? result.sourceQuery,
    retrievedAt: sidecar.retrievedAt ?? area.retrievedAt ?? result.retrievedAt,
    license: sidecar.license ?? area.license ?? result.license,
    fileName: area.file,
    osmTimestamp:
      sidecar.osmTimestamp !== undefined
        ? sidecar.osmTimestamp
        : area.osmTimestamp !== undefined
          ? area.osmTimestamp
          : result.osmTimestamp,
  };
}

export type { BuildingsSource };
