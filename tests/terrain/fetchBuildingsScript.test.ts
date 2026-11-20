import { describe, expect, it } from 'vitest';
import {
  buildAreaGeoJson,
  buildAreaMetadata,
  buildBuildingsQuery,
  buildManifestEntry,
  mergeAreaManifest,
  orderOverpassEndpoints,
  parseFetchBuildingsArgs,
  slugifyAreaName,
} from '../../scripts/fetch-buildings';
import {
  parseOverpassBuildings,
  type OverpassResponse,
} from '../../src/terrain/buildings';
import { parseImportedBuildings } from '../../src/terrain/bundledAreas';

const BRASOV = {
  latitudeDeg: 45.6427,
  longitudeDeg: 25.5887,
  radiusM: 1_500,
  name: 'Brașov',
  slug: 'brasov',
};

function response(): OverpassResponse {
  const square = (lon: number, lat: number) => [
    { lat, lon },
    { lat, lon: lon + 0.0001 },
    { lat: lat + 0.0001, lon: lon + 0.0001 },
    { lat: lat + 0.0001, lon },
    { lat, lon },
  ];
  return {
    version: 0.6,
    osm3s: { timestamp_osm_base: '2026-11-20T10:00:00Z' },
    elements: [
      {
        type: 'way',
        id: 1,
        tags: { building: 'house', 'building:height': '12.5' },
        geometry: square(25.5887, 45.6427),
      },
      {
        type: 'way',
        id: 2,
        tags: { building: 'yes', 'building:levels': '4' },
        geometry: square(25.589, 45.6427),
      },
      {
        type: 'way',
        id: 3,
        tags: { building: 'shed' },
        geometry: square(25.5893, 45.6427),
      },
    ],
  };
}

