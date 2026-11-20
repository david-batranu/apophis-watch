import { describe, expect, it } from 'vitest';
import { SimulationSession } from '../src/state/session';
import { jdToMs } from '../src/core/time';
import { ephem, validation } from './helpers';

const BRASOV = {
  latitudeDeg: 45.6427,
  longitudeDeg: 25.5887,
  elevationM: 600,
};

describe('Phase 2 simulation session', () => {
  const session = new SimulationSession(ephem, BRASOV);

  it('uses Phase 1 geocentric and topocentric closest approaches', () => {
    expect(session.geocentricCa.utc.toISOString()).toBe('2029-04-13T21:45:03.557Z');
    const truth = Date.parse(validation.topocentricClosestApproachTruth.refinedUtc);
    expect(Math.abs(session.topocentricCa.utc.getTime() - truth)).toBeLessThan(2000);
    expect(
      Math.abs(
        session.topocentricCa.rangeKm -
          validation.topocentricClosestApproachTruth.rangeKm,
      ),
    ).toBeLessThan(0.1);
  });

  it('maps every jump button to the Phase 1 derived event', () => {
    expect(session.jumpTarget('geocentricCa')).toBe(session.geocentricCa.utc.getTime());
    expect(session.jumpTarget('topocentricCa')).toBe(
      session.topocentricCa.utc.getTime(),
    );
    expect(session.jumpTarget('rise')).not.toBeNull();
    expect(session.jumpTarget('set')).not.toBeNull();
    expect(session.jumpTarget('maxElevation')).not.toBeNull();
    const interval = session.visibleIntervalForJump();
    expect(interval).not.toBeNull();
    expect(session.jumpTarget('visibilityStart')).toBe(interval!.startUtc.getTime());
    expect(session.jumpTarget('visibilityEnd')).toBe(interval!.endUtc.getTime());
    for (const target of [
      'rise',
      'set',
      'maxElevation',
      'visibilityStart',
      'visibilityEnd',
    ] as const) {
      const ms = session.jumpTarget(target)!;
      expect(ms).toBeGreaterThanOrEqual(session.windowStartMs);
      expect(ms).toBeLessThanOrEqual(session.windowEndMs);
    }
  });

  it('builds a finite, ordered elevation/magnitude series', () => {
    expect(session.plotSamples.length).toBeGreaterThan(1400);
    expect(session.plotSamples[0].utcMs).toBe(session.windowStartMs);
    expect(session.plotSamples.at(-1)!.utcMs).toBeLessThanOrEqual(
      session.windowEndMs,
    );
    for (let i = 1; i < session.plotSamples.length; i++) {
      expect(session.plotSamples[i].utcMs).toBeGreaterThan(
        session.plotSamples[i - 1].utcMs,
      );
      expect(Number.isFinite(session.plotSamples[i].elevationDeg)).toBe(true);
      expect(Number.isFinite(session.plotSamples[i].magnitude)).toBe(true);
    }
  });

  it('returns a 1-minute, time-ordered trail clipped to the window', () => {
    const center = Date.parse('2029-04-13T20:45:00Z');
    const trail = session.trail(center, 3, true);
    expect(trail.length).toBeGreaterThan(300);
    expect(trail[0].utcMs).toBeGreaterThanOrEqual(session.windowStartMs);
    expect(trail.at(-1)!.utcMs).toBeLessThanOrEqual(session.windowEndMs);
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i].utcMs - trail[i - 1].utcMs).toBe(60_000);
      expect(Number.isFinite(trail[i].azimuthDeg)).toBe(true);
      expect(Number.isFinite(trail[i].elevationDeg)).toBe(true);
    }
    expect(trail.some((s) => s.inVisibilityWindow)).toBe(true);
  });

  it('keeps the viewer inside the committed window', () => {
    expect(jdToMs(0)).toBeDefined();
    expect(session.windowEndMs - session.windowStartMs).toBe(172_800_000);
  });
});
