import { clamp } from '../core/vec3';
import { normalizeDeg, shortestAngleDeg } from './math';

export const CALIBRATION_STORAGE_KEY = 'apophis-ar-calibration-v1';
export const DEFAULT_HORIZONTAL_FOV_DEG = 60;
export const MIN_HORIZONTAL_FOV_DEG = 30;
export const MAX_HORIZONTAL_FOV_DEG = 100;

export interface AlignmentSample {
  /** Catalogue/body id, e.g. "star:32349" or "body:Sun". */
  targetId: string;
  targetName: string;
  targetAzDeg: number;
  measuredHeadingDeg: number;
  /** Offset that would have centred this target, degrees east-positive. */
  impliedOffsetDeg: number;
  atMs: number;
}

export interface CalibrationState {
  version: 1;
  /** Added to the measured true heading. Positive rotates the overlay east. */
  headingOffsetDeg: number;
  /** Screen-width horizontal field of view, degrees. */
  horizontalFovDeg: number;
  alignments: AlignmentSample[];
  /** Half the disagreement between the last two-point heading alignment, degrees. */
  twoPointResidualDeg: number | null;
  /** Result of the real two-target FOV solve (pixel taps), or null. */
  twoPointFov: FovCalibration | null;
}

export interface FovTap {
  x: number;
  y: number;
}

export interface FovCalibration {
  horizontalFovDeg: number;
  /** Known angular separation of the two targets, degrees. */
  separationDeg: number;
  /** RMS registration residual of the two taps at the solved FOV, pixels. */
  residualPx: number;
  /** Residual expressed as an angle at the solved focal length, degrees. */
  residualDeg: number;
  targetAId: string;
  targetAName: string;
  targetBId: string;
  targetBName: string;
  atMs: number;
}

export const MIN_FOV_TARGET_SEPARATION_DEG = 5;
export const MIN_FOV_TAP_SEPARATION_PX = 12;

export type FovSolveResult =
  | {
      ok: true;
      focalPx: number;
      horizontalFovDeg: number;
      separationDeg: number;
      tapSeparationPx: number;
    }
  | { ok: false; error: string };

export interface CalibrationInput {
  targetId: string;
  targetName: string;
  targetAzDeg: number;
  measuredHeadingDeg: number;
  atMs: number;
}

export interface TwoPointResult {
  headingOffsetDeg: number;
  /** Half the angular disagreement between the two implied offsets. */
  residualDeg: number;
}

/** Angular separation between two horizontal coordinates, degrees. */
export function angularSeparationDeg(
  az1Deg: number,
  el1Deg: number,
  az2Deg: number,
  el2Deg: number,
): number {
  const toRad = Math.PI / 180;
  const el1 = el1Deg * toRad;
  const el2 = el2Deg * toRad;
  const dAz = (az2Deg - az1Deg) * toRad;
  const cosSep =
    Math.sin(el1) * Math.sin(el2) +
    Math.cos(el1) * Math.cos(el2) * Math.cos(dAz);
  return Math.acos(clamp(cosSep, -1, 1)) * (180 / Math.PI);
}

export function horizontalFovFromFocalPx(width: number, focalPx: number): number {
  if (!(width > 0) || !(focalPx > 0)) return Number.NaN;
  return 2 * Math.atan(width / 2 / focalPx) * (180 / Math.PI);
}

