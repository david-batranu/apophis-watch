import type { Vec3 } from '../core/vec3';

/** A geocentric state vector in the ICRF (J2000 equatorial) frame. */
export interface GeocentricState {
  /** Julian Date in Barycentric Dynamical Time (TDB). */
  jdTdb: number;
  /** Position relative to Earth's centre, km, ICRF axes. */
  positionKm: Vec3;
  /** Velocity relative to Earth's centre, km/s, ICRF axes. */
  velocityKmS: Vec3;
}

/** A point on the WGS84 ellipsoid. */
export interface ObserverLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: number;
}

/** Computed topocentric sky position of Apophis. */
export interface SkyPosition {
  /** UTC instant this position refers to. */
  utc: Date;
  jdTdb: number;
  azimuthDeg: number;
  elevationDeg: number;
  /** Geometric elevation before any refraction correction. */
  geometricElevationDeg: number;
  /** True if the displayed elevation includes refraction. */
  refracted: boolean;
  rangeKm: number;
  rangeRateKmS: number;
  /** Total angular speed on the sky, degrees per minute. */
  angularRateDegPerMin: number;
  angularDiameterArcsec: number;
  /** Apparent visual magnitude estimate (IAU H-G). */
  magnitude: number;
  /** Heliocentric distance, au. */
  heliocentricDistanceAu: number;
  /** Observer-centric distance, au. */
  observerDistanceAu: number;
  /** Sun-Apophis-observer phase angle, degrees. */
  phaseAngleDeg: number;
}

/** Observer state used by the UI and AR layers. */
export interface ObserverState {
  location: ObserverLocation;
  jdTdb: number;
  /** WGS84 Earth-fixed position, km. */
  ecefKm: Vec3;
  /** Geocentric ICRF position, km. */
  eciKm: Vec3;
}

/** Ephemeris provider contract; frozen after Phase 2. */
export interface EphemerisProvider {
  readonly startJdTdb: number;
  readonly endJdTdb: number;
  readonly stepSeconds: number;
  readonly targetRadiusKm: number;
  readonly absoluteMagnitudeH: number;
  readonly slopeG: number;
  stateAtJdTdb(jdTdb: number): GeocentricState;
  stateAtUtc(date: Date): GeocentricState;
}

export interface ClosestApproach {
  jdTdb: number;
  utc: Date;
  /** Distance from Earth's centre, km. */
  geocentricDistanceKm: number;
  /** Minimum radial distance above the WGS84 ellipsoid, km. */
  surfaceDistanceKm: number;
  /** WGS84 radius at the sub-point of that minimum, km. */
  surfaceRadiusKm: number;
  /** Instant of the minimum surface distance (can differ slightly from CA). */
  surfaceJdTdb: number;
  surfaceUtc: Date;
  /** Sub-asteroid geodetic latitude/longitude at that instant, degrees. */
  subPointLatDeg: number;
  subPointLonDeg: number;
}

export interface TopocentricClosestApproach {
  jdTdb: number;
  utc: Date;
  /** Minimum apparent (light-time corrected) range from this observer, km. */
  rangeKm: number;
  azimuthDeg: number;
  elevationDeg: number;
}

export interface VisibilityInterval {
  startJdTdb: number;
  endJdTdb: number;
  startUtc: Date;
  endUtc: Date;
}

export interface MoonInfo {
  jdTdb: number;
  utc: Date;
  azimuthDeg: number;
  elevationDeg: number;
  illuminationFraction: number;
  phaseAngleDeg: number;
  /** Angular separation from Apophis, degrees. */
  separationDeg: number;
}

export interface VisibilityResult {
  intervals: VisibilityInterval[];
  /** Maximum Apophis elevation while it satisfies the darkness criterion. */
  maxElevationDeg: number;
  maxElevationUtc: Date | null;
  /** Moon conditions at the middle of the best visible interval, else at CA. */
  moon: MoonInfo;
  /** Human-readable reason when nothing is visible. */
  reason: string;
}

export interface ApophisDataFile {
  schemaVersion: 1;
  target: {
    name: string;
    horizonsId: string;
    solution: string;
    radiusKm: number;
    absoluteMagnitudeH: number;
    slopeG: number;
  };
  source: {
    provider: string;
    apiVersion: string;
    retrievedAt: string;
    horizonsClock: string;
    queryUrl: string;
    query: Record<string, string>;
    responseHeader: string;
  };
  time: {
    scale: 'TDB';
    jdStart: number;
    jdEnd: number;
    stepSeconds: number;
    interpolation: 'cubic-hermite';
    ttMinusUtcSeconds: number;
    leapSeconds: number;
    notes: string;
  };
  vectors: number[][];
}
