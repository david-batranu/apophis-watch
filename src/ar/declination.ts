import { model } from 'geomagnetism';
import type { ObserverLocation } from '../ephemeris/types';

/**
 * The installed geomagnetism@0.2.0 ships WMM2025 with a package window of
 * 2024-11-13T03:00Z .. 2029-11-13T03:00Z. The 2029-04-13 flyby is inside it.
 * WMM2025 itself is nominally valid through 2029-12-31, so the gap between the
 * package window and the official end is handled as an explicit extrapolation.
 */
export const WMM_PACKAGE_START_MS = Date.UTC(2024, 10, 13, 3, 0, 0);
export const WMM_PACKAGE_END_MS = Date.UTC(2029, 10, 13, 3, 0, 0);
export const WMM_OFFICIAL_END_MS = Date.UTC(2029, 11, 31, 23, 59, 59);

export type DeclinationStatus = 'supported' | 'extrapolated' | 'unsupported';

export interface DeclinationResult {
  /** East-positive magnetic declination, or null when it cannot be trusted. */
  declinationDeg: number | null;
  status: DeclinationStatus;
  modelName: string | null;
  warning: string | null;
}

function pointDeclination(
  date: Date,
  location: ObserverLocation,
  allowOutOfBounds: boolean,
): { declinationDeg: number; modelName: string } {
  const wmm = allowOutOfBounds
    ? model(date, { allowOutOfBoundsModel: true })
    : model(date);
  const point = wmm.point([
    location.latitudeDeg,
    location.longitudeDeg,
    (location.elevationM ?? 0) / 1000,
  ]);
  if (!Number.isFinite(point.decl)) {
    throw new Error('WMM returned a non-finite declination');
  }
  return { declinationDeg: point.decl, modelName: wmm.name || 'WMM-2025' };
}

/**
 * Magnetic declination for the observer and UTC instant. Never guesses: when
 * the date is outside the model it returns `unsupported` with a warning.
 */
export function computeDeclination(
  location: ObserverLocation,
  date: Date,
): DeclinationResult {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    return {
      declinationDeg: null,
      status: 'unsupported',
      modelName: null,
      warning: 'Invalid date: magnetic declination is unavailable.',
    };
  }
  if (ms < WMM_PACKAGE_START_MS) {
    return {
      declinationDeg: null,
      status: 'unsupported',
      modelName: null,
      warning:
        'WMM2025 starts 2024-11-13. This date is outside the bundled model; declination is not applied.',
    };
  }
  if (ms > WMM_OFFICIAL_END_MS) {
    return {
      declinationDeg: null,
      status: 'unsupported',
      modelName: null,
      warning:
        'WMM2025 is officially valid to 2029-12-31. This date is beyond it; declination is not applied. WMM2030 is expected in December 2029.',
    };
  }
  try {
    const supported = pointDeclination(date, location, false);
    return {
      declinationDeg: supported.declinationDeg,
      status: 'supported',
      modelName: supported.modelName,
      warning: null,
    };
  } catch {
    try {
      const extrapolated = pointDeclination(date, location, true);
      return {
        declinationDeg: extrapolated.declinationDeg,
        status: 'extrapolated',
        modelName: extrapolated.modelName,
        warning:
          'Extrapolated WMM2025: the installed package window ends 2029-11-13, although the model is nominally valid to 2029-12-31. Declination uncertainty grows outside the package window.',
      };
    } catch (error) {
      return {
        declinationDeg: null,
        status: 'unsupported',
        modelName: null,
        warning: `Magnetic declination is unavailable for this date: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
