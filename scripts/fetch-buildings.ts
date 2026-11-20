/**
 * Fetch one building area from Overpass and write a static, ODbL-licensed
 * snapshot for the app to use offline.
 *
 * Run with:
 *   npm run fetch:buildings -- --lat=45.6427 --lon=25.5887 --radius=1500 --name=brasov
 *
 * Outputs (under public/data/areas by default):
 *   <slug>.geojson   FeatureCollection, Polygon outer rings
 *   <slug>.json      metadata sidecar (endpoint, exact query, counts, licence)
 *   index.json       sorted manifest consumed by src/terrain/bundledAreas.ts
 *
 * Policy: serial requests only, descriptive User-Agent, 2.5 s minimum gap,
 * bounded 30/60/120 s backoff, at most three attempts per endpoint, four
 * mirrors tried in a longitude-appropriate order. No UA rotation, no parallel
 * scripts, no tile caching. A failed fetch writes nothing.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseOverpassBuildings,
  type OverpassResponse,
} from '../src/terrain/buildings';
import {
  normaliseBundledAreaManifest,
  OSM_ATTRIBUTION,
  OSM_LICENSE,
  OSM_LICENSE_URL,
  type BundledAreaEntry,
} from '../src/terrain/bundledAreas';
import type { BuildingsResult, HeightSource } from '../src/terrain/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_AREAS_DIR = resolve(ROOT, 'public/data/areas');
export const BUILDING_USER_AGENT =
  'ApophisWatch/0.1 (+https://github.com/; one-off offline area build; polite)';
export const REQUEST_GAP_MS = 2_500;
export const ENDPOINT_BACKOFF_MS = [30_000, 60_000, 120_000] as const;
export const MAX_ATTEMPTS_PER_ENDPOINT = 3;
export const MAX_SCRIPT_RADIUS_M = 20_000;
const REQUEST_TIMEOUT_MS = 90_000;

export const OVERPASS_BUILD_ENDPOINTS = {
  dreselEu: 'https://ovp.dresel.systems/api/interpreter',
  dreselNa: 'https://ovp.dresel.systems/api-na/interpreter',
  overpassApiDe: 'https://overpass-api.de/api/interpreter',
  mapsMailRu: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  privateCoffee: 'https://overpass.private.coffee/api/interpreter',
} as const;

export interface FetchBuildingsArgs {
  latitudeDeg: number;
  longitudeDeg: number;
  radiusM: number;
  name: string;
  slug: string;
  outDir: string;
  dryRun: boolean;
  help: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export function slugifyAreaName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'area';
}

function parseNumber(value: string, label: string): number {
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number, got "${value}".`);
  }
  return number;
}

/** Parse the CLI without touching the network or filesystem. */
export function parseFetchBuildingsArgs(argv: string[]): FetchBuildingsArgs {
  let latitudeDeg: number | null = null;
  let longitudeDeg: number | null = null;
  let radiusM: number | null = null;
  let name: string | null = null;
  let slug: string | null = null;
  let outDir = DEFAULT_AREAS_DIR;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argument);
    if (!match) {
      throw new Error(`Unknown argument "${argument}". Use --help for usage.`);
    }
    const key = match[1];
    let value = match[2];
    if (value === undefined) {
      value = argv[++index];
      if (value === undefined) {
        throw new Error(`--${key} needs a value.`);
      }
    }
    switch (key) {
      case 'lat':
      case 'latitude':
        latitudeDeg = parseNumber(value, '--lat');
        break;
      case 'lon':
      case 'lng':
      case 'longitude':
        longitudeDeg = parseNumber(value, '--lon');
        break;
      case 'radius':
      case 'radius-m':
        radiusM = parseNumber(value, '--radius');
        break;
      case 'name':
        name = value.trim();
        break;
      case 'slug':
        slug = slugifyAreaName(value);
        break;
      case 'out':
      case 'out-dir':
        outDir = resolve(value);
        break;
      default:
        throw new Error(`Unknown option "--${key}". Use --help for usage.`);
    }
  }

  if (help) {
    return {
      latitudeDeg: latitudeDeg ?? 0,
      longitudeDeg: longitudeDeg ?? 0,
      radiusM: radiusM ?? 1_500,
      name: name ?? '',
      slug: slug ?? 'area',
      outDir,
      dryRun,
      help: true,
    };
  }
  if (latitudeDeg === null || longitudeDeg === null || radiusM === null || !name) {
    throw new Error(
      'Missing required options. Expected --lat, --lon, --radius and --name.',
    );
  }
  if (Math.abs(latitudeDeg) > 90) {
    throw new Error('--lat must be between -90 and 90.');
  }
  if (Math.abs(longitudeDeg) > 180) {
    throw new Error('--lon must be between -180 and 180.');
  }
  if (radiusM < 1 || radiusM > MAX_SCRIPT_RADIUS_M) {
    throw new Error(
      `--radius must be between 1 and ${MAX_SCRIPT_RADIUS_M} m.`,
    );
  }
  if (name.length > 80) {
    throw new Error('--name must be at most 80 characters.');
  }
  return {
    latitudeDeg,
    longitudeDeg,
    radiusM: Math.round(radiusM),
    name,
    slug: slug ?? slugifyAreaName(name),
    outDir,
    dryRun,
    help: false,
  };
}

