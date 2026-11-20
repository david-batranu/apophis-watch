import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBuildings } from '../../src/terrain/buildings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ring(lon: number, lat: number): number[][] {
  return [
    [lon, lat],
    [lon + 0.0001, lat],
    [lon + 0.0001, lat + 0.0001],
    [lon, lat + 0.0001],
    [lon, lat],
  ];
}

const EMPTY_OVERPASS = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-11-20T10:00:00Z' },
  elements: [],
});

function manifestFor(area: {
  radiusM: number;
  centerLatDeg?: number;
  centerLonDeg?: number;
}) {
  return {
    schemaVersion: 1,
    areas: [
      {
        slug: 'brasov',
        name: 'Brasov',
        centerLatDeg: area.centerLatDeg ?? 45.6427,
        centerLonDeg: area.centerLonDeg ?? 25.5887,
        radiusM: area.radiusM,
        file: 'brasov.geojson',
        metadataFile: 'brasov.json',
        retrievedAt: '2026-11-01T00:00:00.000Z',
        sourceEndpoint: 'https://ovp.dresel.systems/api/interpreter',
        sourceQuery: 'way["building"](around:1500,...);out geom;',
      },
    ],
  };
}

const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  name: 'Brasov',
  license: 'ODbL',
  features: [
    {
      type: 'Feature',
      id: 1,
      properties: { tags: { building: 'yes', height: '12' } },
      geometry: { type: 'Polygon', coordinates: [ring(25.5887, 45.6427)] },
    },
  ],
});

const SIDECAR = JSON.stringify({
  schemaVersion: 1,
  slug: 'brasov',
  name: 'Brasov',
  source: {
    endpoint: 'https://ovp.dresel.systems/api/interpreter',
    query: 'way["building"](around:1500,...);out geom;',
    retrievedAt: '2026-11-01T00:00:00.000Z',
    osmTimestamp: '2026-11-01T00:00:00Z',
  },
  license: 'ODbL',
});

describe('bundled-before-network ordering', () => {
  it('returns a covering bundled area without any live request', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/data/areas/index.json')) {
        return new Response(JSON.stringify(manifestFor({ radiusM: 1_500 })), {
          status: 200,
        });
      }
      if (url.endsWith('brasov.geojson')) {
        return new Response(GEOJSON, { status: 200 });
      }
      if (url.endsWith('brasov.json')) {
        return new Response(SIDECAR, { status: 200 });
      }
      throw new Error(`unexpected live request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBuildings({
      latitudeDeg: 45.643,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      baseUrl: 'https://example.test/app/',
    });

    expect(result.source).toBe('bundled');
    expect(result.sourceLabel).toBe('Saved area: Brasov');
    expect(result.fileName).toBe('brasov.geojson');
    expect(result.buildings).toHaveLength(1);
    expect(result.buildings[0].heightSource).toBe('height');
    // The caller asked about this view, not the bundle centre.
    expect(result.centerLatDeg).toBe(45.643);
    expect(result.queryRadiusM).toBe(1_000);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(
      'https://example.test/app/data/areas/index.json',
    );
    expect(urls[1]).toBe(
      'https://example.test/app/data/areas/brasov.geojson',
    );
    expect(urls[2]).toBe(
      'https://example.test/app/data/areas/brasov.json',
    );
  });

  it('falls back to the live query when the bundle is too small', async () => {
    const progress: string[] = [];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/data/areas/index.json')) {
        return new Response(JSON.stringify(manifestFor({ radiusM: 200 })), {
          status: 200,
        });
      }
      if (url.includes('ovp.dresel.systems/api/interpreter')) {
        return new Response(EMPTY_OVERPASS, { status: 200 });
      }
      throw new Error(`unexpected bundled file request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      baseUrl: 'https://example.test/app/',
      onProgress: (message) => progress.push(message),
    });

    expect(result.source).toBe('network');
    expect(result.buildings).toHaveLength(0);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/data/areas/index.json');
    expect(urls[1]).toContain('ovp.dresel.systems/api/interpreter');
    expect(urls.some((url) => url.endsWith('.geojson'))).toBe(false);
    expect(
      progress.some((message) =>
        message.includes('No saved building data covers this view'),
      ),
    ).toBe(true);
  });

  it('does not use a bundle whose centre is too far for the requested radius', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/data/areas/index.json')) {
        // ~800 m offset plus a 1000 m request exceeds a 1500 m area.
        return new Response(
          JSON.stringify(
            manifestFor({ radiusM: 1_500, centerLatDeg: 45.65 }),
          ),
          { status: 200 },
        );
      }
      if (url.includes('ovp.dresel.systems/api/interpreter')) {
        return new Response(EMPTY_OVERPASS, { status: 200 });
      }
      throw new Error(`unexpected bundled file request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      baseUrl: 'https://example.test/app/',
    });
    expect(result.source).toBe('network');
    expect(urls.some((url) => url.endsWith('.geojson'))).toBe(false);
  });

  it('treats a missing manifest as no bundled areas', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/data/areas/index.json')) {
        return new Response('', { status: 404 });
      }
      if (url.includes('ovp.dresel.systems/api/interpreter')) {
        return new Response(EMPTY_OVERPASS, { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      baseUrl: '/app/',
    });
    expect(result.source).toBe('network');
    expect(urls[0]).toBe('/app/data/areas/index.json');
    expect(urls[1]).toContain('ovp.dresel.systems');
  });

  it('skips the manifest entirely when allowBundled is false', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(EMPTY_OVERPASS, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      allowBundled: false,
      baseUrl: 'https://example.test/app/',
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('ovp.dresel.systems');
  });
});