export function focalPxFromHorizontalFov(width: number, fovDeg: number): number {
  if (!(width > 0) || !(fovDeg > 0 && fovDeg < 180)) return Number.NaN;
  return width / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Solve a pinhole horizontal FOV from two screen taps and the known angular
 * separation of the objects being tapped.
 *
 * The camera orientation and heading offset are deliberately not inputs: the
 * angle between two pixel rays depends only on the pixel positions and the
 * focal length. This keeps the FOV solve independent of compass calibration.
 * A reprojection residual can still be computed by the caller to show how well
 * the current heading registration matches the taps.
 */
export function solveFovFromAngularSeparation(
  width: number,
  height: number,
  a: FovTap,
  b: FovTap,
  separationDeg: number,
): FovSolveResult {
  if (!(width > 0) || !(height > 0)) {
    return { ok: false, error: 'The camera viewport has no size yet.' };
  }
  if (![a.x, a.y, b.x, b.y].every((value) => Number.isFinite(value))) {
    return { ok: false, error: 'The tap coordinates are invalid.' };
  }
  if (!(separationDeg > 0) || separationDeg >= 179) {
    return { ok: false, error: 'The two targets do not have a usable angular separation.' };
  }
  if (separationDeg < MIN_FOV_TARGET_SEPARATION_DEG) {
    return {
      ok: false,
      error: `Choose targets at least ${MIN_FOV_TARGET_SEPARATION_DEG}° apart; these are only ${separationDeg.toFixed(1)}° apart.`,
    };
  }
  const tapSeparationPx = Math.hypot(b.x - a.x, b.y - a.y);
  if (tapSeparationPx < MIN_FOV_TAP_SEPARATION_PX) {
    return {
      ok: false,
      error: `The two taps are only ${tapSeparationPx.toFixed(0)} px apart; tap each object more precisely.`,
    };
  }
  const cx = width / 2;
  const cy = height / 2;
  const u1 = a.x - cx;
  const v1 = cy - a.y;
  const u2 = b.x - cx;
  const v2 = cy - b.y;

  const angleAt = (focalPx: number): number => {
    const dot = u1 * u2 + v1 * v2 + focalPx * focalPx;
    const n1 = Math.hypot(u1, v1, focalPx);
    const n2 = Math.hypot(u2, v2, focalPx);
    return Math.acos(clamp(dot / (n1 * n2), -1, 1)) * (180 / Math.PI);
  };

  let low = 0.01;
  let high = 1e7;
  const angleLow = angleAt(low);
  const angleHigh = angleAt(high);
  if (angleLow < separationDeg || angleHigh > separationDeg) {
    return {
      ok: false,
      error: 'The taps do not fit any pinhole FOV in the supported range. Re-centre the objects and tap again.',
    };
  }
  for (let i = 0; i < 90; i++) {
    const mid = Math.sqrt(low * high);
    if (angleAt(mid) > separationDeg) low = mid;
    else high = mid;
  }
  const focalPx = Math.sqrt(low * high);
  const horizontalFovDeg = horizontalFovFromFocalPx(width, focalPx);
  if (
    !Number.isFinite(horizontalFovDeg) ||
    horizontalFovDeg < MIN_HORIZONTAL_FOV_DEG ||
    horizontalFovDeg > MAX_HORIZONTAL_FOV_DEG
  ) {
    return {
      ok: false,
      error: `Solved FOV ${horizontalFovDeg.toFixed(1)}° is outside the ${MIN_HORIZONTAL_FOV_DEG}–${MAX_HORIZONTAL_FOV_DEG}° supported range. Check the targets and taps.`,
    };
  }
  return {
    ok: true,
    focalPx,
    horizontalFovDeg,
    separationDeg,
    tapSeparationPx,
  };
}

export interface PointingErrorEstimate {
  /** Best single estimate, degrees. Never below 1°. */
  totalDeg: number;
  /** Lower/upper plausible bound, for honest display. */
  lowDeg: number;
  highDeg: number;
  compassAccuracyDeg: number | null;
  calibrationResidualDeg: number | null;
  label: string;
  detail: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function defaultCalibration(): CalibrationState {
  return {
    version: 1,
    headingOffsetDeg: 0,
    horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
    alignments: [],
    twoPointResidualDeg: null,
    twoPointFov: null,
  };
}

function signedDeg(value: number): number {
  const wrapped = normalizeDeg(value);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Validate persisted data; unknown/corrupt values fall back to defaults. */
export function sanitizeCalibration(raw: unknown): CalibrationState {
  const fallback = defaultCalibration();
  if (!raw || typeof raw !== 'object') return fallback;
  const value = raw as Partial<CalibrationState>;
  const offset = Number(value.headingOffsetDeg);
  const fov = Number(value.horizontalFovDeg);
  const alignments: AlignmentSample[] = [];
  if (Array.isArray(value.alignments)) {
    for (const item of value.alignments.slice(-8)) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Partial<AlignmentSample>;
      if (
        typeof a.targetId !== 'string' ||
        typeof a.targetName !== 'string' ||
        !Number.isFinite(a.targetAzDeg) ||
        !Number.isFinite(a.measuredHeadingDeg) ||
        !Number.isFinite(a.impliedOffsetDeg)
      ) {
        continue;
      }
      alignments.push({
        targetId: a.targetId,
        targetName: a.targetName,
        targetAzDeg: normalizeDeg(a.targetAzDeg as number),
        measuredHeadingDeg: normalizeDeg(a.measuredHeadingDeg as number),
        impliedOffsetDeg: signedDeg(a.impliedOffsetDeg as number),
        atMs: Number.isFinite(a.atMs) ? (a.atMs as number) : 0,
      });
    }
  }
  const residual = Number(value.twoPointResidualDeg);
  let twoPointFov: FovCalibration | null = null;
  if (value.twoPointFov && typeof value.twoPointFov === 'object') {
    const f = value.twoPointFov as Partial<FovCalibration>;
    const solvedFov = Number(f.horizontalFovDeg);
    if (
      Number.isFinite(solvedFov) &&
      solvedFov >= MIN_HORIZONTAL_FOV_DEG &&
      solvedFov <= MAX_HORIZONTAL_FOV_DEG &&
      Number.isFinite(f.separationDeg) &&
      Number.isFinite(f.residualPx) &&
      Number.isFinite(f.residualDeg) &&
      typeof f.targetAId === 'string' &&
      typeof f.targetAName === 'string' &&
      typeof f.targetBId === 'string' &&
      typeof f.targetBName === 'string'
    ) {
      twoPointFov = {
        horizontalFovDeg: solvedFov,
        separationDeg: Number(f.separationDeg),
        residualPx: Math.max(0, Number(f.residualPx)),
        residualDeg: Math.max(0, Number(f.residualDeg)),
        targetAId: f.targetAId,
        targetAName: f.targetAName,
        targetBId: f.targetBId,
        targetBName: f.targetBName,
        atMs: Number.isFinite(f.atMs) ? Number(f.atMs) : 0,
      };
    }
  }
  return {
    version: 1,
    headingOffsetDeg: Number.isFinite(offset) ? signedDeg(offset) : 0,
    horizontalFovDeg: Number.isFinite(fov)
      ? clamp(fov, MIN_HORIZONTAL_FOV_DEG, MAX_HORIZONTAL_FOV_DEG)
      : DEFAULT_HORIZONTAL_FOV_DEG,
    alignments,
    twoPointResidualDeg:
      Number.isFinite(residual) && residual >= 0 ? Math.min(45, residual) : null,
    twoPointFov,
  };
}

export function loadCalibration(storage?: StorageLike | null): CalibrationState {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!store) return defaultCalibration();
  try {
    const raw = store.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return defaultCalibration();
    return sanitizeCalibration(JSON.parse(raw));
  } catch {
    return defaultCalibration();
  }
}

export function saveCalibration(
  state: CalibrationState,
  storage?: StorageLike | null,
): boolean {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!store) return false;
  try {
    store.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function setHeadingOffset(
  state: CalibrationState,
  offsetDeg: number,
): CalibrationState {
  return {
    ...state,
    headingOffsetDeg: signedDeg(Number.isFinite(offsetDeg) ? offsetDeg : 0),
    twoPointResidualDeg: null,
  };
}

export function nudgeHeadingOffset(
  state: CalibrationState,
  deltaDeg: number,
): CalibrationState {
  return setHeadingOffset(state, state.headingOffsetDeg + deltaDeg);
}

export function setHorizontalFov(
  state: CalibrationState,
  fovDeg: number,
): CalibrationState {
  return {
    ...state,
    horizontalFovDeg: Number.isFinite(fovDeg)
      ? clamp(fovDeg, MIN_HORIZONTAL_FOV_DEG, MAX_HORIZONTAL_FOV_DEG)
      : DEFAULT_HORIZONTAL_FOV_DEG,
    twoPointFov: null,
  };
}

/** Apply a solved two-target FOV result and keep its provenance/residual. */
export function recordFovCalibration(
  state: CalibrationState,
  fov: FovCalibration,
): CalibrationState {
  return {
    ...state,
    horizontalFovDeg: clamp(
      fov.horizontalFovDeg,
      MIN_HORIZONTAL_FOV_DEG,
      MAX_HORIZONTAL_FOV_DEG,
    ),
    twoPointFov: fov,
  };
}

/** Offset that makes `measuredHeadingDeg` point at `targetAzDeg`. */
export function alignmentOffsetDeg(
  targetAzDeg: number,
  measuredHeadingDeg: number,
): number {
  return signedDeg(shortestAngleDeg(measuredHeadingDeg, targetAzDeg));
}

function circularMeanDeg(a: number, b: number): number {
  const x = Math.cos(a * (Math.PI / 180)) + Math.cos(b * (Math.PI / 180));
  const y = Math.sin(a * (Math.PI / 180)) + Math.sin(b * (Math.PI / 180));
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return a;
  return Math.atan2(y, x) * (180 / Math.PI);
}

/** One-tap alignment: centre the overlay on the chosen target immediately. */
export function recordAlignment(
  state: CalibrationState,
  input: CalibrationInput,
): CalibrationState {
  const impliedOffsetDeg = alignmentOffsetDeg(input.targetAzDeg, input.measuredHeadingDeg);
  const sample: AlignmentSample = {
    targetId: input.targetId,
    targetName: input.targetName,
    targetAzDeg: normalizeDeg(input.targetAzDeg),
    measuredHeadingDeg: normalizeDeg(input.measuredHeadingDeg),
    impliedOffsetDeg,
    atMs: input.atMs,
  };
  return {
    ...state,
    headingOffsetDeg: impliedOffsetDeg,
    alignments: [...state.alignments, sample].slice(-8),
    twoPointResidualDeg: null,
  };
}

/**
 * Two-point alignment. Each mark implies an offset; compass errors that vary
 * with heading show up as disagreement. The mean is applied and half the
 * disagreement is reported as a residual, not hidden.
 */
export function twoPointAlignment(
  a: Pick<CalibrationInput, 'targetAzDeg' | 'measuredHeadingDeg'>,
  b: Pick<CalibrationInput, 'targetAzDeg' | 'measuredHeadingDeg'>,
): TwoPointResult {
  const offsetA = alignmentOffsetDeg(a.targetAzDeg, a.measuredHeadingDeg);
  const offsetB = alignmentOffsetDeg(b.targetAzDeg, b.measuredHeadingDeg);
  const disagreement = Math.abs(shortestAngleDeg(offsetA, offsetB));
  return {
    headingOffsetDeg: signedDeg(circularMeanDeg(offsetA, offsetB)),
    residualDeg: disagreement / 2,
  };
}

export function recordTwoPointAlignment(
  state: CalibrationState,
  a: CalibrationInput,
  b: CalibrationInput,
): CalibrationState {
  const result = twoPointAlignment(a, b);
  const sample = (input: CalibrationInput): AlignmentSample => ({
    targetId: input.targetId,
    targetName: input.targetName,
    targetAzDeg: normalizeDeg(input.targetAzDeg),
    measuredHeadingDeg: normalizeDeg(input.measuredHeadingDeg),
    impliedOffsetDeg: alignmentOffsetDeg(input.targetAzDeg, input.measuredHeadingDeg),
    atMs: input.atMs,
  });
  return {
    ...state,
    headingOffsetDeg: result.headingOffsetDeg,
    twoPointResidualDeg: result.residualDeg,
    alignments: [...state.alignments, sample(a), sample(b)].slice(-8),
  };
}

/** Latest disagreement between any two stored alignment offsets. */
export function alignmentSpreadDeg(state: CalibrationState): number | null {
  const offsets = state.alignments.map((a) => a.impliedOffsetDeg);
  if (offsets.length < 2) return null;
  let maxSpread = 0;
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      maxSpread = Math.max(maxSpread, Math.abs(shortestAngleDeg(offsets[i], offsets[j])));
    }
  }
  return maxSpread;
}

