/**
 * Shareable deep-link construction.
 *
 * The app already understands lat/lon/elev/eye/utc/view/toggle parameters, so
 * sharing is a matter of serialising the current UI state. Keeping this pure
 * makes the URL contract testable without a DOM.
 */

import type { UiState } from '../state/store';

export type ShareState = Pick<
  UiState,
  'observer' | 'utcMs' | 'viewMode' | 'toggles' | 'minGoodElevationDeg'
>;

export const DEFAULT_MIN_GOOD_ELEVATION = 10;
export const DEFAULT_EYE_HEIGHT_M = 1.7;

function compact(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** Build an absolute share URL, dropping unrelated query parameters. */
export function buildShareUrl(baseHref: string, state: ShareState): string {
  const url = new URL(baseHref);
  url.search = '';
  url.hash = '';

  if (state.observer) {
    url.searchParams.set('lat', state.observer.latitudeDeg.toFixed(5));
    url.searchParams.set('lon', state.observer.longitudeDeg.toFixed(5));
    if (state.observer.groundElevationM !== null) {
      url.searchParams.set('elev', compact(state.observer.groundElevationM, 1));
    }
    if (state.observer.eyeHeightM !== DEFAULT_EYE_HEIGHT_M) {
      url.searchParams.set('eye', compact(state.observer.eyeHeightM, 2));
    }
  }

  if (state.utcMs !== null) {
    url.searchParams.set(
      'utc',
      new Date(state.utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    );
  }

  url.searchParams.set('view', state.viewMode);
  if (state.toggles.nightMode) url.searchParams.set('night', '1');
  if (!state.toggles.refraction) url.searchParams.set('refraction', '0');
  if (!state.toggles.constellations) {
    url.searchParams.set('constellations', '0');
  }
  if (state.toggles.enlargedMarker) url.searchParams.set('enlarged', '1');
  if (state.minGoodElevationDeg !== DEFAULT_MIN_GOOD_ELEVATION) {
    url.searchParams.set('minEl', compact(state.minGoodElevationDeg, 2));
  }

  return url.toString();
}