/** Exact build query: building ways only, 60 s server timeout, 256 MiB cap. */
export function buildBuildingsQuery(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
): string {
  const radius = Math.round(radiusM);
  return `[out:json][timeout:60][maxsize:268435456];way["building"](around:${radius},${latitudeDeg.toFixed(
    6,
  )},${longitudeDeg.toFixed(6)});out geom;`;
}

/**
 * Recommended build-time mirror order. Europe and North America start with
 * the dresel mirror on the matching continent; other longitudes start with
 * overpass-api.de. maps.mail.ru and overpass.private.coffee are fallbacks.
 * Four endpoints, serial.
 */
export function orderOverpassEndpoints(longitudeDeg: number): string[] {
  const northAmerica = longitudeDeg >= -170 && longitudeDeg <= -30;
  const europe = longitudeDeg >= -25 && longitudeDeg <= 60;
  const primary = northAmerica
    ? OVERPASS_BUILD_ENDPOINTS.dreselNa
    : europe
      ? OVERPASS_BUILD_ENDPOINTS.dreselEu
      : OVERPASS_BUILD_ENDPOINTS.overpassApiDe;
  const fallbacks =
    primary === OVERPASS_BUILD_ENDPOINTS.overpassApiDe
      ? [
          OVERPASS_BUILD_ENDPOINTS.dreselEu,
          OVERPASS_BUILD_ENDPOINTS.mapsMailRu,
          OVERPASS_BUILD_ENDPOINTS.privateCoffee,
        ]
      : [
          OVERPASS_BUILD_ENDPOINTS.overpassApiDe,
          OVERPASS_BUILD_ENDPOINTS.mapsMailRu,
          OVERPASS_BUILD_ENDPOINTS.privateCoffee,
        ];
  return [primary, ...fallbacks];
}

function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

function parseRetryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(15 * 60_000, seconds * 1000);
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.min(15 * 60_000, date - Date.now()));
  }
  return 0;
}

interface FetchOnceResult {
  response: Response;
}

async function fetchOnce(
  endpoint: string,
  query: string,
): Promise<FetchOnceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'User-Agent': BUILDING_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    return { response };
  } finally {
    clearTimeout(timer);
  }
}

export interface EndpointAttempt {
  endpoint: string;
  status: number | null;
  ok: boolean;
  detail?: string;
}

export interface FetchedBuildingArea {
  response: OverpassResponse;
  endpoint: string;
  query: string;
  attempts: EndpointAttempt[];
}

