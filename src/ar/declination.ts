import { model } from 'geomagnetism';
import type { ObserverLocation } from '../ephemeris/types';
import { t } from '../i18n';

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
    throw new Error(t('ar.declinationInvalidResult'));
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
      warning: t('ar.declinationInvalidDate'),
    };
  }
  if (ms < WMM_PACKAGE_START_MS) {
    return {
      declinationDeg: null,
      status: 'unsupported',
      modelName: null,
      warning: t('ar.declinationBeforeModel'),
    };
  }
  if (ms > WMM_OFFICIAL_END_MS) {
    return {
      declinationDeg: null,
      status: 'unsupported',
      modelName: null,
      warning: t('ar.declinationAfterModel'),
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
        warning: t('ar.declinationExtrapolated'),
      };
    } catch (error) {
      return {
        declinationDeg: null,
        status: 'unsupported',
        modelName: null,
        warning: t('ar.declinationUnavailable', {
          message: error instanceof Error ? error.message : String(error),
        }),
      };
    }
  }
}
