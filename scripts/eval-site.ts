/**
 * Developer/verification CLI: evaluate the topocentric model at one site/time.
 *
 *   npx tsx scripts/eval-site.ts --lat 45.6427 --lon 25.5887 --elev 600 \
 *     --utc 2029-04-13T21:45:03.557Z
 *
 * Prints JSON. This is the same code path the app uses; it exists so an
 * independent verifier can compare a single value against Horizons without
 * reimplementing the CLI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TableEphemeris } from '../src/ephemeris/hermite';
import { computeTopocentric } from '../src/ephemeris/topocentric';
import type { ApophisDataFile } from '../src/ephemeris/types';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const lat = Number(arg('lat'));
const lon = Number(arg('lon'));
const elev = Number(arg('elev') ?? 0);
const utc = arg('utc');
if (![lat, lon, elev].every(Number.isFinite) || !utc) {
  console.error(
    'usage: tsx scripts/eval-site.ts --lat <deg> --lon <deg> [--elev <m>] --utc <ISO-8601>',
  );
  process.exit(2);
}
const date = new Date(utc);
if (Number.isNaN(date.getTime())) {
  console.error('invalid --utc date');
  process.exit(2);
}
const data = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/apophis-2029.json'), 'utf8'),
) as ApophisDataFile;
const ephem = new TableEphemeris(data);
const sky = computeTopocentric(
  ephem,
  { latitudeDeg: lat, longitudeDeg: lon, elevationM: elev },
  date,
  { refraction: false },
);
console.log(
  JSON.stringify(
    {
      input: { lat, lon, elevM: elev, utc },
      azimuthDeg: sky.azimuthDeg,
      elevationDeg: sky.elevationDeg,
      rangeKm: sky.rangeKm,
      rangeRateKmS: sky.rangeRateKmS,
      angularRateDegPerMin: sky.angularRateDegPerMin,
      angularDiameterArcsec: sky.angularDiameterArcsec,
      magnitude: sky.magnitude,
      phaseAngleDeg: sky.phaseAngleDeg,
      jdTdb: sky.jdTdb,
      refracted: sky.refracted,
    },
    null,
    2,
  ),
);