/**
 * Serial Overpass fetch with bounded retries. No stock UAs, no rotation, no
 * parallelism. A 406 is not repeated on the same endpoint; 429/502/503/504
 * use the documented 30/60/120 s backoff.
 */
export async function fetchAreaBuildings(
  args: Pick<
    FetchBuildingsArgs,
    'latitudeDeg' | 'longitudeDeg' | 'radiusM'
  >,
  log: (message: string) => void = () => undefined,
): Promise<FetchedBuildingArea> {
  const query = buildBuildingsQuery(
    args.latitudeDeg,
    args.longitudeDeg,
    args.radiusM,
  );
  const endpoints = orderOverpassEndpoints(args.longitudeDeg);
  const attempts: EndpointAttempt[] = [];
  let lastRequestAt = 0;
  let lastError: unknown = null;

  const waitForGap = async (): Promise<void> => {
    const remaining = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (remaining > 0) await sleep(remaining);
  };

  for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
    const endpoint = endpoints[endpointIndex];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
      await waitForGap();
      lastRequestAt = Date.now();
      log(`[${endpointIndex + 1}/${endpoints.length}] ${endpointLabel(endpoint)} · attempt ${attempt}/${MAX_ATTEMPTS_PER_ENDPOINT}`);
      let response: Response;
      try {
        ({ response } = await fetchOnce(endpoint, query));
      } catch (error) {
        lastError = error;
        const detail = error instanceof Error ? error.message : String(error);
        attempts.push({ endpoint, status: null, ok: false, detail });
        log(`  network/timeout error: ${detail}`);
        if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
          const wait = ENDPOINT_BACKOFF_MS[attempt - 1];
          log(`  backing off ${Math.round(wait / 1000)} s…`);
          await sleep(wait);
          continue;
        }
        break;
      }

      if (response.ok) {
        let text: string;
        try {
          text = await response.text();
        } catch (error) {
          lastError = error;
          attempts.push({
            endpoint,
            status: response.status,
            ok: false,
            detail: 'could not read response body',
          });
          if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
            const wait = ENDPOINT_BACKOFF_MS[attempt - 1];
            log(`  response read failed; backing off ${Math.round(wait / 1000)} s…`);
            await sleep(wait);
            continue;
          }
          break;
        }
        try {
          const json = JSON.parse(text) as OverpassResponse;
          if (!Array.isArray(json.elements)) {
            throw new Error('response has no elements array');
          }
          if (
            json.remark &&
            /timed out|runtime error|out of memory/i.test(json.remark)
          ) {
            throw new Error(`Overpass remark: ${json.remark}`);
          }
          attempts.push({ endpoint, status: response.status, ok: true });
          return { response: json, endpoint, query, attempts };
        } catch (error) {
          lastError = error;
          const detail = error instanceof Error ? error.message : String(error);
          attempts.push({
            endpoint,
            status: response.status,
            ok: false,
            detail,
          });
          log(`  invalid Overpass response: ${detail}`);
          if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
            const wait = ENDPOINT_BACKOFF_MS[attempt - 1];
            log(`  backing off ${Math.round(wait / 1000)} s…`);
            await sleep(wait);
            continue;
          }
          break;
        }
      }

      const status = response.status;
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('Retry-After'),
      );
      const body = (await response.text().catch(() => ''))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const detail = `HTTP ${status}${body ? `: ${body.slice(0, 160)}` : ''}`;
      lastError = new Error(`${endpointLabel(endpoint)} ${detail}`);
      attempts.push({ endpoint, status, ok: false, detail });

      if (status === 406) {
        // The client itself was blocked; a different UA/endpoint is required.
        log(`  ${detail}`);
        log('  HTTP 406 is a client/User-Agent block; not retrying this endpoint.');
        const wait = ENDPOINT_BACKOFF_MS[0];
        log(`  backing off ${Math.round(wait / 1000)} s before the next mirror…`);
        await sleep(wait);
        break;
      }
      if (status === 429 || status === 502 || status === 503 || status === 504) {
        log(`  ${detail}`);
        if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
          const wait = Math.max(
            ENDPOINT_BACKOFF_MS[attempt - 1],
            status === 429 ? retryAfterMs : 0,
          );
          log(`  backing off ${Math.round(wait / 1000)} s…`);
          await sleep(wait);
          continue;
        }
        break;
      }
      if (status >= 500) {
        log(`  ${detail}`);
        if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
          const wait = ENDPOINT_BACKOFF_MS[attempt - 1];
          log(`  backing off ${Math.round(wait / 1000)} s…`);
          await sleep(wait);
          continue;
        }
        break;
      }

      // 4xx other than 429/406 is a query/argument problem, not a mirror
      // problem. Stop rather than hammer more endpoints.
      throw new Error(
        `Overpass rejected the query at ${endpointLabel(endpoint)}: ${detail}`,
      );
    }
  }

  const tried = attempts
    .map((attempt) => `${endpointLabel(attempt.endpoint)} → ${attempt.detail ?? attempt.status ?? 'failure'}`)
    .join('; ');
  const message =
    lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(
    `All Overpass endpoints failed; no files were written. Last error: ${message}. Tried: ${tried}`,
  );
}

