/**
 * User-facing best-spot explanations.
 *
 * This module is deliberately separate from bestSpot.ts so the Web Worker
 * can import the scoring core without bundling the English string catalogue.
 */

import { t } from '../i18n';
import { compass8Long } from './compass';
import { formatClearPercent } from './bestSpot';
import { formatUtcHhMm } from './path';
import type { BestSpotResult } from './types';

export interface ReasonOptions {
  /** Optional IANA zone used to append a local time. */
  timeZone?: string;
  /** User's minimum elevation margin, degrees (defaults to the shortfall). */
  marginDeg?: number;
}

function localHhMm(utcMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(new Date(utcMs));
  } catch {
    return '';
  }
}

/**
 * Plain-language reason, including the obstruction direction and first
 * blocked time: "Buildings to the SW block from 22:10 UTC".
 */
export function describeBestSpot(
  result: BestSpotResult,
  options: ReasonOptions = {},
): string {
  if (result.insideBuildingId !== null) {
    return t('bestSpot.insideBuilding', { id: result.insideBuildingId });
  }
  if (result.totalSamples === 0) {
    return t('bestSpot.noWindow');
  }
  if (result.score >= 0.999_999) {
    return t('bestSpot.clearWhole', {
      clearance: result.minClearanceDeg.toFixed(1),
    });
  }
  if (result.firstBlockedUtcMs === null) {
    return t('bestSpot.clearPercent', {
      percent: Math.round(result.score * 100),
    });
  }
  const time = formatUtcHhMm(result.firstBlockedUtcMs);
  const local = options.timeZone
    ? localHhMm(result.firstBlockedUtcMs, options.timeZone)
    : '';
  const when = local
    ? t('bestSpot.whenLocal', { time, local })
    : t('bestSpot.whenUtc', { time });
  const source =
    result.firstBlockedSource === 'building'
      ? t('bestSpot.sourceBuildings')
      : result.firstBlockedSource === 'terrain'
        ? t('bestSpot.sourceTerrain')
        : t('bestSpot.sourceHorizon');
  const direction =
    result.firstBlockedAzimuthDeg === null
      ? ''
      : t('bestSpot.direction', {
          direction: compass8Long(result.firstBlockedAzimuthDeg),
        });
  const horizonDeg = result.firstBlockedHorizonDeg;
  const elevationDeg = result.firstBlockedElevationDeg;
  const marginLimited =
    horizonDeg !== null &&
    elevationDeg !== null &&
    elevationDeg > horizonDeg + 0.01;
  if (marginLimited) {
    const margin =
      options.marginDeg ?? Math.max(0, Math.abs(result.minClearanceDeg));
    const verb =
      result.firstBlockedSource === 'building'
        ? t('bestSpot.verbBuildings')
        : t('bestSpot.verbOther');
    return t('bestSpot.marginLimited', {
      source: `${source[0].toUpperCase()}${source.slice(1)}`,
      direction,
      verb,
      margin: margin.toFixed(1),
      when,
      percent: formatClearPercent(result.score),
    });
  }
  return t('bestSpot.blocked', {
    source,
    direction,
    when,
    percent: formatClearPercent(result.score),
    clearance: result.minClearanceDeg.toFixed(1),
  });
}
