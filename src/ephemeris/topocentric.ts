import {
  Body,
  C_AUDAY,
  HelioState,
  KM_PER_AU,
  Observer,
  ObserverState,
  type AstroTime,
} from 'astronomy-engine';
import { SEC_PER_DAY, astroTimeFromJdTdb, jdTdbFromDate } from '../core/time';
import {
  add,
  angleBetweenRad,
  clamp,
  DEG,
  dot,
  normalize,
  norm,
  RAD,
  scale,
  sub,
  vec3,
  type Vec3,
} from '../core/vec3';
import { ecefToEqj, eqjToEcef } from './frames';
import { hgMagnitude } from './magnitude';
import { refractedElevationDeg } from './refraction';
import type {
  EphemerisProvider,
  ObserverLocation,
  ObserverState as ObserverStateSnapshot,
  SkyPosition,
} from './types';
import { ecefToEnu, geodeticToEcef } from './wgs84';

/** Speed of light, km/s (IAU 2009). */
export const C_KM_S = 299_792.458;

export interface TopocentricOptions {
  /** Apply Bennett atmospheric refraction to the displayed elevation. */
  refraction?: boolean;
  /** Apply annual+diurnal aberration. Default true (matches Horizons apparent). */
  aberration?: boolean;
}

interface Geometry {
  jdTdb: number;
  time: AstroTime;
  state: ReturnType<EphemerisProvider['stateAtJdTdb']>;
  observerEcefKm: Vec3;
  observerEqjKm: Vec3;
  directionEqj: Vec3;
  azimuthDeg: number;
  geometricElevationDeg: number;
  rangeKm: number;
  heliocentricDistanceAu: number;
  observerDistanceAu: number;
  phaseAngleDeg: number;
}

/**
 * Observer's geocentric position in ICRF axes, using our WGS84 implementation.
 * Exposed separately so it can be tested against astronomy-engine.
 */
export function observerSnapshot(
  location: ObserverLocation,
  jdTdb: number,
): ObserverStateSnapshot {
  const time = astroTimeFromJdTdb(jdTdb);
  const ecefKm = geodeticToEcef(location);
  const eciKm = ecefToEqj(ecefKm, time);
  return { location, jdTdb, ecefKm, eciKm };
}

function geometryAt(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  jdTdb: number,
  options: Required<TopocentricOptions>,
): Geometry {
  const time = astroTimeFromJdTdb(jdTdb);
  const observerEcefKm = geodeticToEcef(location);
  const observerEqjKm = ecefToEqj(observerEcefKm, time);
  const earth = HelioState(Body.Earth, time);

  // Light-time iteration: find where Apophis was when the light we receive
  // at jdTdb left it. Two iterations converge to <1 mm here.
  let tauDays = 0;
  let state = ephem.stateAtJdTdb(jdTdb);
  for (let i = 0; i < 3; i++) {
    state = ephem.stateAtJdTdb(jdTdb - tauDays);
    tauDays = norm(sub(state.positionKm, observerEqjKm)) / C_KM_S / SEC_PER_DAY;
  }

  // The geocentric table is relative to Earth's centre at the tabulated
  // time. The photon left at t-tau, when Earth's centre was displaced by
  // v_earth*tau (~3.5 km near closest approach), so correct for that.
  // Omitting this is a ~20 arcsec direction error and a ~3 km range error.
  const earthVelocityKmS = scale(
    vec3(earth.vx, earth.vy, earth.vz),
    KM_PER_AU / SEC_PER_DAY,
  );
  const relativeKm = sub(
    sub(state.positionKm, observerEqjKm),
    scale(earthVelocityKmS, tauDays * SEC_PER_DAY),
  );
  const rangeKm = norm(relativeKm);
  let directionEqj = normalize(relativeKm);

  if (options.aberration) {
    // Observer velocity = Earth's heliocentric VELOCITY + geocentric
    // rotational velocity. Both are EQJ, au/day.
    const obs = ObserverState(
      time,
      new Observer(location.latitudeDeg, location.longitudeDeg, location.elevationM),
      false,
    );
    const velocityAuDay = vec3(earth.vx + obs.vx, earth.vy + obs.vy, earth.vz + obs.vz);
    const beta = scale(velocityAuDay, 1 / C_AUDAY);
    // First-order relativistic aberration; the neglected O(beta^2) term is
    // ~0.002 arcsec, far below the 1 arcmin validation budget.
    directionEqj = normalize(
      add(sub(directionEqj, scale(directionEqj, dot(directionEqj, beta))), beta),
    );
  }

  const directionEcef = eqjToEcef(directionEqj, time);
  const enu = ecefToEnu(directionEcef, location.latitudeDeg, location.longitudeDeg);
  const azimuthDeg = (Math.atan2(enu.x, enu.y) * RAD + 360) % 360;
  const geometricElevationDeg = Math.asin(clamp(enu.z / norm(enu), -1, 1)) * RAD;

  // H-G magnitude inputs.
  const aphelioKm = add(
    state.positionKm,
    scale(vec3(earth.x, earth.y, earth.z), KM_PER_AU),
  );
  const phaseAngleDeg =
    angleBetweenRad(scale(aphelioKm, -1), sub(observerEqjKm, state.positionKm)) * RAD;

  return {
    jdTdb,
    time,
    state,
    observerEcefKm,
    observerEqjKm,
    directionEqj,
    azimuthDeg,
    geometricElevationDeg,
    rangeKm,
    heliocentricDistanceAu: norm(aphelioKm) / KM_PER_AU,
    observerDistanceAu: rangeKm / KM_PER_AU,
    phaseAngleDeg,
  };
}