export interface AreaMetadata {
  schemaVersion: 1;
  slug: string;
  name: string;
  center: { latitudeDeg: number; longitudeDeg: number };
  radiusM: number;
  source: {
    provider: 'OpenStreetMap / Overpass API';
    endpoint: string;
    query: string;
    retrievedAt: string;
    osmTimestamp: string | null;
  };
  license: string;
  licenseUrl: string;
  attribution: string;
  files: { geojson: string; manifest: string };
  counts: {
    buildings: number;
    defaultHeightCount: number;
    taggedHeightCount: number;
    heightSource: Record<HeightSource, number>;
  };
}

export interface BuildAreaMetadataInput {
  slug: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  radiusM: number;
  endpoint: string;
  query: string;
  retrievedAt: string;
  osmTimestamp: string | null;
  result: BuildingsResult;
}

export function buildAreaMetadata(
  input: BuildAreaMetadataInput,
): AreaMetadata {
  const heightSource: Record<HeightSource, number> = {
    'building:height': 0,
    height: 0,
    levels: 0,
    default: 0,
  };
  for (const building of input.result.buildings) {
    heightSource[building.heightSource]++;
  }
  return {
    schemaVersion: 1,
    slug: input.slug,
    name: input.name,
    center: {
      latitudeDeg: input.latitudeDeg,
      longitudeDeg: input.longitudeDeg,
    },
    radiusM: input.radiusM,
    source: {
      provider: 'OpenStreetMap / Overpass API',
      endpoint: input.endpoint,
      query: input.query,
      retrievedAt: input.retrievedAt,
      osmTimestamp: input.osmTimestamp,
    },
    license: OSM_LICENSE,
    licenseUrl: OSM_LICENSE_URL,
    attribution: OSM_ATTRIBUTION,
    files: {
      geojson: `${input.slug}.geojson`,
      manifest: 'index.json',
    },
    counts: {
      buildings: input.result.buildings.length,
      defaultHeightCount: input.result.defaultHeightCount,
      taggedHeightCount: input.result.taggedHeightCount,
      heightSource,
    },
  };
}

