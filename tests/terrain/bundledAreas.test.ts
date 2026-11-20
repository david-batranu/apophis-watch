import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BundledAreaError,
  findBundledArea,
  loadBundledAreaManifest,
  loadBundledBuildings,
  normaliseBundledAreaManifest,
  parseGeoJsonBuildings,
  parseImportedBuildings,
  type BundledAreaEntry,
  type BundledAreaManifest,
} from '../../src/terrain/bundledAreas';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function closedRing(
  lon: number,
  lat: number,
  size = 0.0001,
): number[][] {
  return [
    [lon, lat],
    [lon + size, lat],
    [lon + size, lat + size],
    [lon, lat + size],
    [lon, lat],
  ];
}

function feature(options: {
  id: number;
  ring: number[][];
  tags: Record<string, string>;
}) {
  return {
    type: 'Feature' as const,
    id: options.id,
    properties: { tags: options.tags },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [options.ring],
    },
  };
}

describe('bundled area manifest', () => {
  const manifest: BundledAreaManifest = {
    areas: [
      {
        slug: 'big',
        name: 'Big',
        centerLatDeg: 45,
        centerLonDeg: 25,
        radiusM: 3_000,
        file: 'big.geojson',
      },
      {
        slug: 'small',
        name: 'Small',
        centerLatDeg: 45,
        centerLonDeg: 25,
        radiusM: 1_500,
        file: 'small.geojson',
      },
      {
        slug: 'offset',
        name: 'Offset',
        centerLatDeg: 45.009,
        centerLonDeg: 25,
        radiusM: 2_000,
        file: 'offset.geojson',
      },
    ],
  };

  it('picks the smallest area that fully covers the requested circle', () => {
    expect(findBundledArea(manifest, 45, 25, 1_000)?.slug).toBe('small');
    expect(findBundledArea(manifest, 45, 25, 2_500)?.slug).toBe('big');
  });

  it('accounts for centre offset and never returns a partial cover', () => {
    // ~1000 m north of the big/small centres. At 1200 m requested radius,
    // only the offset area (2000 m) covers the circle.
    expect(findBundledArea(manifest, 45.009, 25, 1_200)?.slug).toBe('offset');
    expect(findBundledArea(manifest, 45.009, 25, 2_100)).toBeNull();
    expect(findBundledArea(manifest, 45, 25, 4_000)).toBeNull();
  });

  it('ignores invalid manifest entries and accepts a raw array', () => {
    const normalised = normaliseBundledAreaManifest([
      {
        slug: 'valid',
        name: 'Valid',
        centerLatDeg: 45,
        centerLonDeg: 25,
        radiusM: 1_000,
        file: 'valid.geojson',
      },
      { slug: 'Bad Slug', centerLatDeg: 45, centerLonDeg: 25, radiusM: 10 },
      { slug: 'out-of-range', centerLatDeg: 145, centerLonDeg: 25, radiusM: 10 },
    ]);
    expect(normalised.areas.map((area) => area.slug)).toEqual(['valid']);
  });

  it('loads index.json from the app base URL and treats 404 as empty', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          areas: [
            {
              slug: 'brasov',
              name: 'Brasov',
              centerLatDeg: 45.6427,
              centerLonDeg: 25.5887,
              radiusM: 1_500,
              file: 'brasov.geojson',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const loaded = await loadBundledAreaManifest(
      'https://example.test/app/',
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(loaded.areas).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://example.test/app/data/areas/index.json',
    );

    const missing = vi.fn(async () => new Response('', { status: 404 }));
    const empty = await loadBundledAreaManifest('https://example.test/', {
      fetchImpl: missing as unknown as typeof fetch,
    });
    expect(empty.areas).toEqual([]);
  });
});

describe('GeoJSON building parsing', () => {
  it('preserves the exact height priority and skips invalid/non-building features', () => {
    const result = parseGeoJsonBuildings(
      {
        type: 'FeatureCollection',
        features: [
          feature({
            id: 1,
            ring: closedRing(25, 45),
            tags: {
              building: 'house',
              'building:height': '12.5',
              height: '20',
            },
          }),
          feature({
            id: 2,
            ring: closedRing(25.001, 45),
            tags: { building: 'yes', height: '20' },
          }),
          feature({
            id: 3,
            ring: closedRing(25.002, 45),
            tags: { building: 'yes', 'building:levels': '4' },
          }),
          feature({
            id: 4,
            ring: closedRing(25.003, 45),
            tags: { building: 'shed' },
          }),
          feature({
            id: 5,
            ring: closedRing(25.004, 45),
            tags: { building: 'no', height: '50' },
          }),
          feature({
            id: 6,
            ring: [
              [25, 45],
              [25.001, 45],
            ],
            tags: { building: 'yes' },
          }),
          feature({
            id: 7,
            ring: [
              [25, 45],
              [25.001, 45.001],
              [25.002, 45.002],
            ],
            tags: { building: 'yes' },
          }),
        ],
      },
      45,
      25,
      1_000,
    );

    expect(result.buildings).toHaveLength(4);
    expect(result.buildings.map((building) => building.heightSource)).toEqual([
      'building:height',
      'height',
      'levels',
      'default',
    ]);
    expect(result.buildings[0].heightM).toBe(12.5);
    expect(result.buildings[1].heightM).toBe(20);
    expect(result.buildings[2].heightM).toBe(12);
    expect(result.buildings[3].heightM).toBe(8);
    expect(result.defaultHeightCount).toBe(1);
    expect(result.taggedHeightCount).toBe(3);
    // The closing point is removed.
    expect(result.buildings[0].ring).toHaveLength(4);
  });

  it('turns MultiPolygon outer rings into separate footprints', () => {
    const result = parseGeoJsonBuildings(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 77,
            properties: {
              tags: { building: 'yes', height: '15' },
            },
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [closedRing(25, 45)],
                [closedRing(25.002, 45)],
                // Degenerate part must be skipped, not turned into a fake ring.
                [
                  [
                    [25.004, 45],
                    [25.004, 45],
                    [25.004, 45],
                  ],
                ],
              ],
            },
          },
        ],
      },
      45,
      25,
      1_000,
    );
    expect(result.buildings).toHaveLength(2);
    expect(result.buildings[0].heightM).toBe(15);
    expect(result.buildings[1].heightM).toBe(15);
    expect(result.buildings[0].heightSource).toBe('height');
    expect(result.buildings[0].id).not.toBe(result.buildings[1].id);
    expect(result.buildings[0].ring).toHaveLength(4);
  });

  it('preserves top-level provenance and an explicit file name', () => {
    const result = parseGeoJsonBuildings(
      {
        type: 'FeatureCollection',
        name: 'Testville',
        license: 'ODbL',
        retrievedAt: '2026-11-20T12:00:00.000Z',
        osmTimestamp: '2026-11-20T10:00:00Z',
        sourceEndpoint: 'https://ovp.dresel.systems/api/interpreter',
        sourceQuery:
          '[out:json][timeout:60][maxsize:268435456];way["building"](around:1000,45.000000,25.000000);out geom;',
        features: [
          feature({
            id: 10,
            ring: closedRing(25, 45),
            tags: { building: 'yes' },
          }),
        ],
      },
      45,
      25,
      1_000,
      { fileName: 'testville.geojson' },
    );
    expect(result.source).toBe('import');
    expect(result.sourceLabel).toBe('Imported area: Testville');
    expect(result.sourceUrl).toBe(
      'https://ovp.dresel.systems/api/interpreter',
    );
    expect(result.sourceQuery).toContain('way["building"]');
    expect(result.retrievedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(result.license).toBe('ODbL');
    expect(result.osmTimestamp).toBe('2026-11-20T10:00:00Z');
    expect(result.fileName).toBe('testville.geojson');
  });
});

