/**
 * Apophis path for the terrain search area.
 *
 * The physical visibility window comes from Phase 1 (`SimulationSession`), and
 * the az/el samples use the frozen Phase 1 topocentric routine. The path is
 * computed ONCE at the search centre; candidates within the search area reuse
 * it. Over 5 km the parallax difference is only ~27–30″, far below the 1°
 * horizon grid and the ranking sensitivity.
 */

import { jdTdbFromDate } from '../core/time';
import { apparentHorizontalAtJd } from '../ephemeris/topocentric';
import type { ObserverLocation } from '../ephemeris/types';
import type { SimulationSession } from '../state/session';
import { parallaxArcsec } from './geo';
import type {
  ApophisPathInfo,
  ApophisPathSample,
  ParallaxReport,
  PathSector,
} from './types';

export interface BuildPathOptions {
  /** Sample spacing inside the physical visibility interval, seconds. */
  stepSeconds?: number;
  /** Baseline used for the reported parallax check, km. */
  parallaxBaselineKm?: number;
}

/** Stable key for the observer whose path/topocentric frame is in use. */
export function observerKey(observer: ObserverLocation): string {
  return `${observer.latitudeDeg.toFixed(6)},${observer.longitudeDeg.toFixed(
    6,
  )},${observer.elevationM.toFixed(1)}`;
}

/** Summarise a path including the azimuth sector, handling north wrap. */
export function summarizePath(
  samples: ApophisPathSample[],
): PathSector {
  if (samples.length === 0) {
    return {
      minAzimuthDeg: 0,
      maxAzimuthDeg: 0,
      spanDeg: 0,
      minElevationDeg: 0,
      maxElevationDeg: 0,
      wrapsNorth: false,
    };
  }
  let previous = samples[0].azimuthDeg;
  let unwrappedMin = previous;
  let unwrappedMax = previous;
  let minElevationDeg = samples[0].elevationDeg;
  let maxElevationDeg = samples[0].elevationDeg;
  for (let i = 1; i < samples.length; i++) {
    let az = samples[i].azimuthDeg;
    while (az - previous > 180) az -= 360;
    while (az - previous < -180) az += 360;
    previous = az;
    unwrappedMin = Math.min(unwrappedMin, az);
    unwrappedMax = Math.max(unwrappedMax, az);
    minElevationDeg = Math.min(minElevationDeg, samples[i].elevationDeg);
    maxElevationDeg = Math.max(maxElevationDeg, samples[i].elevationDeg);
  }
  const minAzimuthDeg = ((unwrappedMin % 360) + 360) % 360;
  const maxAzimuthDeg = ((unwrappedMax % 360) + 360) % 360;
  return {
    minAzimuthDeg,
    maxAzimuthDeg,
    spanDeg: unwrappedMax - unwrappedMin,
    minElevationDeg,
    maxElevationDeg,
    wrapsNorth: unwrappedMax - unwrappedMin < 360 && maxAzimuthDeg < minAzimuthDeg,
  };
}

/** Compute the once-per-area Apophis path from the Phase 1 session. */
export function buildApophisPath(
  session: SimulationSession,
  options: BuildPathOptions = {},
): ApophisPathInfo {
  const stepSeconds = Math.max(5, options.stepSeconds ?? 30);
  const stepMs = stepSeconds * 1000;
  const samples: ApophisPathSample[] = [];
  let lastMs = Number.NEGATIVE_INFINITY;
  // The ±24 h data window can contain the previous/next night's pass. The
  // physical window we score is the one containing (or nearest) the
  // topocentric closest approach, exactly as the Phase 2 jump uses it.
  const interval = session.visibleIntervalForJump();
  const intervals = interval ? [interval] : [];
  for (const interval of intervals) {
    const start = interval.startUtc.getTime();
    const end = interval.endUtc.getTime();
    for (let ms = start; ms < end; ms += stepMs) {
      if (ms <= lastMs) continue;
      lastMs = ms;
      samples.push(sampleAt(session, ms));
    }
    if (end > lastMs) {
      lastMs = end;
      samples.push(sampleAt(session, end));
    }
  }
  if (samples.length === 0) {
    // Still record the topocentric CA direction for context, but do not
    // pretend there is a visibility window.
    samples.push(sampleAt(session, session.topocentricCa.utc.getTime()));
  }
  return buildPathInfo(session, samples, options);
}

