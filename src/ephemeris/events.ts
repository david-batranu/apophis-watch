import {
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
  type AstroTime,
} from 'astronomy-engine';
import {
  dateFromJdTdb,
  jdTdbFromDate,
  SEC_PER_DAY,
  astroTimeFromJdTdb,
} from '../core/time';
import { norm, scale } from '../core/vec3';
import { eqjToEcef } from './frames';
import {
  apparentHorizontalAtJd,
  computeTopocentric,
  horizontalSeparationDeg,
} from './topocentric';
import type {
  ClosestApproach,
  EphemerisProvider,
  MoonInfo,
  ObserverLocation,
  TopocentricClosestApproach,
  VisibilityInterval,
  VisibilityResult,
} from './types';
import { ecefToGeodetic, ellipsoidRadiusAlong } from './wgs84';

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** Minimise a smooth scalar function on [a,b] by golden-section search. */
function goldenMin(f: (x: number) => number, a: number, b: number, iterations = 90): number {
  let lo = a;
  let hi = b;
  let c = hi - GOLDEN * (hi - lo);
  let d = lo + GOLDEN * (hi - lo);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < iterations; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - GOLDEN * (hi - lo);
      fc = f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + GOLDEN * (hi - lo);
      fd = f(d);
    }
  }
  return (lo + hi) / 2;
}

export const geocentricRangeKm = (ephem: EphemerisProvider, jdTdb: number): number =>
  norm(ephem.stateAtJdTdb(jdTdb).positionKm);

interface SurfaceGeometry {
  distanceFromCentreKm: number;
  surfaceRadiusKm: number;
  surfaceDistanceKm: number;
  subPointLatDeg: number;
  subPointLonDeg: number;
}

/**
 * Geocentric position at jdTdb -> radial intersection with WGS84.
 *
 * The state vector is ICRF/J2000, while the ellipsoid lives in Earth-fixed
 * axes. The rotation is mandatory: without it the sub-point longitude is
 * simply right ascension and is wrong by the full GAST angle (~168 degrees
 * at the 2029 flyby).
 */
export function surfaceGeometryAtJd(
  ephem: EphemerisProvider,
  jdTdb: number,
): SurfaceGeometry {
  const position = ephem.stateAtJdTdb(jdTdb).positionKm;
  const time = astroTimeFromJdTdb(jdTdb);
  const ecef = eqjToEcef(position, time);
  const distance = norm(ecef);
  const direction = scale(ecef, 1 / distance);
  const surfaceRadius = ellipsoidRadiusAlong(direction);
  const subPoint = ecefToGeodetic(scale(direction, surfaceRadius));
  return {
    distanceFromCentreKm: distance,
    surfaceRadiusKm: surfaceRadius,
    surfaceDistanceKm: distance - surfaceRadius,
    subPointLatDeg: subPoint.latitudeDeg,
    subPointLonDeg: subPoint.longitudeDeg,
  };
}

/**
 * Radial distance above the WGS84 ellipsoid along the geocentric direction.
 * This is the "distance from the surface" quoted for the flyby.
 */
export const surfaceDistanceKm = (ephem: EphemerisProvider, jdTdb: number): number =>
  surfaceGeometryAtJd(ephem, jdTdb).surfaceDistanceKm;

/**
 * Per-observer closest approach: the instant of minimum apparent range.
 * This is the time the UI should jump to; it can differ from the geocentric
 * value by seconds because the observer rides on Earth's surface.
 */
export function findTopocentricClosestApproach(
  ephem: EphemerisProvider,
  location: ObserverLocation,
): TopocentricClosestApproach {
  const rangeAt = (jd: number) =>
    apparentHorizontalAtJd(ephem, location, jd).rangeKm;
  const stepDays = 60 / SEC_PER_DAY;
  // Keep a five-minute margin: light-time backdates the state query, and
  // the table intentionally has only a few minutes of slack at each end.
  const margin = 5 / SEC_PER_DAY;
  let bestJd = ephem.startJdTdb + margin;
  let best = Infinity;
  for (let jd = ephem.startJdTdb + margin; jd <= ephem.endJdTdb - margin; jd += stepDays) {
    const r = rangeAt(jd);
    if (r < best) {
      best = r;
      bestJd = jd;
    }
  }
  const refined = goldenMin(rangeAt, bestJd - stepDays, bestJd + stepDays);
  const sky = apparentHorizontalAtJd(ephem, location, refined);
  return {
    jdTdb: refined,
    utc: dateFromJdTdb(refined),
    rangeKm: sky.rangeKm,
    azimuthDeg: sky.azimuthDeg,
    elevationDeg: sky.elevationDeg,
  };
}

