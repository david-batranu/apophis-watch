import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { I18nKey } from '../src/i18n';
import { en, t } from '../src/i18n';

function leaves(value: unknown, path = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object') return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

describe('i18n catalogue', () => {
  it('contains only non-empty string leaves', () => {
    const entries = leaves(en);
    expect(entries.length).toBeGreaterThan(300);
    for (const [key, value] of entries) {
      expect(typeof value, key).toBe('string');
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('interpolates parameters without changing the English wording', () => {
    expect(
      t('shell.dataWindowValue', {
        start: '2029-04-13 00:00',
        end: '2029-04-14 00:00',
      }),
    ).toBe('2029-04-13 00:00 → 2029-04-14 00:00 UTC');
    expect(
      t('terrain.bestStatusCompleteClear', {
        percent: '78',
        lat: '45.64270',
        lon: '25.58870',
      }),
    ).toBe('78% clear (pessimistic) at 45.64270°, 25.58870°');
    expect(t('ar.sensorCompassAccuracy', { accuracy: '0.5' })).toBe(
      'Compass heading, device reports ±0.5°.',
    );
    // Unknown placeholders are left visible instead of silently disappearing.
    expect(t('shell.rangeSub')).toBe('{ratio} lunar distances');
  });

  it('keeps the critical English wording used by existing tests', () => {
    const critical: I18nKey[] = [
      'shell.tabSky',
      'shell.tabSpace',
      'shell.tabLocal',
      'shell.tabAr',
      'shell.offlineReady',
      'shell.offlineNotPrepared',
      'shell.offlineAreaNotPrepared',
      'event.title',
      'event.subtitle',
      'ar.sensorStatusDenied',
      'ar.sensorDeniedSettings',
      'ar.cameraDenied',
      'terrain.bestStatusCompletePrefix',
      'terrain.bestStatusCompleteClear',
      'terrain.bestHostStatus',
      'terrain.headerTitle',
      'shell.scrubAria',
      'shell.refractionSubAirless',
    ];
    for (const key of critical) {
      expect(t(key).length, key).toBeGreaterThan(0);
    }
    expect(t('ar.sensorStatusDenied')).toBe('Sensors denied');
    expect(t('ar.cameraDenied')).toMatch(/^Camera permission denied\./);
    expect(t('terrain.bestStatusCompletePrefix')).toBe('Search complete: ');
    expect(t('shell.scrubAria')).toBe('Time scrub');
    expect(t('shell.refractionSubAirless')).toBe('airless');
    expect(t('terrain.headerTitle')).toBe(
      'Terrain, buildings &amp; best spot',
    );
  });
});

/**
 * Practical hardcoded-copy guard for the migrated UI modules. It looks for the
 * common shapes (`textContent = '…'`, `fillText('…')`, `aria-label="…"` and
 * `>English text<`) and ignores interpolation, markup, URLs, classes and
 * proper nouns/units.
 */
describe('scoped UI modules', () => {
  const files = [
    'src/ui/app.ts',
    'src/ui/eventGuide.ts',
    'src/ui/elevationPlot.ts',
    'src/ui/timeFormat.ts',
    'src/terrain/ui.ts',
    'src/terrain/mapView.ts',
    'src/terrain/scene3d.ts',
    'src/terrain/horizonChart.ts',
    'src/terrain/bestSpot.ts',
    'src/terrain/path.ts',
    'src/terrain/buildings.ts',
    'src/terrain/terrainGrid.ts',
    'src/terrain/bundledAreas.ts',
    'src/ar/arView.ts',
    'src/ar/calibration.ts',
    'src/ar/declination.ts',
    'src/ar/targets.ts',
    'src/sky/skyRenderer.ts',
    'src/sky/spaceView.ts',
    'src/state/appModel.ts',
    'src/offline/prepare.ts',
    'src/main.ts',
  ];

  const allowed = [
    /^[A-Z][A-Za-z0-9.-]*(?: [A-Z][A-Za-z0-9.-]*)*$/, // proper nouns
    /^(?:N|E|S|W|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|km|m|UTC|ISS|Sun|Moon)$/,
    /^(?:OpenStreetMap|Apophis|NASA|JPL|WMM\d*|HYG|Leaflet|Mapzen|AWS|ODbL|MIT)\b/,
    /^HTTP \d+/,
  ];

  const hasEnglishWords = (value: string): boolean => {
    const withoutInterpolation = value.replace(/\$\{[^}]*\}/g, ' ');
    if (!/[A-Za-z]{2,}[^A-Za-z0-9]{1,}[A-Za-z]{2,}/.test(withoutInterpolation)) {
      return false;
    }
    if (/[<>]|class=|data-|https?:/.test(withoutInterpolation)) return false;
    return !allowed.some((pattern) => pattern.test(withoutInterpolation.trim()));
  };

  const patterns: RegExp[] = [
    /(?:textContent|innerHTML|fillText)\s*=\s*['"`]([^'"`]+)['"`]/g,
    /aria-label\s*=\s*"([^"]+)"/g,
    /placeholder\s*=\s*"([^"]+)"/g,
    /title:\s*['"`]([^'"`]+)['"`]/g,
    />(\s*[A-Z][^<>{}]*?)</g,
  ];

  it('does not contain obvious hardcoded user copy', () => {
    const failures: string[] = [];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (line.includes('t(')) return;
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line))) {
            const value = match[1];
            if (hasEnglishWords(value)) {
              failures.push(`${file}:${index + 1}: ${JSON.stringify(value)}`);
            }
          }
        }
      });
    }
    expect(failures).toEqual([]);
  });
});
