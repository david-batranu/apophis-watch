import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  Observer,
  type AstroTime,
} from 'astronomy-engine';
import { astroTimeFromJdTdb } from '../core/time';
import { refractedElevationDeg } from '../ephemeris/refraction';
import type { ObserverLocation } from '../ephemeris/types';

export type SolarSystemBody = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

export interface BodyPosition {
  body: SolarSystemBody;
  azimuthDeg: number;
  elevationDeg: number;
  airlessElevationDeg: number;
  magnitude: number | null;
  /** Moon only: illuminated fraction 0..1. */
  phaseFraction?: number;
  /** Moon only: 0=new, 90=first quarter, 180=full, 270=last quarter. */
  phaseAngleDeg?: number;
  waxing?: boolean;
  color: string;
  symbolRadiusPx: number;
}

const PLANETS: { body: SolarSystemBody; color: string; radius: number }[] = [
  { body: 'Mercury', color: '#c9b79c', radius: 3 },
  { body: 'Venus', color: '#f5e6b8', radius: 4.5 },
  { body: 'Mars', color: '#e07a5f', radius: 3.5 },
  { body: 'Jupiter', color: '#e8c9a0', radius: 5 },
  { body: 'Saturn', color: '#e6d3a3', radius: 5 },
  { body: 'Uranus', color: '#9fd8d8', radius: 2.5 },
  { body: 'Neptune', color: '#8fb3ff', radius: 2.5 },
];

/**
 * Topocentric positions of the Sun, Moon and planets for the sky dome.
 * astronomy-engine supplies the ephemerides; refraction is a display-only
 * Bennett correction applied on top of the airless altitude.
 */
export function solarSystemBodies(
  observer: ObserverLocation,
  jdTdb: number,
  refraction: boolean,
): BodyPosition[] {
  const time: AstroTime = astroTimeFromJdTdb(jdTdb);
  const obs = new Observer(
    observer.latitudeDeg,
    observer.longitudeDeg,
    observer.elevationM,
  );

  const positions: BodyPosition[] = [];
  const add = (body: SolarSystemBody, color: string, radius: number) => {
    const eq = Equator(body as unknown as Body, time, obs, true, true);
    const hor = Horizon(time, obs, eq.ra, eq.dec, undefined);
    const airless = hor.altitude;
    const elevationDeg =
      refraction && airless > -2 ? refractedElevationDeg(airless) : airless;
    const illumination = Illumination(body as unknown as Body, time);
    positions.push({
      body,
      azimuthDeg: hor.azimuth,
      elevationDeg,
      airlessElevationDeg: airless,
      magnitude: Number.isFinite(illumination.mag) ? illumination.mag : null,
      color,
      symbolRadiusPx: radius,
    });
  };

  add('Sun', '#ffd166', 7);
  const moon = (() => {
    const eq = Equator(Body.Moon, time, obs, true, true);
    const hor = Horizon(time, obs, eq.ra, eq.dec, undefined);
    const airless = hor.altitude;
    const elevationDeg =
      refraction && airless > -2 ? refractedElevationDeg(airless) : airless;
    const illumination = Illumination(Body.Moon, time);
    const phaseAngle = MoonPhase(time);
    return {
      body: 'Moon' as const,
      azimuthDeg: hor.azimuth,
      elevationDeg,
      airlessElevationDeg: airless,
      magnitude: Number.isFinite(illumination.mag) ? illumination.mag : null,
      phaseFraction: illumination.phase_fraction,
      phaseAngleDeg: phaseAngle,
      waxing: phaseAngle < 180,
      color: '#eef2f7',
      symbolRadiusPx: 7,
    };
  })();
  positions.push(moon);
  for (const planet of PLANETS) add(planet.body, planet.color, planet.radius);
  return positions;
}

/** Angular separation between two horizontal coordinates, degrees. */
export function separationDeg(
  az1Deg: number,
  el1Deg: number,
  az2Deg: number,
  el2Deg: number,
): number {
  const el1 = (el1Deg * Math.PI) / 180;
  const el2 = (el2Deg * Math.PI) / 180;
  const dAz = ((az1Deg - az2Deg) * Math.PI) / 180;
  const cosSep =
    Math.sin(el1) * Math.sin(el2) + Math.cos(el1) * Math.cos(el2) * Math.cos(dAz);
  return (Math.acos(Math.max(-1, Math.min(1, cosSep))) * 180) / Math.PI;
}