export function findClosestApproach(ephem: EphemerisProvider): ClosestApproach {
  // Coarse scan at 1-minute resolution, then refine the bracket.
  const stepDays = 60 / SEC_PER_DAY;
  let bestJd = ephem.startJdTdb;
  let best = Infinity;
  for (let jd = ephem.startJdTdb; jd <= ephem.endJdTdb; jd += stepDays) {
    const r = geocentricRangeKm(ephem, jd);
    if (r < best) {
      best = r;
      bestJd = jd;
    }
  }
  const caJd = goldenMin(
    (jd) => geocentricRangeKm(ephem, jd),
    bestJd - stepDays,
    bestJd + stepDays,
  );
  const distance = geocentricRangeKm(ephem, caJd);

  // Minimise the surface distance separately: the local ellipsoid radius
  // varies with the sub-point latitude, so this instant can differ slightly.
  const surfaceJd = goldenMin(
    (jd) => surfaceDistanceKm(ephem, jd),
    caJd - 10 / 1440,
    caJd + 10 / 1440,
  );
  const surface = surfaceGeometryAtJd(ephem, surfaceJd);

  return {
    jdTdb: caJd,
    utc: dateFromJdTdb(caJd),
    geocentricDistanceKm: distance,
    surfaceDistanceKm: surface.surfaceDistanceKm,
    surfaceRadiusKm: surface.surfaceRadiusKm,
    surfaceJdTdb: surfaceJd,
    surfaceUtc: dateFromJdTdb(surfaceJd),
    subPointLatDeg: surface.subPointLatDeg,
    subPointLonDeg: surface.subPointLonDeg,
  };
}

function bodyHorizontal(
  body: Body,
  time: AstroTime,
  location: ObserverLocation,
): { azimuthDeg: number; elevationDeg: number } {
  const observer = new Observer(location.latitudeDeg, location.longitudeDeg, location.elevationM);
  const eq = Equator(body, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec, undefined);
  return { azimuthDeg: hor.azimuth, elevationDeg: hor.altitude };
}

/** Sun altitude in degrees (airless, topocentric). */
export function sunAltitudeDeg(location: ObserverLocation, jdTdb: number): number {
  return bodyHorizontal(Body.Sun, astroTimeFromJdTdb(jdTdb), location).elevationDeg;
}

export interface VisibilityOptions {
  startJdTdb: number;
  endJdTdb: number;
  /** Integration step; 60 s is ample compared with the 1-minute UI ticks. */
  stepSeconds?: number;
  /** Sun must be below this altitude for a "visible" interval. */
  sunAltitudeMaxDeg?: number;
}

function isVisibleAt(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  jdTdb: number,
  sunMax: number,
): { visible: boolean; elevationDeg: number; sunDeg: number } {
  const sky = apparentHorizontalAtJd(ephem, location, jdTdb);
  const sunDeg = sunAltitudeDeg(location, jdTdb);
  return {
    visible: sky.geometricElevationDeg > 0 && sunDeg < sunMax,
    elevationDeg: sky.geometricElevationDeg,
    sunDeg,
  };
}

/** Bisect a visibility transition to sub-second precision. */
function refineTransition(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  jdVisible: number,
  jdHidden: number,
  sunMax: number,
): number {
  let v = jdVisible;
  let h = jdHidden;
  for (let i = 0; i < 45; i++) {
    const mid = (v + h) / 2;
    if (isVisibleAt(ephem, location, mid, sunMax).visible) v = mid;
    else h = mid;
  }
  return (v + h) / 2;
}