export function estimatePointingError(
  state: CalibrationState,
  reportedCompassAccuracyDeg: number | null,
): PointingErrorEstimate {
  const compassAccuracy =
    reportedCompassAccuracyDeg !== null &&
    Number.isFinite(reportedCompassAccuracyDeg) &&
    reportedCompassAccuracyDeg > 0
      ? reportedCompassAccuracyDeg
      : null;

  let calibrationResidual: number | null = state.twoPointResidualDeg;
  if (calibrationResidual === null) {
    const spread = alignmentSpreadDeg(state);
    calibrationResidual = spread === null ? null : spread / 2;
  }

  const compassFloor = compassAccuracy ?? 12;
  const total = Math.max(1, compassFloor, calibrationResidual ?? 0);
  const low = Math.max(1, Math.min(total, compassAccuracy === null ? 5 : total * 0.6));
  const high = Math.max(total, compassAccuracy === null ? 15 : total);
  const detailParts: string[] = [];
  detailParts.push(
    compassAccuracy === null
      ? 'device compass accuracy not reported; 5–15° is typical (a 2026 iPhone field test saw ±14–16°)'
      : `device compass ±${compassAccuracy.toFixed(1)}°`,
  );
  if (calibrationResidual !== null && calibrationResidual > 0.05) {
    detailParts.push(`alignment residual ±${calibrationResidual.toFixed(1)}°`);
  }
  return {
    totalDeg: total,
    lowDeg: low,
    highDeg: high,
    compassAccuracyDeg: compassAccuracy,
    calibrationResidualDeg: calibrationResidual,
    label: `±${total.toFixed(total < 10 ? 1 : 0)}° estimated pointing error`,
    detail: `${detailParts.join(' · ')}. A phone compass is not an arcsecond instrument; treat the overlay as a finder, not a measurement.`,
  };
}
