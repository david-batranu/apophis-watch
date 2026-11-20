import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_STORAGE_KEY,
  alignmentOffsetDeg,
  alignmentSpreadDeg,
  defaultCalibration,
  estimatePointingError,
  loadCalibration,
  MAX_HORIZONTAL_FOV_DEG,
  MIN_HORIZONTAL_FOV_DEG,
  nudgeHeadingOffset,
  recordAlignment,
  recordTwoPointAlignment,
  sanitizeCalibration,
  saveCalibration,
  setHeadingOffset,
  setHorizontalFov,
  twoPointAlignment,
  type CalibrationInput,
  type StorageLike,
} from '../../src/ar/calibration';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function input(targetAz: number, measured: number, name = 'Target'): CalibrationInput {
  return {
    targetId: `star:${name}`,
    targetName: name,
    targetAzDeg: targetAz,
    measuredHeadingDeg: measured,
    atMs: Date.UTC(2029, 3, 13, 21, 35, 42),
  };
}

describe('calibration maths', () => {
  it('starts at zero offset and 60° FOV', () => {
    const state = defaultCalibration();
    expect(state.headingOffsetDeg).toBe(0);
    expect(state.horizontalFovDeg).toBe(60);
    expect(state.alignments).toEqual([]);
  });

  it('computes an alignment offset east-positive', () => {
    expect(alignmentOffsetDeg(90, 80)).toBeCloseTo(10, 12);
    expect(alignmentOffsetDeg(350, 10)).toBeCloseTo(-20, 12);
    expect(alignmentOffsetDeg(10, 350)).toBeCloseTo(20, 12);
  });

  it('sets and nudges the manual offset with wrapping', () => {
    let state = defaultCalibration();
    state = setHeadingOffset(state, 12.5);
    expect(state.headingOffsetDeg).toBeCloseTo(12.5, 12);
    state = nudgeHeadingOffset(state, 0.1);
    expect(state.headingOffsetDeg).toBeCloseTo(12.6, 12);
    state = setHeadingOffset(state, 350);
    expect(state.headingOffsetDeg).toBeCloseTo(-10, 12);
    state = nudgeHeadingOffset(state, -5);
    expect(state.headingOffsetDeg).toBeCloseTo(-15, 12);
  });

  it('clamps the adjustable FOV', () => {
    expect(setHorizontalFov(defaultCalibration(), 5).horizontalFovDeg).toBe(
      MIN_HORIZONTAL_FOV_DEG,
    );
    expect(setHorizontalFov(defaultCalibration(), 500).horizontalFovDeg).toBe(
      MAX_HORIZONTAL_FOV_DEG,
    );
    expect(setHorizontalFov(defaultCalibration(), 72.5).horizontalFovDeg).toBe(72.5);
  });

  it('one-tap alignment centres the target exactly', () => {
    const state = recordAlignment(defaultCalibration(), input(123, 117));
    expect(state.headingOffsetDeg).toBeCloseTo(6, 12);
    expect(state.alignments).toHaveLength(1);
    expect(state.alignments[0].impliedOffsetDeg).toBeCloseTo(6, 12);
  });

  it('two-point alignment averages two implied offsets and reports disagreement', () => {
    const result = twoPointAlignment(input(90, 80), input(180, 166));
    expect(result.headingOffsetDeg).toBeCloseTo(12, 12);
    expect(result.residualDeg).toBeCloseTo(2, 12);

    const wrapped = twoPointAlignment(input(179, 0), input(181, 0));
    expect(Math.abs(wrapped.headingOffsetDeg)).toBeCloseTo(180, 8);
    expect(wrapped.residualDeg).toBeCloseTo(1, 12);
  });

  it('records two-point calibration and residual', () => {
    const state = recordTwoPointAlignment(
      defaultCalibration(),
      input(90, 80, 'A'),
      input(180, 166, 'B'),
    );
    expect(state.headingOffsetDeg).toBeCloseTo(12, 12);
    expect(state.twoPointResidualDeg).toBeCloseTo(2, 12);
    expect(state.alignments).toHaveLength(2);
    expect(alignmentSpreadDeg(state)).toBeCloseTo(4, 12);
  });

  it('reports honest pointing uncertainty, never false precision', () => {
    const base = defaultCalibration();
    const noCompass = estimatePointingError(base, null);
    expect(noCompass.totalDeg).toBeGreaterThanOrEqual(12);
    expect(noCompass.highDeg).toBeGreaterThanOrEqual(15);
    expect(noCompass.detail).toContain('5–15°');

    const accuracy = estimatePointingError(base, 14);
    expect(accuracy.compassAccuracyDeg).toBe(14);
    expect(accuracy.totalDeg).toBeCloseTo(14, 12);

    const calibratedState = recordTwoPointAlignment(
      base,
      input(90, 80),
      input(180, 166),
    );
    const calibrated = estimatePointingError(calibratedState, 6);
    expect(calibrated.totalDeg).toBeGreaterThanOrEqual(6);
    expect(calibrated.calibrationResidualDeg).toBeCloseTo(2, 12);
  });

  it('round-trips through storage and sanitises corrupt values', () => {
    const storage = new MemoryStorage();
    let state = recordAlignment(defaultCalibration(), input(270, 263));
    state = setHorizontalFov(state, 71.5);
    expect(saveCalibration(state, storage)).toBe(true);
    expect(storage.getItem(CALIBRATION_STORAGE_KEY)).toContain('71.5');
    const loaded = loadCalibration(storage);
    expect(loaded.headingOffsetDeg).toBeCloseTo(7, 12);
    expect(loaded.horizontalFovDeg).toBe(71.5);
    expect(loaded.alignments).toHaveLength(1);

    const bad = sanitizeCalibration({
      headingOffsetDeg: 'nope',
      horizontalFovDeg: 999,
      alignments: [{ targetId: 1 }],
      twoPointResidualDeg: -4,
    });
    expect(bad.headingOffsetDeg).toBe(0);
    expect(bad.horizontalFovDeg).toBe(MAX_HORIZONTAL_FOV_DEG);
    expect(bad.alignments).toEqual([]);
    expect(bad.twoPointResidualDeg).toBeNull();
  });

  it('handles missing or throwing storage', () => {
    expect(loadCalibration(null)).toEqual(defaultCalibration());
    const throwing: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(loadCalibration(throwing)).toEqual(defaultCalibration());
    expect(saveCalibration(defaultCalibration(), throwing)).toBe(false);
  });
});
