import { jdTdbFromDate } from '../core/time';
import type { ObserverLocation, SkyPosition } from '../ephemeris/types';
import { solarSystemBodies, type BodyPosition } from '../sky/bodies';
import type { StarCatalogue, StarRecord } from '../sky/catalog';
import { enuBasisInEqj, eqjVectorToHorizontal, raDecToEqj } from '../sky/skyFrame';
import type { SimulationSession, TrailSample } from '../state/session';
import { localHhMm } from '../ui/timeFormat';

export type ArTimeMode = 'rehearsal' | 'tonight';
export type SkyTargetKind = 'apophis' | 'sun' | 'moon' | 'planet' | 'star';

export interface SkyTarget {
  id: string;
  name: string;
  kind: SkyTargetKind;
  azimuthDeg: number;
  elevationDeg: number;
  magnitude: number | null;
  colour: string;
  radiusPx: number;
}

export interface ArTrailPoint {
  utcMs: number;
  azimuthDeg: number;
  elevationDeg: number;
  aboveHorizon: boolean;
  /** Five-minute UTC tick. */
  tick: boolean;
  /** Local HH:mm label, present for 30-minute ticks. */
  label: string | null;
}

export interface ArSkySnapshot {
  utcMs: number;
  mode: ArTimeMode;
  observer: ObserverLocation;
  apophis: SkyPosition | null;
  targets: SkyTarget[];
  stars: SkyTarget[];
  alignTargets: SkyTarget[];
  trail: ArTrailPoint[];
}

/** Stars offered for one-tap/two-point alignment. Names come from HYG. */
export const ALIGNMENT_STAR_NAMES: readonly string[] = [
  'Sirius',
  'Canopus',
  'Arcturus',
  'Vega',
  'Capella',
  'Rigel',
  'Procyon',
  'Betelgeuse',
  'Altair',
  'Aldebaran',
  'Antares',
  'Spica',
  'Pollux',
  'Fomalhaut',
  'Deneb',
  'Regulus',
];

const ALIGNMENT_STAR_SET = new Set(ALIGNMENT_STAR_NAMES);
const STAR_DRAW_MAG_LIMIT = 4.2;

function starColour(colourIndex: number | undefined): string {
  if (colourIndex === undefined || !Number.isFinite(colourIndex)) return '#e8f0ff';
  if (colourIndex < 0.0) return '#bcd4ff';
  if (colourIndex < 0.4) return '#e8f0ff';
  if (colourIndex < 0.8) return '#fff4e8';
  if (colourIndex < 1.3) return '#ffd9b0';
  return '#ffb890';
}

function starRadius(mag: number): number {
  if (mag < 0.2) return 3.2;
  if (mag < 1.0) return 2.6;
  if (mag < 2.0) return 2.0;
  if (mag < 3.2) return 1.5;
  return 1.1;
}

function bodyTarget(body: BodyPosition): SkyTarget {
  const isSun = body.body === 'Sun';
  const isMoon = body.body === 'Moon';
  return {
    id: `body:${body.body}`,
    name: body.body,
    kind: isSun ? 'sun' : isMoon ? 'moon' : 'planet',
    azimuthDeg: body.azimuthDeg,
    elevationDeg: body.elevationDeg,
    magnitude: body.magnitude,
    colour: body.color,
    radiusPx: body.symbolRadiusPx,
  };
}

export interface BuildSnapshotInput {
  session: SimulationSession | null;
  catalogue: StarCatalogue | null;
  observer: ObserverLocation | null;
  utcMs: number;
  mode: ArTimeMode;
  refraction: boolean;
  timeZone: string;
  trailHoursEachSide?: number;
  /** Reuse a trail computed on a coarser cache to avoid rebuilding it per frame. */
  trail?: ArTrailPoint[];
}

/** Bright stars above the horizon, in horizontal coordinates. */
export function horizontalStars(
  catalogue: StarCatalogue | null,
  observer: ObserverLocation,
  utcMs: number,
  magnitudeLimit = STAR_DRAW_MAG_LIMIT,
): SkyTarget[] {
  if (!catalogue) return [];
  const basis = enuBasisInEqj(observer, jdTdbFromDate(new Date(utcMs)));
  const result: SkyTarget[] = [];
  for (const star of catalogue.stars) {
    if (!(star.mag <= magnitudeLimit)) continue;
    const horizontal = eqjVectorToHorizontal(raDecToEqj(star.raDeg, star.decDeg), basis);
    if (horizontal.elevationDeg < -1) continue;
    result.push({
      id: `star:${star.id}`,
      name: star.name ?? '',
      kind: 'star',
      azimuthDeg: horizontal.azimuthDeg,
      elevationDeg: horizontal.elevationDeg,
      magnitude: star.mag,
      colour: starColour(star.colourIndex),
      radiusPx: starRadius(star.mag),
    });
  }
  return result;
}