describe('fetch-buildings CLI arguments', () => {
  it('parses the documented command line', () => {
    const args = parseFetchBuildingsArgs([
      '--lat=45.6427',
      '--lon=25.5887',
      '--radius=1500',
      '--name=brasov',
    ]);
    expect(args).toMatchObject({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_500,
      name: 'brasov',
      slug: 'brasov',
      dryRun: false,
      help: false,
    });
    expect(args.outDir).toContain('public/data/areas');
  });

  it('accepts space-separated values, slugs and dry-run', () => {
    const args = parseFetchBuildingsArgs([
      '--lat',
      '45.6427',
      '--lon',
      '25.5887',
      '--radius',
      '1500',
      '--name',
      'Brașov, Romania',
      '--slug',
      'Brasov City',
      '--dry-run',
    ]);
    expect(args.slug).toBe('brasov-city');
    expect(args.dryRun).toBe(true);
  });

  it('rejects missing, out-of-range and unknown options', () => {
    expect(() => parseFetchBuildingsArgs([])).toThrow(/Missing required/);
    expect(() =>
      parseFetchBuildingsArgs([
        '--lat=100',
        '--lon=25',
        '--radius=1000',
        '--name=x',
      ]),
    ).toThrow(/--lat/);
    expect(() =>
      parseFetchBuildingsArgs([
        '--lat=45',
        '--lon=25',
        '--radius=25000',
        '--name=x',
      ]),
    ).toThrow(/--radius/);
    expect(() =>
      parseFetchBuildingsArgs([
        '--lat=45',
        '--lon=25',
        '--radius=1000',
        '--name=x',
        '--wat=1',
      ]),
    ).toThrow(/Unknown option/);
  });

  it('prints help without requiring the other options', () => {
    const args = parseFetchBuildingsArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('derives a stable ASCII slug', () => {
    expect(slugifyAreaName('Brașov, Romania')).toBe('brasov-romania');
    expect(slugifyAreaName('  ---  ')).toBe('area');
  });
});

describe('Overpass build query and mirror order', () => {
  it('produces the exact documented query', () => {
    expect(buildBuildingsQuery(45.6427, 25.5887, 1_500)).toBe(
      '[out:json][timeout:60][maxsize:268435456];way["building"](around:1500,45.642700,25.588700);out geom;',
    );
  });

  it('uses the EU mirror first in Europe and the NA mirror in North America', () => {
    const europe = orderOverpassEndpoints(25.5887);
    expect(europe[0]).toBe('https://ovp.dresel.systems/api/interpreter');
    expect(europe[1]).toBe('https://overpass-api.de/api/interpreter');
    expect(europe).toHaveLength(4);

    const northAmerica = orderOverpassEndpoints(-122.4194);
    expect(northAmerica[0]).toBe(
      'https://ovp.dresel.systems/api-na/interpreter',
    );
    expect(northAmerica[1]).toBe('https://overpass-api.de/api/interpreter');
    expect(northAmerica).toContain(
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    );
    expect(northAmerica).toContain(
      'https://overpass.private.coffee/api/interpreter',
    );

    const asia = orderOverpassEndpoints(139.6917);
    expect(asia[0]).toBe('https://overpass-api.de/api/interpreter');
    expect(asia[1]).toBe('https://ovp.dresel.systems/api/interpreter');
    expect(asia).toHaveLength(4);
  });
});

describe('area metadata and GeoJSON output', () => {
  const generatedAt = '2026-11-20T12:00:00.000Z';
  const result = parseOverpassBuildings(
    response(),
    BRASOV.latitudeDeg,
    BRASOV.longitudeDeg,
    BRASOV.radiusM,
    'network',
  );
  const metadata = buildAreaMetadata({
    slug: BRASOV.slug,
    name: BRASOV.name,
    latitudeDeg: BRASOV.latitudeDeg,
    longitudeDeg: BRASOV.longitudeDeg,
    radiusM: BRASOV.radiusM,
    endpoint: 'https://ovp.dresel.systems/api/interpreter',
    query: buildBuildingsQuery(
      BRASOV.latitudeDeg,
      BRASOV.longitudeDeg,
      BRASOV.radiusM,
    ),
    retrievedAt: generatedAt,
    osmTimestamp: result.osmTimestamp,
    result,
  });

  it('records counts, provenance and the ODbL licence', () => {
    expect(metadata.counts.buildings).toBe(3);
    expect(metadata.counts.defaultHeightCount).toBe(1);
    expect(metadata.counts.taggedHeightCount).toBe(2);
    expect(metadata.counts.heightSource).toEqual({
      'building:height': 1,
      height: 0,
      levels: 1,
      default: 1,
    });
    expect(metadata.source.endpoint).toContain('ovp.dresel.systems');
    expect(metadata.source.query).toContain('[timeout:60]');
    expect(metadata.source.osmTimestamp).toBe('2026-11-20T10:00:00Z');
    expect(metadata.license).toBe('ODbL');
    expect(metadata.attribution).toContain('OpenStreetMap');
  });

  it('writes closed Polygon rings and per-feature height provenance', () => {
    const geojson = buildAreaGeoJson(result, metadata);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(3);
    expect(geojson.features[0].properties.heightSource).toBe('building:height');
    expect(geojson.features[0].properties.heightM).toBe(12.5);
    expect(geojson.features[1].properties.heightSource).toBe('levels');
    expect(geojson.features[2].properties.heightSource).toBe('default');
    expect(geojson.features[0].geometry.type).toBe('Polygon');
    const coordinates = geojson.features[0].geometry.coordinates[0];
    expect(coordinates[0]).toEqual(coordinates[coordinates.length - 1]);
    expect(coordinates).toHaveLength(5);
    expect(geojson.bbox).toBeDefined();
    expect(geojson.license).toBe('ODbL');
    expect(geojson.retrievedAt).toBe(generatedAt);
    expect(geojson.osmTimestamp).toBe('2026-11-20T10:00:00Z');
    expect(geojson.sourceEndpoint).toContain('ovp.dresel.systems');
    expect(geojson.sourceQuery).toContain('way["building"]');
  });

  it('round-trips the generated GeoJSON through the importer', () => {
    const geojson = buildAreaGeoJson(result, metadata);
    const imported = parseImportedBuildings(
      JSON.stringify(geojson),
      BRASOV.latitudeDeg,
      BRASOV.longitudeDeg,
      BRASOV.radiusM,
      { fileName: 'brasov.geojson' },
    );
    expect(imported.buildings).toHaveLength(result.buildings.length);
    expect(imported.defaultHeightCount).toBe(result.defaultHeightCount);
    expect(imported.taggedHeightCount).toBe(result.taggedHeightCount);
    expect(imported.buildings.map((building) => building.heightSource)).toEqual(
      result.buildings.map((building) => building.heightSource),
    );
    expect(imported.sourceQuery).toContain('[timeout:60]');
    expect(imported.retrievedAt).toBe(generatedAt);
    expect(imported.osmTimestamp).toBe('2026-11-20T10:00:00Z');
    expect(imported.license).toBe('ODbL');
    expect(imported.fileName).toBe('brasov.geojson');
  });

  it('builds a manifest entry with files and counts', () => {
    const entry = buildManifestEntry(metadata);
    expect(entry).toMatchObject({
      slug: 'brasov',
      name: 'Brașov',
      centerLatDeg: 45.6427,
      centerLonDeg: 25.5887,
      radiusM: 1_500,
      file: 'brasov.geojson',
      metadataFile: 'brasov.json',
      buildingCount: 3,
      defaultHeightCount: 1,
      taggedHeightCount: 2,
      license: 'ODbL',
    });
    expect(entry.sourceQuery).toContain('[timeout:60]');
  });

  it('merges manifests by slug, keeps order and is idempotent', () => {
    const brasov = buildManifestEntry(metadata);
    const aarhus = {
      ...brasov,
      slug: 'aarhus',
      name: 'Aarhus',
      file: 'aarhus.geojson',
      metadataFile: 'aarhus.json',
    };
    const once = mergeAreaManifest(null, brasov, generatedAt);
    const twice = mergeAreaManifest(once, brasov, generatedAt);
    expect(twice.areas).toHaveLength(1);
    const merged = mergeAreaManifest(twice, aarhus, generatedAt);
    expect(merged.areas.map((area) => area.slug)).toEqual([
      'aarhus',
      'brasov',
    ]);
    const replaced = mergeAreaManifest(
      merged,
      { ...brasov, buildingCount: 999 },
      '2026-11-21T00:00:00.000Z',
    );
    expect(replaced.areas).toHaveLength(2);
    expect(
      replaced.areas.find((area) => area.slug === 'brasov')?.buildingCount,
    ).toBe(999);
    expect(replaced.generatedAt).toBe('2026-11-21T00:00:00.000Z');
  });

  it('refuses to merge into a malformed manifest', () => {
    expect(() =>
      mergeAreaManifest({ areas: 'nope' }, buildManifestEntry(metadata), generatedAt),
    ).toThrow();
  });
});