function sampleAt(session: SimulationSession, utcMs: number): ApophisPathSample {
  const horizontal = apparentHorizontalAtJd(
    session.ephem,
    session.observer,
    jdTdbFromDate(new Date(utcMs)),
  );
  return {
    utcMs,
    azimuthDeg: horizontal.azimuthDeg,
    elevationDeg: horizontal.geometricElevationDeg,
    rangeKm: horizontal.rangeKm,
  };
}

function buildPathInfo(
  session: SimulationSession,
  samples: ApophisPathSample[],
  options: BuildPathOptions,
): ApophisPathInfo {
  const sector = summarizePath(samples);
  const baselineKm = options.parallaxBaselineKm ?? 5;
  const worst = samples.reduce(
    (best, sample) => (sample.rangeKm < best.rangeKm ? sample : best),
    samples[0],
  );
  const parallax: ParallaxReport = {
    baselineKm,
    rangeKm: worst.rangeKm,
    arcsec: parallaxArcsec(baselineKm, worst.rangeKm),
    utcMs: worst.utcMs,
    label: 'worst case along the visible path',
  };
  const caRange = session.geocentricCa.geocentricDistanceKm;
  const parallaxAtGeocentricCa: ParallaxReport = {
    baselineKm,
    rangeKm: caRange,
    arcsec: parallaxArcsec(baselineKm, caRange),
    utcMs: session.geocentricCa.utc.getTime(),
    label: 'at geocentric closest approach',
  };
  return {
    samples,
    sector,
    parallax,
    parallaxAtGeocentricCa,
    observerKey: observerKey(session.observer),
    generatedAt: Date.now(),
  };
}

/** Linear interpolation of the once-per-area path at an arbitrary UTC time. */
export function interpolatePathAt(
  samples: ApophisPathSample[],
  utcMs: number,
): ApophisPathSample | null {
  if (samples.length === 0) return null;
  const first = samples[0].utcMs;
  const last = samples[samples.length - 1].utcMs;
  // Outside the visible path window there is no Apophis marker to draw; do
  // not leave a stale marker at the last sample.
  if (utcMs < first - 60_000 || utcMs > last + 60_000) return null;
  if (utcMs <= first) return samples[0];
  if (utcMs >= last) return samples[samples.length - 1];
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].utcMs <= utcMs) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.utcMs - a.utcMs;
  const t = span <= 0 ? 0 : (utcMs - a.utcMs) / span;
  let deltaAz = b.azimuthDeg - a.azimuthDeg;
  while (deltaAz > 180) deltaAz -= 360;
  while (deltaAz < -180) deltaAz += 360;
  return {
    utcMs,
    azimuthDeg: ((a.azimuthDeg + deltaAz * t) % 360 + 360) % 360,
    elevationDeg: a.elevationDeg + (b.elevationDeg - a.elevationDeg) * t,
    rangeKm: a.rangeKm + (b.rangeKm - a.rangeKm) * t,
  };
}

/** Human-readable azimuth sector, e.g. "123.4° → 317.6° (SW→NW)". */
export function formatSector(sector: PathSector): string {
  if (sector.spanDeg === 0) return 'no above-horizon sector';
  const direction = sector.wrapsNorth ? 'crosses north' : 'clockwise';
  return `${sector.minAzimuthDeg.toFixed(1)}° → ${sector.maxAzimuthDeg.toFixed(
    1,
  )}° (${direction}, ${sector.spanDeg.toFixed(1)}°)`;
}

/** UTC HH:MM label used in result reasons. */
export function formatUtcHhMm(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')}`;
}
