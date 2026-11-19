import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TableEphemeris } from '../src/ephemeris/hermite';
import type { ApophisDataFile, ObserverLocation } from '../src/ephemeris/types';

export interface ObserverTruthSample {
  jdUtc: number;
  utc: string;
  horizonsUtc: string;
  azimuthDeg: number;
  elevationDeg: number;
  magnitude: number;
  angularDiameterArcsec: number;
  rangeAu: number;
  rangeRateKmS: number;
}

export interface ObserverTruthSite extends ObserverLocation {
  name: string;
  note?: string;
}

export interface ValidationFile {
  schemaVersion: number;
  retrievedAt: string;
  source: {
    provider: string;
    apiVersion: string;
    horizonsClock: string;
    solution: string;
  };
  mainQuery: Record<string, string>;
  interpolation: {
    query: Record<string, string>;
    stepSeconds: number;
    offsetSeconds: number;
    maxPositionErrorKm: number;
    maxVelocityErrorKmS: number;
    samples: number[][];
  };
  closestApproachTruth: {
    refinedJdUtc: number;
    refinedUtc: string;
    geocentricDistanceKm: number;
    samples: number[][];
  };
  observerTruth: {
    site: ObserverTruthSite;
    query: Record<string, string>;
    samples: ObserverTruthSample[];
  }[];
  topocentricClosestApproachTruth: {
    site: ObserverTruthSite;
    refinedJdUtc: number;
    refinedUtc: string;
    rangeKm: number;
    samples: { jdUtc: number; rangeAu: number; rangeRateKmS: number }[];
  };
}

export const DATA_PATH = resolve(process.cwd(), 'public/data/apophis-2029.json');
export const VALIDATION_PATH = resolve(process.cwd(), 'tests/fixtures/horizons-validation.json');

export const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as ApophisDataFile;
export const validation = JSON.parse(readFileSync(VALIDATION_PATH, 'utf8')) as ValidationFile;
export const ephem = new TableEphemeris(data);

export const BRASOV: ObserverLocation = {
  latitudeDeg: 45.6427,
  longitudeDeg: 25.5887,
  elevationM: 600,
};
