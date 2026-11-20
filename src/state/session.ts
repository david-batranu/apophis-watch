import { dateFromJdTdb, jdTdbFromDate } from '../core/time';
import { apparentHorizontalAtJd, computeTopocentric } from '../ephemeris/topocentric';
import {
  computeVisibility,
  findAltitudeEvents,
  findClosestApproach,
  findTopocentricClosestApproach,
  type AltitudeEvents,
} from '../ephemeris/events';
import type {
  ClosestApproach,
  EphemerisProvider,
  ObserverLocation,
  SkyPosition,
  TopocentricClosestApproach,
  VisibilityInterval,
  VisibilityResult,
} from '../ephemeris/types';

export type JumpTarget =
  | 'topocentricCa'
  | 'geocentricCa'
  | 'rise'
  | 'set'
  | 'maxElevation'
  | 'visibilityStart'
  | 'visibilityEnd';

export interface PlotSample {
  utcMs: number;
  elevationDeg: number;
  magnitude: number;
  inVisibilityWindow: boolean;
}

export interface TrailSample {
  utcMs: number;
  azimuthDeg: number;
  elevationDeg: number;
  inVisibilityWindow: boolean;
}

/**
 * Pure simulation session: all Phase 1 maths stays in src/ephemeris. The view
 * layer only asks this class for derived targets and samples.
 */
export class SimulationSession {
  readonly ephem: EphemerisProvider;
  readonly observer: ObserverLocation;
  readonly geocentricCa: ClosestApproach;
  readonly topocentricCa: TopocentricClosestApproach;
  readonly visibility: VisibilityResult;
  readonly altitudeEvents: AltitudeEvents;
  readonly plotSamples: PlotSample[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;

  constructor(ephem: EphemerisProvider, observer: ObserverLocation) {
    this.ephem = ephem;
    this.observer = observer;
    this.geocentricCa = findClosestApproach(ephem);
    this.topocentricCa = findTopocentricClosestApproach(ephem, observer);
    this.windowStartMs = this.geocentricCa.utc.getTime() - 86_400_000;
    this.windowEndMs = this.geocentricCa.utc.getTime() + 86_400_000;
    this.visibility = computeVisibility(ephem, observer, this.geocentricCa.jdTdb, {
      startJdTdb: this.geocentricCa.jdTdb - 1,
      endJdTdb: this.geocentricCa.jdTdb + 1,
      stepSeconds: 120,
    });
    this.altitudeEvents = findAltitudeEvents(
      ephem,
      observer,
      this.geocentricCa.jdTdb - 1,
      this.geocentricCa.jdTdb + 1,
      60,
      this.geocentricCa.jdTdb,
    );
    this.plotSamples = this.buildPlotSamples();
  }

  private buildPlotSamples(): PlotSample[] {
    const samples: PlotSample[] = [];
    const stepMs = 120_000;
    for (let ms = this.windowStartMs; ms <= this.windowEndMs; ms += stepMs) {
      const sky = computeTopocentric(this.ephem, this.observer, new Date(ms));
      samples.push({
        utcMs: ms,
        elevationDeg: sky.geometricElevationDeg,
        magnitude: sky.magnitude,
        inVisibilityWindow: this.isInVisibilityWindow(jdTdbFromDate(new Date(ms))),
      });
    }
    return samples;
  }

  isInVisibilityWindow(jdTdb: number): boolean {
    return this.visibility.intervals.some(
      (interval) => jdTdb >= interval.startJdTdb && jdTdb <= interval.endJdTdb,
    );
  }

  visibleIntervalForJump(): VisibilityInterval | null {
    if (this.visibility.intervals.length === 0) return null;
    const reference = this.topocentricCa.jdTdb;
    const containing = this.visibility.intervals.find(
      (x) => reference >= x.startJdTdb && reference <= x.endJdTdb,
    );
    if (containing) return containing;
    return this.visibility.intervals.reduce((best, current) => {
      const bestDistance = Math.min(
        Math.abs(reference - best.startJdTdb),
        Math.abs(reference - best.endJdTdb),
      );
      const currentDistance = Math.min(
        Math.abs(reference - current.startJdTdb),
        Math.abs(reference - current.endJdTdb),
      );
      return currentDistance < bestDistance ? current : best;
    });
  }

  /** UTC ms for a jump button, or null if the event does not exist at this site. */
  jumpTarget(kind: JumpTarget): number | null {
    const interval = this.visibleIntervalForJump();
    let ms: number | null = null;
    switch (kind) {
      case 'topocentricCa':
        ms = this.topocentricCa.utc.getTime();
        break;
      case 'geocentricCa':
        ms = this.geocentricCa.utc.getTime();
        break;
      case 'rise':
        ms = this.altitudeEvents.riseJdTdb === null ? null : dateFromJdTdb(this.altitudeEvents.riseJdTdb).getTime();
        break;
      case 'set':
        ms = this.altitudeEvents.setJdTdb === null ? null : dateFromJdTdb(this.altitudeEvents.setJdTdb).getTime();
        break;
      case 'maxElevation':
        ms = this.altitudeEvents.transitJdTdb === null ? null : dateFromJdTdb(this.altitudeEvents.transitJdTdb).getTime();
        break;
      case 'visibilityStart':
        ms = interval === null ? null : interval.startUtc.getTime();
        break;
      case 'visibilityEnd':
        ms = interval === null ? null : interval.endUtc.getTime();
        break;
    }
    if (ms === null) return null;
    return Math.max(this.windowStartMs, Math.min(this.windowEndMs, ms));
  }

  skyAt(utcMs: number, refraction: boolean): SkyPosition {
    return computeTopocentric(this.ephem, this.observer, new Date(utcMs), {
      refraction,
    });
  }

  /** One-minute trail around the cursor, clipped to the data window. */
  trail(centerMs: number, hoursEachSide = 3, refraction = false): TrailSample[] {
    const stepMs = 60_000;
    const start = Math.max(this.windowStartMs, centerMs - hoursEachSide * 3_600_000);
    const end = Math.min(this.windowEndMs, centerMs + hoursEachSide * 3_600_000);
    const samples: TrailSample[] = [];
    for (let ms = start; ms <= end; ms += stepMs) {
      const jd = jdTdbFromDate(new Date(ms));
      const horizontal = apparentHorizontalAtJd(this.ephem, this.observer, jd, {
        refraction,
      });
      samples.push({
        utcMs: ms,
        azimuthDeg: horizontal.azimuthDeg,
        elevationDeg: horizontal.elevationDeg,
        inVisibilityWindow: this.isInVisibilityWindow(jd),
      });
    }
    return samples;
  }
}
