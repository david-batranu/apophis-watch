import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OverpassRateLimitError,
  OverpassRequestError,
  fetchBuildings,
} from '../../src/terrain/buildings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const EMPTY_RESPONSE = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-11-20T10:00:00Z' },
  elements: [],
});

describe('Overpass policy handling', () => {
  it('surfaces HTTP 429 with the Retry-After cooldown and does not retry', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '60' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchBuildings({
        latitudeDeg: 45.6427,
        longitudeDeg: 25.5887,
        radiusM: 1_000,
        useCache: false,
        allowBundled: false,
      }),
    ).rejects.toMatchObject({
      name: 'OverpassRateLimitError',
      retryAfterMs: 60_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 502 with bounded backoff, then reports the typed error', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response('at capacity', { status: 502 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    let caught: unknown = null;
    try {
      await fetchBuildings({
        latitudeDeg: 45.6427,
        longitudeDeg: 25.5887,
        radiusM: 1_000,
        useCache: false,
        allowBundled: false,
        retryBackoffMs: [0, 0, 0],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OverpassRequestError);
    expect((caught as OverpassRequestError).status).toBe(502);
    // dresel once, then the overpass-api.de fallback up to three times.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('ovp.dresel.systems/api/interpreter?data=');
    expect(urls.slice(1).every((url) => url.includes('overpass-api.de'))).toBe(
      true,
    );
  });

  it('moves from a 406 block to the fallback without repeating it', async () => {
    let call = 0;
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      call++;
      if (call === 1) {
        return new Response('blocked user agent', { status: 406 });
      }
      return new Response(EMPTY_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      allowBundled: false,
    });
    expect(result.source).toBe('network');
    expect(result.buildings).toHaveLength(0);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('ovp.dresel.systems');
    expect(urls[1]).toContain('overpass-api.de');
  });

  it('falls back to overpass-api.de on a retryable 502', async () => {
    let call = 0;
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      call++;
      if (call === 1) return new Response('bad gateway', { status: 502 });
      return new Response(EMPTY_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      allowBundled: false,
      retryBackoffMs: [0],
    });
    expect(result.source).toBe('network');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('ovp.dresel.systems');
    expect(urls[1]).toContain('overpass-api.de');
  });

  it('tries the fallback once after a network error without a long backoff', async () => {
    let call = 0;
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      call++;
      if (call === 1) throw new TypeError('fetch failed');
      return new Response(EMPTY_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      allowBundled: false,
    });
    expect(result.source).toBe('network');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('ovp.dresel.systems');
    expect(urls[1]).toContain('overpass-api.de');
  });

  it('uses the North-American mirror first for western longitudes', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(EMPTY_RESPONSE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchBuildings({
      latitudeDeg: 37.7749,
      longitudeDeg: -122.4194,
      radiusM: 1_000,
      useCache: false,
      allowBundled: false,
    });
    expect(requestedUrl).toContain('ovp.dresel.systems/api-na/interpreter?data=');
  });

  it('uses the GET interpreter form with an encoded data parameter', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({ version: 0.6, elements: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchBuildings({
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      radiusM: 1_000,
      useCache: false,
      allowBundled: false,
    });
    expect(result.buildings).toHaveLength(0);
    expect(requestedUrl).toContain('ovp.dresel.systems/api/interpreter?data=');
    expect(decodeURIComponent(requestedUrl.split('data=')[1])).toContain(
      '[out:json][timeout:25]',
    );
    expect(decodeURIComponent(requestedUrl.split('data=')[1])).toContain(
      'way["building"](around:1000,',
    );
  });

  it('constructs a typed rate-limit error', () => {
    const error = new OverpassRateLimitError('wait', 1_000);
    expect(error.name).toBe('OverpassRateLimitError');
    expect(error.retryAfterMs).toBe(1_000);
  });
});
