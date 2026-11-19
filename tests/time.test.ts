import { describe, expect, it } from 'vitest';
import { AstroTime } from 'astronomy-engine';
import {
  dateFromJdTdb,
  dateToJdUtc,
  JD_J2000,
  jdTdbFromDate,
  jdTtFromDate,
  jdUtcFromJdTdb,
  taiMinusUtcSeconds,
  TT_MINUS_UTC_SECONDS,
  ttMinusUtcSeconds,
} from '../src/core/time';
import { findClosestApproach } from '../src/ephemeris/events';
import { ephem, validation } from './helpers';

const CA_UTC = new Date('2029-04-13T21:45:03.557Z');

describe('time scales', () => {
  it('uses TT = UTC + 37 leap seconds + 32.184 s in 2029', () => {
    expect(TT_MINUS_UTC_SECONDS).toBe(69.184);
    expect(taiMinusUtcSeconds(CA_UTC)).toBe(37);
    expect(ttMinusUtcSeconds(CA_UTC)).toBe(69.184);
    // Double-precision Julian dates carry ~40 microseconds of quantisation.
    expect(Math.abs((jdTtFromDate(CA_UTC) - dateToJdUtc(CA_UTC)) * 86400 - 69.184)).toBeLessThan(1e-3);
    // Historical table sanity: 1990 had 25 leap seconds, 2000 had 32.
    expect(ttMinusUtcSeconds(new Date('1990-01-01T00:00:00Z'))).toBe(32.184 + 25);
    expect(ttMinusUtcSeconds(new Date('2000-01-01T12:00:00Z'))).toBe(32.184 + 32);
  });

  it('does not use astronomy-engine Delta-T as TT-UTC (regression)', () => {
    // astronomy-engine's .tt is TT-UT1 from a Delta-T prediction (~77 s in
    // 2029). Using it as TT-UTC shifted Apophis by ~59 km. Keep this pinned.
    const astroDeltaT = (new AstroTime(CA_UTC).tt + JD_J2000 - dateToJdUtc(CA_UTC)) * 86400;
    expect(astroDeltaT).toBeGreaterThan(75);
    const actualTdbMinusUtc = (jdTdbFromDate(CA_UTC) - dateToJdUtc(CA_UTC)) * 86400;
    expect(actualTdbMinusUtc).toBeGreaterThan(69.18);
    expect(actualTdbMinusUtc).toBeLessThan(69.19);
    expect(Math.abs(actualTdbMinusUtc - astroDeltaT)).toBeGreaterThan(7);
  });

  it('round-trips TDB Julian date to UTC within 1 ms', () => {
    const jdTdb = jdTdbFromDate(CA_UTC);
    expect(Math.abs(dateFromJdTdb(jdTdb).getTime() - CA_UTC.getTime())).toBeLessThan(1);
  });

  it('agrees with the independent Horizons 10 s closest-approach time', () => {
    const ca = findClosestApproach(ephem);
    const truth = Date.parse(validation.closestApproachTruth.refinedUtc);
    expect(Math.abs(ca.utc.getTime() - truth)).toBeLessThan(2000);
  });

  it('displays closest approach in both UTC and TDB', () => {
    const ca = findClosestApproach(ephem);
    const tdbMinusUtcSeconds = (ca.jdTdb - dateToJdUtc(ca.utc)) * 86400;
    expect(tdbMinusUtcSeconds).toBeGreaterThan(69.18);
    expect(tdbMinusUtcSeconds).toBeLessThan(69.19);
    expect(Math.abs(jdUtcFromJdTdb(ca.jdTdb) - dateToJdUtc(ca.utc)) * 86400).toBeLessThan(0.001);
    expect(ca.utc.toISOString()).toMatch(/^2029-04-13T21:4[45]:/);
  });
});
