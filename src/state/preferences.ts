/**
 * Small, validated browser-local UI preferences.
 *
 * Nothing here is astronomy state: the observer is stored so a returning user
 * does not have to repeat the location prompt, while time always starts at
 * closest approach unless a URL says otherwise. Storage failures are treated
 * as "no preferences" so private browsing cannot break the app.
 */

import type { DisplayToggles, ObserverConfig, ViewMode } from './store';

export const PREFERENCES_KEY = 'apophis-ui-preferences-v1';

export interface StoredPreferences {
  observer: ObserverConfig | null;
  viewMode: ViewMode;
  toggles: DisplayToggles;
  minGoodElevationDeg: number;
  /** The first-run location dialog was closed without choosing a place. */
  locationPromptDismissed: boolean;
  /** The one-time "app shell is ready offline" banner was dismissed. */
  offlineBannerDismissed: boolean;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const VIEW_MODES: ViewMode[] = ['sky', 'space', 'local', 'ar'];

export function defaultPreferences(): StoredPreferences {
  return {
    observer: null,
    viewMode: 'sky',
    toggles: {
      constellations: true,
      refraction: true,
      enlargedMarker: false,
      nightMode: false,
    },
    minGoodElevationDeg: 10,
    locationPromptDismissed: false,
    offlineBannerDismissed: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function readObserver(value: unknown): ObserverConfig | null {
  if (!isRecord(value)) return null;
  const latitudeDeg = value.latitudeDeg;
  const longitudeDeg = value.longitudeDeg;
  if (
    typeof latitudeDeg !== 'number' ||
    !Number.isFinite(latitudeDeg) ||
    latitudeDeg < -90 ||
    latitudeDeg > 90 ||
    typeof longitudeDeg !== 'number' ||
    !Number.isFinite(longitudeDeg) ||
    longitudeDeg < -180 ||
    longitudeDeg > 180
  ) {
    return null;
  }
  const groundRaw = value.groundElevationM;
  const groundElevationM =
    typeof groundRaw === 'number' &&
    Number.isFinite(groundRaw) &&
    groundRaw >= -500 &&
    groundRaw <= 9000
      ? groundRaw
      : null;
  const eyeHeightM = numberInRange(value.eyeHeightM, 0, 100, 1.7);
  return {
    latitudeDeg,
    longitudeDeg,
    groundElevationM,
    eyeHeightM,
  };
}

/** Coerce an untrusted decoded object into the current preference schema. */
export function normalizePreferences(value: unknown): StoredPreferences {
  const base = defaultPreferences();
  if (!isRecord(value)) return base;
  const toggles = isRecord(value.toggles) ? value.toggles : {};
  const viewMode =
    typeof value.viewMode === 'string' &&
    VIEW_MODES.includes(value.viewMode as ViewMode)
      ? (value.viewMode as ViewMode)
      : base.viewMode;

  return {
    observer: readObserver(value.observer),
    viewMode,
    toggles: {
      constellations: boolOr(toggles.constellations, base.toggles.constellations),
      refraction: boolOr(toggles.refraction, base.toggles.refraction),
      enlargedMarker: boolOr(toggles.enlargedMarker, base.toggles.enlargedMarker),
      nightMode: boolOr(toggles.nightMode, base.toggles.nightMode),
    },
    minGoodElevationDeg: numberInRange(
      value.minGoodElevationDeg,
      0,
      90,
      base.minGoodElevationDeg,
    ),
    locationPromptDismissed: boolOr(
      value.locationPromptDismissed,
      base.locationPromptDismissed,
    ),
    offlineBannerDismissed: boolOr(
      value.offlineBannerDismissed,
      base.offlineBannerDismissed,
    ),
  };
}

export function parsePreferences(raw: string | null): StoredPreferences {
  if (!raw) return defaultPreferences();
  try {
    return normalizePreferences(JSON.parse(raw) as unknown);
  } catch {
    return defaultPreferences();
  }
}

function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPreferences(
  storage: PreferenceStorage | null = defaultStorage(),
): StoredPreferences {
  if (!storage) return defaultPreferences();
  try {
    return parsePreferences(storage.getItem(PREFERENCES_KEY));
  } catch {
    return defaultPreferences();
  }
}

export function savePreferences(
  preferences: StoredPreferences,
  storage: PreferenceStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Quota/private-mode failures are non-fatal; the session still works.
  }
}
