import { describe, expect, it } from 'vitest';
import { buildShareUrl, type ShareState } from '../src/ui/share';
import { initialUiState } from '../src/state/store';

const BASE = 'https://seekahead.eu/apophis/?debug=1&lat=1&lon=2#ignored';

function state(patch: Partial<ShareState> = {}): ShareState {
  return {
    observer: {
      latitudeDeg: 45.6427,
      longitudeDeg: 25.5887,
      groundElevationM: 591.8,
      eyeHeightM: 1.7,
    },
    utcMs: Date.parse('2029-04-13T21:35:42Z'),
    viewMode: 'sky',
    toggles: { ...initialUiState.toggles },
    minGoodElevationDeg: 10,
    ...patch,
  };
}

describe('shareable deep links', () => {
  it('serialises the current observer, time and view', () => {
    const url = new URL(buildShareUrl(BASE, state()));
    expect(url.origin + url.pathname).toBe('https://seekahead.eu/apophis/');
    expect(url.searchParams.get('lat')).toBe('45.64270');
    expect(url.searchParams.get('lon')).toBe('25.58870');
    expect(url.searchParams.get('elev')).toBe('591.8');
    expect(url.searchParams.get('eye')).toBeNull();
    expect(url.searchParams.get('utc')).toBe('2029-04-13T21:35:42Z');
    expect(url.searchParams.get('view')).toBe('sky');
    expect(url.searchParams.get('debug')).toBeNull();
    expect(url.searchParams.get('night')).toBeNull();
    expect(url.hash).toBe('');
  });

  it('adds non-default display choices only', () => {
    const url = new URL(
      buildShareUrl(
        BASE,
        state({
          observer: {
            latitudeDeg: -33.9249,
            longitudeDeg: 18.4241,
            groundElevationM: null,
            eyeHeightM: 3.5,
          },
          viewMode: 'ar',
          toggles: {
            constellations: false,
            refraction: false,
            enlargedMarker: true,
            nightMode: true,
          },
          minGoodElevationDeg: 15,
        }),
      ),
    );
    expect(url.searchParams.get('elev')).toBeNull();
    expect(url.searchParams.get('eye')).toBe('3.5');
    expect(url.searchParams.get('view')).toBe('ar');
    expect(url.searchParams.get('night')).toBe('1');
    expect(url.searchParams.get('refraction')).toBe('0');
    expect(url.searchParams.get('constellations')).toBe('0');
    expect(url.searchParams.get('enlarged')).toBe('1');
    expect(url.searchParams.get('minEl')).toBe('15');
  });

  it('omits time when the session is not ready', () => {
    const url = new URL(buildShareUrl(BASE, state({ utcMs: null })));
    expect(url.searchParams.get('utc')).toBeNull();
  });
});
