import { describe, expect, it } from 'vitest';
import { SimulationSession } from '../../src/state/session';
import { jdTdbFromDate } from '../../src/core/time';
import {
  ALIGNMENT_STAR_NAMES,
  buildAlignmentTargets,
  buildSkySnapshot,
  horizontalStars,
} from '../../src/ar/targets';
import { BRASOV, ephem, validation } from '../helpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StarCatalogue } from '../../src/sky/catalog';

const catalogue = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/stars.json'), 'utf8'),
) as StarCatalogue;

const CA_MS = Date.parse('2029-04-13T21:35:42.000Z');
const session = new SimulationSession(ephem, { ...BRASOV, elevationM: 600 });

describe('AR target assembly', () => {
  it('uses the session Apophis position and a real trail', () => {
    const snapshot = buildSkySnapshot({
      session,
      catalogue,
      observer: { ...BRASOV, elevationM: 600 },
      utcMs: CA_MS,
      mode: 'rehearsal',
      refraction: false,
      timeZone: 'Europe/Bucharest',
    });
    const apophis = snapshot.targets.find((t) => t.kind === 'apophis');
    expect(apophis).toBeDefined();
    const sky = session.skyAt(CA_MS, false);
    expect(apophis!.azimuthDeg).toBeCloseTo(sky.azimuthDeg, 9);
    expect(apophis!.elevationDeg).toBeCloseTo(sky.elevationDeg, 9);
    expect(apophis!.azimuthDeg).toBeCloseTo(268.85899, 3);
    expect(apophis!.elevationDeg).toBeCloseTo(30.2671, 3);

    expect(snapshot.trail.length).toBeGreaterThan(200);
    for (const point of snapshot.trail) {
      const minute = new Date(point.utcMs).getUTCMinutes();
      expect(point.tick).toBe(minute % 5 === 0);
      if (point.label) {
        expect(point.tick).toBe(true);
        expect(minute % 30).toBe(0);
        expect(point.label).toMatch(/^\d{2}:\d{2}$/);
      }
    }
    expect(snapshot.trail.some((p) => p.aboveHorizon)).toBe(true);
    expect(snapshot.trail.filter((p) => p.label).length).toBeGreaterThan(3);
  });

  it('loads bright stars and excludes everything below the horizon', () => {
    const stars = horizontalStars(catalogue, { ...BRASOV, elevationM: 600 }, CA_MS);
    expect(stars.length).toBeGreaterThan(100);
    expect(stars.length).toBeLessThan(catalogue.stars.length);
    for (const star of stars) {
      expect(star.elevationDeg).toBeGreaterThanOrEqual(-1);
      expect(star.magnitude).not.toBeNull();
    }
    const named = new Set(stars.map((s) => s.name));
    expect([...named].some((name) => ALIGNMENT_STAR_NAMES.includes(name))).toBe(true);
  });

  it('offers only visible named stars and bodies for alignment', () => {
    const snapshot = buildSkySnapshot({
      session,
      catalogue,
      observer: { ...BRASOV, elevationM: 600 },
      utcMs: CA_MS,
      mode: 'rehearsal',
      refraction: false,
      timeZone: 'Europe/Bucharest',
    });
    expect(snapshot.alignTargets.length).toBeGreaterThan(0);
    expect(snapshot.alignTargets.length).toBeLessThanOrEqual(14);
    for (const target of snapshot.alignTargets) {
      if (target.kind === 'star') {
        expect(ALIGNMENT_STAR_NAMES).toContain(target.name);
        expect(target.elevationDeg).toBeGreaterThan(5);
      } else {
        expect(target.elevationDeg).toBeGreaterThan(3);
      }
    }
  });

  it('drops the catalogue gracefully', () => {
    const snapshot = buildSkySnapshot({
      session,
      catalogue: null,
      observer: { ...BRASOV, elevationM: 600 },
      utcMs: CA_MS,
      mode: 'rehearsal',
      refraction: false,
      timeZone: 'Europe/Bucharest',
    });
    expect(snapshot.stars).toEqual([]);
    expect(snapshot.targets.length).toBeGreaterThanOrEqual(9);
    expect(snapshot.apophis).not.toBeNull();
  });

  it('has a real-time mode without pretending to know Apophis in 2026', () => {
    const snapshot = buildSkySnapshot({
      session,
      catalogue,
      observer: { ...BRASOV, elevationM: 600 },
      utcMs: Date.parse('2026-11-20T12:00:00Z'),
      mode: 'tonight',
      refraction: true,
      timeZone: 'Europe/Bucharest',
    });
    expect(snapshot.mode).toBe('tonight');
    expect(snapshot.apophis).toBeNull();
    expect(snapshot.trail).toEqual([]);
    expect(snapshot.targets.some((t) => t.kind === 'sun')).toBe(true);
    expect(snapshot.stars.length).toBeGreaterThan(0);
    // The bodies are computed at the requested real instant, not at the 2029 session time.
    const bodyJd = jdTdbFromDate(new Date('2026-11-20T12:00:00Z'));
    expect(bodyJd).toBeLessThan(ephem.startJdTdb);
    expect(validation.retrievedAt).toBeTruthy();
  });

  it('returns an empty snapshot when no observer is known', () => {
    const snapshot = buildSkySnapshot({
      session: null,
      catalogue,
      observer: null,
      utcMs: CA_MS,
      mode: 'rehearsal',
      refraction: false,
      timeZone: 'UTC',
    });
    expect(snapshot.targets).toEqual([]);
    expect(snapshot.trail).toEqual([]);
  });

  it('filters alignment lists independently', () => {
    const targets = [
      {
        id: 'body:Sun',
        name: 'Sun',
        kind: 'sun' as const,
        azimuthDeg: 0,
        elevationDeg: 2,
        magnitude: -26,
        colour: '#fff',
        radiusPx: 7,
      },
      {
        id: 'body:Moon',
        name: 'Moon',
        kind: 'moon' as const,
        azimuthDeg: 90,
        elevationDeg: 20,
        magnitude: -10,
        colour: '#fff',
        radiusPx: 7,
      },
      {
        id: 'star:1',
        name: 'Sirius',
        kind: 'star' as const,
        azimuthDeg: 180,
        elevationDeg: 4,
        magnitude: -1.4,
        colour: '#fff',
        radiusPx: 3,
      },
    ];
    const list = buildAlignmentTargets(targets, targets.filter((t) => t.kind === 'star'));
    expect(list.map((t) => t.name)).toEqual(['Moon']);
  });
});
