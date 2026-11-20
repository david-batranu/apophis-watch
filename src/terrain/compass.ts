/**
 * Compass labels for UI/canvas text.
 *
 * Kept out of `geo.ts` so the best-spot worker can import pure geometry
 * without pulling the whole English catalogue into its bundle.
 */

import { t } from '../i18n';
import { normalizeAzimuth } from './geo';

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/** Eight-point compass name, e.g. "SW". */
export function compass8(azimuthDeg: number): string {
  return COMPASS_8[Math.round(normalizeAzimuth(azimuthDeg) / 45) % 8];
}

/** Eight-point compass name in prose, e.g. "south-west". */
export function compass8Long(azimuthDeg: number): string {
  const names = [
    t('compass.north'),
    t('compass.northEast'),
    t('compass.east'),
    t('compass.southEast'),
    t('compass.south'),
    t('compass.southWest'),
    t('compass.west'),
    t('compass.northWest'),
  ];
  return names[Math.round(normalizeAzimuth(azimuthDeg) / 45) % 8];
}

/** Sixteen-point compass name, e.g. "WSW". */
export function compass16(azimuthDeg: number): string {
  return COMPASS_16[Math.round(normalizeAzimuth(azimuthDeg) / 22.5) % 16];
}