export function computeVisibility(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  caJdTdb: number,
  options: VisibilityOptions,
): VisibilityResult {
  const step = (options.stepSeconds ?? 60) / SEC_PER_DAY;
  const sunMax = options.sunAltitudeMaxDeg ?? -6;
  const { startJdTdb, endJdTdb } = options;

  const samples: { jd: number; visible: boolean; elevation: number; sun: number }[] = [];
  for (let jd = startJdTdb; jd <= endJdTdb; jd += step) {
    const s = isVisibleAt(ephem, location, jd, sunMax);
    samples.push({ jd, visible: s.visible, elevation: s.elevationDeg, sun: s.sunDeg });
  }
  // Ensure the endpoint is included even if the loop overshoots.
  if (samples[samples.length - 1].jd < endJdTdb) {
    const s = isVisibleAt(ephem, location, endJdTdb, sunMax);
    samples.push({
      jd: endJdTdb,
      visible: s.visible,
      elevation: s.elevationDeg,
      sun: s.sunDeg,
    });
  }

  const intervals: VisibilityInterval[] = [];
  let maxElevationDeg = -90;
  let maxElevationJd: number | null = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.visible) {
      if (s.elevation > maxElevationDeg) {
        maxElevationDeg = s.elevation;
        maxElevationJd = s.jd;
      }
      const startOfInterval =
        i === 0 || !samples[i - 1].visible
          ? i === 0
            ? s.jd
            : refineTransition(ephem, location, s.jd, samples[i - 1].jd, sunMax)
          : null;
      const endOfInterval =
        i === samples.length - 1 || !samples[i + 1].visible
          ? i === samples.length - 1
            ? s.jd
            : refineTransition(ephem, location, s.jd, samples[i + 1].jd, sunMax)
          : null;
      if (startOfInterval !== null) {
        intervals.push({
          startJdTdb: startOfInterval,
          endJdTdb: 0,
          startUtc: dateFromJdTdb(startOfInterval),
          endUtc: new Date(0),
        });
      }
      if (endOfInterval !== null && intervals.length > 0) {
        const current = intervals[intervals.length - 1];
        current.endJdTdb = endOfInterval;
        current.endUtc = dateFromJdTdb(endOfInterval);
      }
    }
  }

  // Moon info at the middle of the longest interval, else at CA.
  let refJd = caJdTdb;
  if (intervals.length > 0) {
    const longest = intervals.reduce((a, b) =>
      b.endJdTdb - b.startJdTdb > a.endJdTdb - a.startJdTdb ? b : a,
    );
    refJd = (longest.startJdTdb + longest.endJdTdb) / 2;
  }
  const time = astroTimeFromJdTdb(refJd);
  const moonHor = bodyHorizontal(Body.Moon, time, location);
  const apophis = computeTopocentric(ephem, location, dateFromJdTdb(refJd));
  const illumination = Illumination(Body.Moon, time);
  const moon: MoonInfo = {
    jdTdb: refJd,
    utc: dateFromJdTdb(refJd),
    azimuthDeg: moonHor.azimuthDeg,
    elevationDeg: moonHor.elevationDeg,
    illuminationFraction: illumination.phase_fraction,
    phaseAngleDeg: illumination.phase_angle,
    separationDeg: horizontalSeparationDeg(
      moonHor.azimuthDeg,
      moonHor.elevationDeg,
      apophis.azimuthDeg,
      apophis.elevationDeg,
    ),
  };

  let reason = '';
  if (intervals.length === 0) {
    const anyAbove = samples.some((s) => s.elevation > 0);
    const anyDark = samples.some((s) => s.sun < sunMax);
    if (!anyAbove) {
      reason = 'Apophis stays below the horizon for the whole window.';
    } else if (!anyDark) {
      reason = `The Sun never drops below ${sunMax}°, so there is no dark-sky window.`;
    } else {
      reason = 'No overlap between Apophis above the horizon and astronomical darkness.';
    }
  }

  return {
    intervals,
    maxElevationDeg: maxElevationDeg === -90 ? -90 : maxElevationDeg,
    maxElevationUtc: maxElevationJd === null ? null : dateFromJdTdb(maxElevationJd),
    moon,
    reason,
  };
}

/** Local altitude events for jump buttons (rise, set, transit). */
export interface AltitudeEvents {
  riseJdTdb: number | null;
  setJdTdb: number | null;
  transitJdTdb: number | null;
  maxElevationDeg: number;
}

export function findAltitudeEvents(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  startJdTdb: number,
  endJdTdb: number,
  stepSeconds = 30,
  referenceJdTdb?: number,
): AltitudeEvents {
  const step = stepSeconds / SEC_PER_DAY;
  const rises: number[] = [];
  const sets: number[] = [];
  let transit: number | null = null;
  let maxEl = -90;
  const reference = referenceJdTdb ?? (startJdTdb + endJdTdb) / 2;
  const transitWindowDays = 6 / 24;
  let prev = apparentHorizontalAtJd(ephem, location, startJdTdb);
  for (let jd = startJdTdb + step; jd <= endJdTdb; jd += step) {
    const cur = apparentHorizontalAtJd(ephem, location, jd);
    if (prev.geometricElevationDeg <= 0 && cur.geometricElevationDeg > 0) {
      rises.push(refineAltitudeCrossing(ephem, location, jd, jd - step));
    } else if (prev.geometricElevationDeg > 0 && cur.geometricElevationDeg <= 0) {
      sets.push(refineAltitudeCrossing(ephem, location, jd, jd - step));
    }
    if (
      Math.abs(jd - reference) <= transitWindowDays &&
      cur.geometricElevationDeg > maxEl
    ) {
      maxEl = cur.geometricElevationDeg;
      transit = jd;
    }
    prev = cur;
  }
  // The event pass containing the transit: last rise before it, first set
  // after it. A ±12 h window can include an adjacent pass; do not confuse them.
  const rise = transit === null ? null : (rises.filter((x) => x < transit).at(-1) ?? null);
  const set = transit === null ? null : (sets.find((x) => x > transit) ?? null);
  return { riseJdTdb: rise, setJdTdb: set, transitJdTdb: transit, maxElevationDeg: maxEl };
}

function refineAltitudeCrossing(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  jdAbove: number,
  jdBelow: number,
): number {
  let a = jdAbove;
  let b = jdBelow;
  const aboveAtA = altitudeAt(ephem, location, a) > 0;
  for (let i = 0; i < 45; i++) {
    const mid = (a + b) / 2;
    if (altitudeAt(ephem, location, mid) > 0 === aboveAtA) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

function altitudeAt(ephem: EphemerisProvider, location: ObserverLocation, jd: number): number {
  return apparentHorizontalAtJd(ephem, location, jd).geometricElevationDeg;
}

export function utcFromJd(jd: number): Date {
  return dateFromJdTdb(jd);
}

export function jdFromUtc(date: Date): number {
  return jdTdbFromDate(date);
}