export interface AreaGeoJsonFeature {
  type: 'Feature';
  id: number;
  properties: {
    osmId: number;
    heightM: number;
    heightSource: HeightSource;
    levels: number | null;
    tags: Record<string, string>;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface AreaGeoJson {
  type: 'FeatureCollection';
  name: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  retrievedAt: string;
  osmTimestamp: string | null;
  center: { latitudeDeg: number; longitudeDeg: number };
  radiusM: number;
  sourceEndpoint: string;
  sourceQuery: string;
  bbox?: [number, number, number, number];
  features: AreaGeoJsonFeature[];
}

const roundCoordinate = (value: number): number =>
  Math.round(value * 1e7) / 1e7;
const roundMetres = (value: number): number =>
  Math.round(value * 1e3) / 1e3;

/** Build the static GeoJSON. Every feature carries its height provenance. */
export function buildAreaGeoJson(
  result: BuildingsResult,
  metadata: AreaMetadata,
): AreaGeoJson {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  const features: AreaGeoJsonFeature[] = [];
  for (const building of result.buildings) {
    const ring: number[][] = [];
    for (const point of building.ring) {
      const lon = roundCoordinate(point.lon);
      const lat = roundCoordinate(point.lat);
      ring.push([lon, lat]);
      south = Math.min(south, lat);
      west = Math.min(west, lon);
      north = Math.max(north, lat);
      east = Math.max(east, lon);
    }
    if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);
    features.push({
      type: 'Feature',
      id: building.id,
      properties: {
        osmId: building.id,
        heightM: roundMetres(building.heightM),
        heightSource: building.heightSource,
        levels: building.levels,
        tags: building.tags,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    });
  }
  const geojson: AreaGeoJson = {
    type: 'FeatureCollection',
    name: metadata.name,
    license: metadata.license,
    licenseUrl: metadata.licenseUrl,
    attribution: metadata.attribution,
    retrievedAt: metadata.source.retrievedAt,
    osmTimestamp: metadata.source.osmTimestamp,
    center: metadata.center,
    radiusM: metadata.radiusM,
    sourceEndpoint: metadata.source.endpoint,
    sourceQuery: metadata.source.query,
    features,
  };
  if (features.length > 0) {
    geojson.bbox = [west, south, east, north];
  }
  return geojson;
}

export interface AreaManifestFile {
  schemaVersion: 1;
  generatedAt: string;
  license: string;
  attribution: string;
  areas: BundledAreaEntry[];
}

export function buildManifestEntry(metadata: AreaMetadata): BundledAreaEntry {
  return {
    slug: metadata.slug,
    name: metadata.name,
    centerLatDeg: metadata.center.latitudeDeg,
    centerLonDeg: metadata.center.longitudeDeg,
    radiusM: metadata.radiusM,
    file: metadata.files.geojson,
    metadataFile: `${metadata.slug}.json`,
    buildingCount: metadata.counts.buildings,
    defaultHeightCount: metadata.counts.defaultHeightCount,
    taggedHeightCount: metadata.counts.taggedHeightCount,
    retrievedAt: metadata.source.retrievedAt,
    osmTimestamp: metadata.source.osmTimestamp,
    license: metadata.license,
    attribution: metadata.attribution,
    sourceEndpoint: metadata.source.endpoint,
    sourceQuery: metadata.source.query,
  };
}

/**
 * Replace the entry with the same slug, then sort by slug. Other areas in the
 * manifest are preserved, so adding one city never drops another.
 */
export function mergeAreaManifest(
  existing: unknown,
  entry: BundledAreaEntry,
  generatedAt: string,
): AreaManifestFile {
  const areas =
    existing === null
      ? []
      : normaliseBundledAreaManifest(existing).areas.filter(
          (area) => area.slug !== entry.slug,
        );
  areas.push(entry);
  areas.sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    schemaVersion: 1,
    generatedAt,
    license: OSM_LICENSE,
    attribution: OSM_ATTRIBUTION,
    areas,
  };
}

async function readManifestIfExists(path: string): Promise<unknown | null> {
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read existing ${path}: ${detail}`);
  }
}

let temporaryFileCounter = 0;

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${temporaryFileCounter++}.tmp`;
  try {
    await writeFile(temporary, contents, 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export const HELP_TEXT = `Apophis Watch building area fetch

Usage:
  npm run fetch:buildings -- --lat=45.6427 --lon=25.5887 --radius=1500 --name=brasov
  npx tsx scripts/fetch-buildings.ts --lat=45.6427 --lon=25.5887 --radius=1500 --name=brasov

Options:
  --lat=...      WGS84 latitude, -90..90 (required)
  --lon=...      WGS84 longitude, -180..180 (required)
  --radius=...   Radius in metres, 1..${MAX_SCRIPT_RADIUS_M} (required)
  --name=...     Human-readable area name (required)
  --slug=...     Output slug (default: derived from --name)
  --out=DIR      Output directory (default: public/data/areas)
  --dry-run      Print the query and mirror order; do not fetch or write
  --help, -h     Show this help

The script makes one serial Overpass request at a time with a descriptive
User-Agent. It tries the recommended mirror for the longitude first, backs off
30/60/120 s on 429/502/503/504 (and 30 s before switching on 406), and never
runs parallel requests. OSM data is © OpenStreetMap contributors, ODbL 1.0.`;

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseFetchBuildingsArgs(argv);
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const query = buildBuildingsQuery(
    args.latitudeDeg,
    args.longitudeDeg,
    args.radiusM,
  );
  const endpoints = orderOverpassEndpoints(args.longitudeDeg);
  console.log('Apophis Watch building area fetch');
  console.log(`  area:   ${args.name} (${args.slug})`);
  console.log(
    `  centre: ${args.latitudeDeg.toFixed(6)}, ${args.longitudeDeg.toFixed(6)} · radius ${args.radiusM} m`,
  );
  console.log(`  query:  ${query}`);
  console.log('  mirrors in order:');
  for (const endpoint of endpoints) console.log(`    ${endpoint}`);
  console.log('  data: © OpenStreetMap contributors, ODbL 1.0');

  if (args.dryRun) {
    console.log('\nDry run: no request made and no files written.');
    return;
  }

  const fetched = await fetchAreaBuildings(args, (message) =>
    console.log(`  ${message}`),
  );
  const result = parseOverpassBuildings(
    fetched.response,
    args.latitudeDeg,
    args.longitudeDeg,
    args.radiusM,
    'network',
  );
  const retrievedAt = new Date().toISOString();
  const metadata = buildAreaMetadata({
    slug: args.slug,
    name: args.name,
    latitudeDeg: args.latitudeDeg,
    longitudeDeg: args.longitudeDeg,
    radiusM: args.radiusM,
    endpoint: fetched.endpoint,
    query: fetched.query,
    retrievedAt,
    osmTimestamp: result.osmTimestamp,
    result,
  });
  const geojson = buildAreaGeoJson(result, metadata);
  const manifestEntry = buildManifestEntry(metadata);

  const geojsonPath = resolve(args.outDir, `${args.slug}.geojson`);
  const metadataPath = resolve(args.outDir, `${args.slug}.json`);
  const manifestPath = resolve(args.outDir, 'index.json');

  // Read and validate the existing manifest before writing anything, so a
  // malformed index cannot leave a half-updated area behind.
  const existingManifest = await readManifestIfExists(manifestPath);
  const manifest = mergeAreaManifest(
    existingManifest,
    manifestEntry,
    retrievedAt,
  );

  await writeFileAtomic(
    geojsonPath,
    `${JSON.stringify(geojson, null, 2)}\n`,
  );
  await writeFileAtomic(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `\nLoaded ${result.buildings.length} building ways; ${result.defaultHeightCount} use the 8 m default, ${result.taggedHeightCount} are tagged.`,
  );
  console.log(`  height sources: ${JSON.stringify(metadata.counts.heightSource)}`);
  console.log(`  OSM timestamp: ${result.osmTimestamp ?? 'not supplied'}`);
  console.log(`  wrote ${geojsonPath}`);
  console.log(`  wrote ${metadataPath}`);
  console.log(`  wrote ${manifestPath}`);
  console.log(
    '\nAttribution: © OpenStreetMap contributors, ODbL 1.0 — keep the attribution with any redistribution.',
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      '\nFATAL:',
      error instanceof Error ? error.message : String(error),
    );
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  });
}
