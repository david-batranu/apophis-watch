import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OverpassRateLimitError,
  OverpassRequestError,
  fetchBuildings,
} from '../../src/terrain/buildings';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
      }),
    ).rejects.toMatchObject({
      name: 'OverpassRateLimitError',
      retryAfterMs: 60_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports other HTTP failures without a blind retry', async () => {
    const fetchMock = vi.fn(async () =>
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
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OverpassRequestError);
    expect((caught as OverpassRequestError).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    });
    expect(result.buildings).toHaveLength(0);
    expect(requestedUrl).toContain('overpass-api.de/api/interpreter?data=');
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
