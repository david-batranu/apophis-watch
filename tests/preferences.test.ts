import { describe, expect, it } from 'vitest';
import {
  PREFERENCES_KEY,
  defaultPreferences,
  loadPreferences,
  normalizePreferences,
  parsePreferences,
  savePreferences,
  type PreferenceStorage,
} from '../src/state/preferences';

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('stored UI preferences', () => {
  it('returns defaults for absent, malformed and out-of-range data', () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences());
    expect(parsePreferences('{not json')).toEqual(defaultPreferences());
    const normalized = normalizePreferences({
      observer: { latitudeDeg: 200, longitudeDeg: 25, eyeHeightM: 1.7 },
      viewMode: 'nope',
      minGoodElevationDeg: 900,
      toggles: { nightMode: 'yes' },
    });
    expect(normalized.observer).toBeNull();
    expect(normalized.viewMode).toBe('sky');
    expect(normalized.minGoodElevationDeg).toBe(10);
    expect(normalized.toggles.nightMode).toBe(false);
  });

  it('round-trips a valid observer and UI choices', () => {
    const storage = memoryStorage();
    const preferences = {
      ...defaultPreferences(),
      observer: {
        latitudeDeg: 45.6427,
        longitudeDeg: 25.5887,
        groundElevationM: 591.8,
        eyeHeightM: 1.7,
      },
      viewMode: 'local' as const,
      minGoodElevationDeg: 12,
      toggles: {
        constellations: false,
        refraction: true,
        enlargedMarker: true,
        nightMode: true,
      },
    };
    savePreferences(preferences, storage);
    expect(loadPreferences(storage)).toEqual(preferences);
  });

  it('keeps partially valid preferences usable', () => {
    const storage = memoryStorage({
      [PREFERENCES_KEY]: JSON.stringify({
        observer: {
          latitudeDeg: -33.9249,
          longitudeDeg: 18.4241,
          eyeHeightM: 12,
        },
        viewMode: 'space',
        toggles: { constellations: false },
        locationPromptDismissed: true,
      }),
    });
    const loaded = loadPreferences(storage);
    expect(loaded.observer).toEqual({
      latitudeDeg: -33.9249,
      longitudeDeg: 18.4241,
      groundElevationM: null,
      eyeHeightM: 12,
    });
    expect(loaded.viewMode).toBe('space');
    expect(loaded.toggles.constellations).toBe(false);
    expect(loaded.toggles.refraction).toBe(true);
    expect(loaded.locationPromptDismissed).toBe(true);
  });

  it('does not throw when storage is unavailable', () => {
    expect(loadPreferences(null)).toEqual(defaultPreferences());
    expect(() => savePreferences(defaultPreferences(), null)).not.toThrow();
  });
});
