import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_STORAGE_KEY,
  MIN_FOV_TARGET_SEPARATION_DEG,
  alignmentOffsetDeg,
  alignmentSpreadDeg,
  angularSeparationDeg,
  defaultCalibration,
  estimatePointingError,
  focalPxFromHorizontalFov,
  horizontalFovFromFocalPx,
  loadCalibration,
  MAX_HORIZONTAL_FOV_DEG,
  MIN_HORIZONTAL_FOV_DEG,
  nudgeHeadingOffset,
  recordAlignment,
  recordFovCalibration,
  recordTwoPointAlignment,
  sanitizeCalibration,
  saveCalibration,
  setHeadingOffset,
  setHorizontalFov,
  solveFovFromAngularSeparation,
  twoPointAlignment,
  type CalibrationInput,
  type FovCalibration,
  type FovTap,
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

function tapSeparationForFocal(
  width: number,
  height: number,
  a: FovTap,
  b: FovTap,
  focalPx: number,
): number {
  const u1 = a.x - width / 2;
  const v1 = height / 2 - a.y;
  const u2 = b.x - width / 2;
  const v2 = height / 2 - b.y;
  const dot = u1 * u2 + v1 * v2 + focalPx * focalPx;
  const n1 = Math.hypot(u1, v1, focalPx);
  const n2 = Math.hypot(u2, v2, focalPx);
  return Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * (180 / Math.PI);
}

describe('calibration maths', () => {
  it('starts at zero offset and 60° FOV', () => {
    const state = defaultCalibration();
    expect(state.headingOffsetDeg).toBe(0);
    expect(state.horizontalFovDeg).toBe(60);
    expect(state.alignments).toEqual([]);
    expect(state.twoPointFov).toBeNull();
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

    const accuracyZero = estimatePointingError(base, 0);
    expect(accuracyZero.compassAccuracyDeg).toBeNull();
    expect(accuracyZero.totalDeg).toBeGreaterThanOrEqual(12);

    const subDegree = estimatePointingError(base, 0.5);
    expect(subDegree.compassAccuracyDeg).toBe(0.5);
    expect(subDegree.detail).toContain('device compass ±0.5°');
    expect(subDegree.totalDeg).toBeGreaterThanOrEqual(1);

    const calibratedState = recordTwoPointAlignment(
      base,
      input(90, 80),
      input(180, 166),
    );
    const calibrated = estimatePointingError(calibratedState, 6);
    expect(calibrated.totalDeg).toBeGreaterThanOrEqual(6);
    expect(calibrated.calibrationResidualDeg).toBeCloseTo(2, 12);
  });

  it('clears a stale heading residual on one-tap or manual offset', () => {
    let state = recordTwoPointAlignment(
      defaultCalibration(),
      input(90, 80, 'A'),
      input(180, 166, 'B'),
    );
    expect(state.twoPointResidualDeg).toBeCloseTo(2, 12);
    state = recordAlignment(state, input(123, 120, 'C'));
    expect(state.twoPointResidualDeg).toBeNull();
    state = recordTwoPointAlignment(state, input(90, 80, 'D'), input(180, 166, 'E'));
    expect(state.twoPointResidualDeg).not.toBeNull();
    state = nudgeHeadingOffset(state, 0.1);
    expect(state.twoPointResidualDeg).toBeNull();
  });

  it('solves a real two-tap FOV from angular separation', () => {
    const width = 390;
    const height = 844;
    const fov60 = focalPxFromHorizontalFov(width, 60);
    expect(horizontalFovFromFocalPx(width, fov60)).toBeCloseTo(60, 10);
    const a = { x: 110, y: 300 };
    const b = { x: 290, y: 540 };
    const separation = tapSeparationForFocal(width, height, a, b, fov60);
    expect(separation).toBeGreaterThan(MIN_FOV_TARGET_SEPARATION_DEG);
    const solved = solveFovFromAngularSeparation(width, height, a, b, separation);
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.focalPx).toBeCloseTo(fov60, 3);
    expect(solved.horizontalFovDeg).toBeCloseTo(60, 3);

    const fov50 = focalPxFromHorizontalFov(width, 50);
    const separation50 = tapSeparationForFocal(width, height, a, b, fov50);
    const solved50 = solveFovFromAngularSeparation(width, height, a, b, separation50);
    expect(solved50.ok).toBe(true);
    if (!solved50.ok) return;
    expect(solved50.horizontalFovDeg).toBeCloseTo(50, 3);
  });

  it('rejects degenerate two-tap FOV input', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 300, y: 500 };
    const same = solveFovFromAngularSeparation(390, 844, a, a, 20);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error).toMatch(/px apart/);

    const tooCloseTargets = solveFovFromAngularSeparation(390, 844, a, b, 2);
    expect(tooCloseTargets.ok).toBe(false);
    if (!tooCloseTargets.ok) expect(tooCloseTargets.error).toMatch(/at least 5°/);

    const nearCentre = solveFovFromAngularSeparation(
      390,
      844,
      { x: 190, y: 400 },
      { x: 220, y: 430 },
      40,
    );
    expect(nearCentre.ok).toBe(false);
  });

  it('persists a solved FOV result and clears it on manual FOV change', () => {
    const fov: FovCalibration = {
      horizontalFovDeg: 52.4,
      separationDeg: 18.2,
      residualPx: 3.1,
      residualDeg: 0.5,
      targetAId: 'body:Jupiter',
      targetAName: 'Jupiter',
      targetBId: 'star:69673',
      targetBName: 'Arcturus',
      atMs: 123456,
    };
    const state = recordFovCalibration(defaultCalibration(), fov);
    expect(state.horizontalFovDeg).toBe(52.4);
    expect(state.twoPointFov?.targetBName).toBe('Arcturus');
    const storage = new MemoryStorage();
    saveCalibration(state, storage);
    const loaded = loadCalibration(storage);
    expect(loaded.horizontalFovDeg).toBe(52.4);
    expect(loaded.twoPointFov?.residualPx).toBe(3.1);
    const manual = setHorizontalFov(loaded, 70);
    expect(manual.twoPointFov).toBeNull();
    expect(manual.horizontalFovDeg).toBe(70);
  });

  it('canonical angular separations are stable', () => {
    expect(angularSeparationDeg(0, 0, 90, 0)).toBeCloseTo(90, 9);
    expect(angularSeparationDeg(10, 20, 10, 20)).toBeCloseTo(0, 9);
    expect(angularSeparationDeg(0, 0, 0, 90)).toBeCloseTo(90, 9);
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