/**
 * Short, honest alignment list: Sun, Moon and planets above 3°, plus the
 * named bright stars above 5°, brightest first. Only objects the user can
 * actually see are offered.
 */
export function buildAlignmentTargets(
  targets: SkyTarget[],
  stars: SkyTarget[],
  limit = 14,
): SkyTarget[] {
  const bodies = targets
    .filter((t) => t.kind !== 'star' && t.id !== 'apophis' && t.elevationDeg > 3)
    .sort((a, b) => a.elevationDeg - b.elevationDeg);
  const namedStars = stars
    .filter((t) => ALIGNMENT_STAR_SET.has(t.name) && t.elevationDeg > 5)
    .sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99));
  const seen = new Set<string>();
  const result: SkyTarget[] = [];
  for (const target of [...bodies, ...namedStars]) {
    if (seen.has(target.name)) continue;
    seen.add(target.name);
    result.push(target);
    if (result.length >= limit) break;
  }
  return result;
}

function trailPoints(
  session: SimulationSession | null,
  utcMs: number,
  refraction: boolean,
  timeZone: string,
  hoursEachSide: number,
): ArTrailPoint[] {
  if (!session) return [];
  const samples = session.trail(utcMs, hoursEachSide, refraction);
  return samples.map((sample: TrailSample) => {
    const aboveHorizon = sample.elevationDeg >= 0;
    const minute = new Date(sample.utcMs).getUTCMinutes();
    const tick = minute % 5 === 0;
    return {
      utcMs: sample.utcMs,
      azimuthDeg: sample.azimuthDeg,
      elevationDeg: sample.elevationDeg,
      aboveHorizon,
      tick,
      label: tick && minute % 30 === 0 ? localHhMm(sample.utcMs, timeZone) : null,
    };
  });
}

/** Trail cache helper; the caller can refresh this far less often than targets. */
export function buildArTrail(
  session: SimulationSession | null,
  utcMs: number,
  refraction: boolean,
  timeZone: string,
  hoursEachSide = 2,
): ArTrailPoint[] {
  return trailPoints(session, utcMs, refraction, timeZone, hoursEachSide);
}

export function buildSkySnapshot(input: BuildSnapshotInput): ArSkySnapshot {
  const {
    session,
    catalogue,
    observer,
    utcMs,
    mode,
    refraction,
    timeZone,
    trailHoursEachSide = 2,
  } = input;
  const empty: ArSkySnapshot = {
    utcMs,
    mode,
    observer: observer ?? { latitudeDeg: 0, longitudeDeg: 0, elevationM: 0 },
    apophis: null,
    targets: [],
    stars: [],
    alignTargets: [],
    trail: [],
  };
  if (!observer) return empty;

  const jdTdb = jdTdbFromDate(new Date(utcMs));
  const bodies = solarSystemBodies(observer, jdTdb, refraction);
  const targets = bodies.map(bodyTarget);
  const stars = horizontalStars(catalogue, observer, utcMs);
  const inSessionWindow = Boolean(
    session && utcMs >= session.windowStartMs && utcMs <= session.windowEndMs,
  );
  const apophis =
    mode === 'rehearsal' && inSessionWindow && session
      ? session.skyAt(utcMs, refraction)
      : null;
  if (apophis) {
    targets.unshift({
      id: 'apophis',
      name: 'Apophis',
      kind: 'apophis',
      azimuthDeg: apophis.azimuthDeg,
      elevationDeg: apophis.elevationDeg,
      magnitude: apophis.magnitude,
      colour: '#ff5a5f',
      radiusPx: 7,
    });
  }
  return {
    utcMs,
    mode,
    observer,
    apophis,
    targets,
    stars,
    alignTargets: buildAlignmentTargets(targets, stars),
    trail:
      input.trail ??
      (mode === 'rehearsal' && inSessionWindow
        ? trailPoints(session, utcMs, refraction, timeZone, trailHoursEachSide)
        : []),
  };
}

/** Catalogue lookup used to keep the alignment target name stable. */
export function findCatalogueStar(
  catalogue: StarCatalogue | null,
  name: string,
): StarRecord | null {
  if (!catalogue) return null;
  return catalogue.stars.find((star) => star.name === name) ?? null;
}