describe('Overpass JSON import', () => {
  it('reuses parseOverpassBuildings and keeps the OSM timestamp', () => {
    const text = JSON.stringify({
      version: 0.6,
      osm3s: { timestamp_osm_base: '2026-11-20T10:00:00Z' },
      elements: [
        {
          type: 'way',
          id: 101,
          tags: { building: 'yes', 'building:levels': '3' },
          geometry: [
            { lat: 45, lon: 25 },
            { lat: 45, lon: 25.001 },
            { lat: 45.001, lon: 25.001 },
            { lat: 45, lon: 25 },
          ],
        },
      ],
    });
    const result = parseImportedBuildings(text, 45, 25, 1_000, {
      fileName: 'import.json',
    });
    expect(result.source).toBe('import');
    expect(result.buildings).toHaveLength(1);
    expect(result.buildings[0].heightSource).toBe('levels');
    expect(result.buildings[0].heightM).toBe(9);
    expect(result.osmTimestamp).toBe('2026-11-20T10:00:00Z');
    expect(result.fileName).toBe('import.json');
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseImportedBuildings('not json', 45, 25, 1_000)).toThrow(
      BundledAreaError,
    );
  });
});

describe('bundled area loading', () => {
  const area: BundledAreaEntry = {
    slug: 'brasov',
    name: 'Brasov',
    centerLatDeg: 45.6427,
    centerLonDeg: 25.5887,
    radiusM: 1_500,
    file: 'brasov.geojson',
    metadataFile: 'brasov.json',
    sourceEndpoint: 'https://manifest.example/interpreter',
    sourceQuery: 'manifest query',
    retrievedAt: '2026-11-01T00:00:00.000Z',
    license: 'ODbL',
  };

  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    name: 'Brasov',
    license: 'ODbL',
    features: [
      feature({
        id: 201,
        ring: closedRing(25.5887, 45.6427),
        tags: { building: 'yes', 'building:height': '18' },
      }),
    ],
  });

  it('loads the snapshot and prefers sidecar provenance', async () => {
    const sidecar = {
      schemaVersion: 1,
      slug: 'brasov',
      name: 'Brasov',
      source: {
        endpoint: 'https://sidecar.example/interpreter',
        query: 'sidecar query',
        retrievedAt: '2026-11-20T12:00:00.000Z',
        osmTimestamp: '2026-11-20T10:00:00Z',
      },
      license: 'ODbL',
      attribution: '© OpenStreetMap contributors',
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('brasov.geojson')) {
        return new Response(geojson, { status: 200 });
      }
      if (url.endsWith('brasov.json')) {
        return new Response(JSON.stringify(sidecar), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    const result = await loadBundledBuildings(
      'https://example.test/app/',
      area,
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(result.source).toBe('bundled');
    expect(result.sourceLabel).toBe('Saved area: Brasov');
    expect(result.sourceUrl).toBe('https://sidecar.example/interpreter');
    expect(result.sourceQuery).toBe('sidecar query');
    expect(result.retrievedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(result.license).toBe('ODbL');
    expect(result.fileName).toBe('brasov.geojson');
    expect(result.osmTimestamp).toBe('2026-11-20T10:00:00Z');
    expect(result.buildings[0].heightSource).toBe('building:height');
    expect(result.buildings[0].heightM).toBe(18);
  });

  it('still returns valid footprints when the sidecar is missing', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('.geojson')
        ? new Response(geojson, { status: 200 })
        : new Response('', { status: 404 }),
    );
    const result = await loadBundledBuildings(
      'https://example.test/app/',
      area,
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(result.buildings).toHaveLength(1);
    expect(result.sourceUrl).toBe('https://manifest.example/interpreter');
    expect(result.sourceQuery).toBe('manifest query');
    expect(result.retrievedAt).toBe('2026-11-01T00:00:00.000Z');
  });
});
