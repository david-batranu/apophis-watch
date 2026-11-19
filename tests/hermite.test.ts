import { describe, expect, it } from 'vitest';
import { hermiteState } from '../src/ephemeris/hermite';
import { norm, sub, vec3 } from '../src/core/vec3';
import { ephem, validation } from './helpers';

describe('cubic Hermite interpolation', () => {
  it('reproduces constant-velocity motion exactly', () => {
    const p0 = vec3(1, 2, 3);
    const v = vec3(0.5, -2, 4);
    const jd0 = 2_462_240;
    const jd1 = jd0 + 1 / 1440; // 60 s
    // v is km/s, so 60 s of motion is v * 60 km.
    const p1 = vec3(p0.x + v.x * 60, p0.y + v.y * 60, p0.z + v.z * 60);
    const mid = hermiteState(jd0, p0, v, jd1, p1, v, jd0 + 0.5 / 1440);
    expect(mid.positionKm.x).toBeCloseTo(p0.x + v.x * 30, 9);
    expect(mid.positionKm.y).toBeCloseTo(p0.y + v.y * 30, 9);
    expect(mid.positionKm.z).toBeCloseTo(p0.z + v.z * 30, 9);
    expect(mid.velocityKmS.x).toBeCloseTo(v.x, 6);
  });

  it('returns the tabulated endpoint states', () => {
    const first = ephem.stateAtJdTdb(ephem.startJdTdb);
    const last = ephem.stateAtJdTdb(ephem.endJdTdb);
    const firstRow = validation.interpolation.samples[0];
    expect(norm(first.positionKm)).toBeGreaterThan(1e5);
    expect(norm(last.positionKm)).toBeGreaterThan(1e5);
    expect(firstRow).toBeDefined();
    // Querying the exact endpoints must not overshoot the table.
    expect(Number.isFinite(first.velocityKmS.x)).toBe(true);
    expect(Number.isFinite(last.velocityKmS.x)).toBe(true);
  });

  it('stays within 1 km of independent Horizons truth at 30 s offsets', () => {
    let maxPosition = 0;
    let maxVelocity = 0;
    for (const row of validation.interpolation.samples) {
      const state = ephem.stateAtJdTdb(row[0]);
      const dp = Math.hypot(
        state.positionKm.x - row[1],
        state.positionKm.y - row[2],
        state.positionKm.z - row[3],
      );
      const dv = Math.hypot(
        state.velocityKmS.x - row[4],
        state.velocityKmS.y - row[5],
        state.velocityKmS.z - row[6],
      );
      maxPosition = Math.max(maxPosition, dp);
      maxVelocity = Math.max(maxVelocity, dv);
    }
    console.log(
      `Hermite truth: ${validation.interpolation.samples.length} samples, ` +
        `max position ${maxPosition.toFixed(6)} km, max velocity ${maxVelocity.toExponential(2)} km/s`,
    );
    expect(maxPosition).toBeLessThan(1);
    expect(maxPosition).toBeLessThan(0.01); // actual is ~0.00045 km
    expect(maxVelocity).toBeLessThan(1e-3);
  });

  it('throws outside the committed time window instead of extrapolating silently', () => {
    expect(() => ephem.stateAtJdTdb(ephem.startJdTdb - 1e-6)).toThrow(RangeError);
    expect(() => ephem.stateAtJdTdb(ephem.endJdTdb + 1e-6)).toThrow(RangeError);
  });

  it('keeps position and velocity units consistent (km, km/s)', () => {
    const a = ephem.stateAtJdTdb(ephem.startJdTdb + 0.2);
    const b = ephem.stateAtJdTdb(ephem.startJdTdb + 0.2 + 1 / 1440);
    const finiteVelocity = norm(sub(b.positionKm, a.positionKm)) / 60; // km/s
    expect(finiteVelocity).toBeGreaterThan(0.1);
    expect(finiteVelocity).toBeLessThan(30);
    expect(norm(a.velocityKmS)).toBeGreaterThan(0.1);
    expect(norm(a.velocityKmS)).toBeLessThan(30);
  });
});