/** Lightweight apparent horizontal position (no rates or photometry). */
export interface ApparentHorizontal {
  jdTdb: number;
  azimuthDeg: number;
  elevationDeg: number;
  geometricElevationDeg: number;
  rangeKm: number;
}

export function apparentHorizontalAtJd(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  jdTdb: number,
  options: TopocentricOptions = {},
): ApparentHorizontal {
  const opts: Required<TopocentricOptions> = {
    refraction: options.refraction ?? false,
    aberration: options.aberration ?? true,
  };
  const g = geometryAt(ephem, location, jdTdb, opts);
  const elevationDeg =
    opts.refraction && g.geometricElevationDeg > -2
      ? refractedElevationDeg(g.geometricElevationDeg)
      : g.geometricElevationDeg;
  return {
    jdTdb,
    azimuthDeg: g.azimuthDeg,
    elevationDeg,
    geometricElevationDeg: g.geometricElevationDeg,
    rangeKm: g.rangeKm,
  };
}

export function computeApparentHorizontal(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  date: Date,
  options: TopocentricOptions = {},
): ApparentHorizontal {
  return apparentHorizontalAtJd(ephem, location, jdTdbFromDate(date), options);
}

/**
 * Topocentric az/el, range, rates, angular size and H-G magnitude estimate.
 * Azimuth is clockwise from true north; elevations are airless unless
 * `refraction` is explicitly enabled.
 */
export function computeTopocentric(
  ephem: EphemerisProvider,
  location: ObserverLocation,
  date: Date,
  options: TopocentricOptions = {},
): SkyPosition {
  const opts: Required<TopocentricOptions> = {
    refraction: options.refraction ?? false,
    aberration: options.aberration ?? true,
  };
  const jdTdb = jdTdbFromDate(date);
  const g = geometryAt(ephem, location, jdTdb, opts);

  // Numerical rates over a short symmetric baseline. The direction function
  // includes light-time and aberration, so this is the true apparent rate.
  const dtSec = 5;
  const before = geometryAt(ephem, location, jdTdb - dtSec / SEC_PER_DAY, opts);
  const after = geometryAt(ephem, location, jdTdb + dtSec / SEC_PER_DAY, opts);
  // Rate measured in the local horizontal frame, so it matches the motion
  // drawn on the sky dome (it includes the observer's diurnal rotation).
  const angularRateDegPerMin =
    horizontalSeparationDeg(
      before.azimuthDeg,
      before.geometricElevationDeg,
      after.azimuthDeg,
      after.geometricElevationDeg,
    ) /
    (2 * dtSec / 60);
  const rangeRateKmS = (after.rangeKm - before.rangeKm) / (2 * dtSec);

  const displayedElevation =
    opts.refraction && g.geometricElevationDeg > -2
      ? refractedElevationDeg(g.geometricElevationDeg)
      : g.geometricElevationDeg;

  return {
    utc: date,
    jdTdb,
    azimuthDeg: g.azimuthDeg,
    elevationDeg: displayedElevation,
    geometricElevationDeg: g.geometricElevationDeg,
    refracted: opts.refraction && displayedElevation !== g.geometricElevationDeg,
    rangeKm: g.rangeKm,
    rangeRateKmS,
    angularRateDegPerMin,
    angularDiameterArcsec: (2 * ephem.targetRadiusKm * RAD * 3600) / g.rangeKm,
    magnitude: hgMagnitude(
      ephem.absoluteMagnitudeH,
      ephem.slopeG,
      g.phaseAngleDeg,
      g.heliocentricDistanceAu,
      g.observerDistanceAu,
    ),
    heliocentricDistanceAu: g.heliocentricDistanceAu,
    observerDistanceAu: g.observerDistanceAu,
    phaseAngleDeg: g.phaseAngleDeg,
  };
}

/** Angular separation between two horizontal coordinates, degrees. */
export function horizontalSeparationDeg(
  az1Deg: number,
  el1Deg: number,
  az2Deg: number,
  el2Deg: number,
): number {
  const el1 = el1Deg * DEG;
  const el2 = el2Deg * DEG;
  const dAz = (az1Deg - az2Deg) * DEG;
  const cosSep =
    Math.sin(el1) * Math.sin(el2) + Math.cos(el1) * Math.cos(el2) * Math.cos(dAz);
  return Math.acos(clamp(cosSep, -1, 1)) * RAD;
}
