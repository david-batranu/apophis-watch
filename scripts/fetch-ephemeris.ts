/**
 * Fetch the committed Apophis ephemeris and independent validation truth
 * from JPL Horizons.
 *
 * Run with:  npm run fetch:ephemeris
 *
 * Outputs:
 *   public/data/apophis-2029.json          app ephemeris (geocentric ICRF, TDB)
 *   tests/fixtures/horizons-validation.json independent truth for the tests
 *
 * Every number in these files comes from Horizons; nothing is invented.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  jdToMs,
  jdUtcToDate,
  LEAP_SECONDS_2029,
  msToJd,
  TT_MINUS_UTC_SECONDS,
} from '../src/core/time';
import { findClosestApproach } from '../src/ephemeris/events';
import { TableEphemeris } from '../src/ephemeris/hermite';
import { computeTopocentric, horizontalSeparationDeg } from '../src/ephemeris/topocentric';
import type { ApophisDataFile, ObserverLocation } from '../src/ephemeris/types';

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = resolve(ROOT, 'public/data/apophis-2029.json');
const VALIDATION_PATH = resolve(ROOT, 'tests/fixtures/horizons-validation.json');

const MAIN_START = '2029-04-12 21:30';
const MAIN_STOP = '2029-04-14 22:00';
const STEP_SECONDS = 60;

interface HorizonsResult {
  text: string;
  url: string;
  params: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildParams(extra: Record<string, string>): Record<string, string> {
  return {
    format: 'text',
    COMMAND: "'99942'",
    OBJ_DATA: 'NO',
    ...extra,
  };
}

async function fetchHorizons(
  label: string,
  params: Record<string, string>,
): Promise<HorizonsResult> {
  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ApophisWatch/0.1 (one-off static astronomy build; polite)',
        },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      if (!text.includes('$$SOE') || !text.includes('$$EOE')) {
        const detail = text
          .split('\n')
          .filter((line) => /error|cannot|no ephemeris|bad/i.test(line))
          .slice(0, 5)
          .join(' ');
        throw new Error(`Horizons returned no ephemeris rows. ${detail}`);
      }
      return { text, url: url.toString(), params };
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        const wait = 1000 * 2 ** (attempt - 1);
        console.warn(`  ${label}: attempt ${attempt} failed (${String(error)}); retrying in ${wait} ms`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`${label}: JPL Horizons unreachable after 4 attempts: ${String(lastError)}`);
}

function betweenMarkers(text: string): string[] {
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe < 0 || eoe <= soe) throw new Error('malformed Horizons response');
  return text
    .slice(soe + 4, eoe)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Data lines always begin with a numeric JD/date after trimming. */
const isDataLine = (line: string): boolean => /^\d/.test(line);

function parseVectorRows(text: string): number[][] {
  const rows: number[][] = [];
  for (const line of betweenMarkers(text)) {
    if (!isDataLine(line)) continue;
    const fields = line.split(',').map((f) => f.trim());
    if (fields.length < 8) throw new Error(`malformed vector row: ${line}`);
    const jd = Number(fields[0]);
    const values = [1, 2, 3, 4, 5, 6].map((i) => Number(fields[i + 1]));
    if (!Number.isFinite(jd) || values.some((v) => !Number.isFinite(v))) {
      throw new Error(`non-numeric vector row: ${line}`);
    }
    rows.push([jd, ...values]);
  }
  return rows;
}

function metaNumber(text: string, re: RegExp, name: string): number {
  const match = re.exec(text);
  if (!match) throw new Error(`could not parse ${name} from Horizons header`);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) throw new Error(`invalid ${name}`);
  return value;
}

function metaString(text: string, re: RegExp, name: string): string {
  const match = re.exec(text);
  if (!match) throw new Error(`could not parse ${name} from Horizons header`);
  return match[1].trim();
}

interface ObserverSample {
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

function parseObserverRows(text: string, jdUtcList: number[]): ObserverSample[] {
  const lines = betweenMarkers(text).filter(isDataLine);
  if (lines.length !== jdUtcList.length) {
    throw new Error(`expected ${jdUtcList.length} observer rows, got ${lines.length}`);
  }
  return lines.map((line, index) => {
    const fields = line.split(',').map((f) => f.trim());
    // Date, solar symbol, lunar symbol, az, el, APmag, S-brt, Ang-diam, delta, deldot
    if (fields.length < 11) throw new Error(`malformed observer row: ${line}`);
    const azimuthDeg = Number(fields[3]);
    const elevationDeg = Number(fields[4]);
    const magnitude = Number(fields[5]);
    const angularDiameterArcsec = Number(fields[7]);
    const rangeAu = Number(fields[8]);
    const rangeRateKmS = Number(fields[9]);
    if (
      !Number.isFinite(azimuthDeg) ||
      !Number.isFinite(elevationDeg) ||
      !Number.isFinite(rangeAu)
    ) {
      throw new Error(`non-numeric observer row: ${line}`);
    }
    // The requested JD is authoritative; the printed calendar tag loses
    // precision beyond milliseconds and is kept only for audit.
    const jdUtc = jdUtcList[index];
    return {
      jdUtc,
      utc: jdUtcToDate(jdUtc).toISOString(),
      horizonsUtc: fields[0],
      azimuthDeg,
      elevationDeg,
      magnitude,
      angularDiameterArcsec,
      rangeAu,
      rangeRateKmS,
    };
  });
}

interface SiteDefinition extends ObserverLocation {
  name: string;
  note?: string;
}

const SITES: SiteDefinition[] = [
  {
    name: 'Brasov, Romania',
    latitudeDeg: 45.6427,
    longitudeDeg: 25.5887,
    elevationM: 600,
  },
  {
    name: 'Cape Town, South Africa',
    latitudeDeg: -33.9249,
    longitudeDeg: 18.4241,
    elevationM: 15,
  },
  {
    name: 'Teide Observatory, Tenerife',
    latitudeDeg: 28.3006,
    longitudeDeg: -16.5106,
    elevationM: 2390,
  },
  {
    name: 'Longyearbyen, Svalbard',
    latitudeDeg: 78.2232,
    longitudeDeg: 15.6469,
    elevationM: 10,
    note: 'Polar daylight: the Sun does not reach -6 degrees, so no dark-sky window.',
  },
  {
    name: 'Honolulu, Hawaii',
    latitudeDeg: 21.3069,
    longitudeDeg: -157.8583,
    elevationM: 5,
    note: 'Apophis is below the horizon at closest approach.',
  },
];

function parseRangeRows(
  text: string,
  jdUtcList: number[],
): { jdUtc: number; rangeAu: number; rangeRateKmS: number }[] {
  const lines = betweenMarkers(text).filter(isDataLine);
  if (lines.length !== jdUtcList.length) {
    throw new Error(`expected ${jdUtcList.length} range rows, got ${lines.length}`);
  }
  return lines.map((line, index) => {
    const fields = line.split(',').map((f) => f.trim());
    // Date, solar symbol, lunar symbol, delta, deldot
    const rangeAu = Number(fields[3]);
    const rangeRateKmS = Number(fields[4]);
    if (!Number.isFinite(rangeAu) || !Number.isFinite(rangeRateKmS)) {
      throw new Error(`malformed range row: ${line}`);
    }
    return { jdUtc: jdUtcList[index], rangeAu, rangeRateKmS };
  });
}

function siteCoord(site: ObserverLocation): string {
  return `${site.longitudeDeg.toFixed(6)},${site.latitudeDeg.toFixed(6)},${(
    site.elevationM / 1000
  ).toFixed(3)}`;
}

async function fetchObserverTruth(
  site: SiteDefinition,
  jdUtcList: number[],
): Promise<{ site: SiteDefinition; query: Record<string, string>; samples: ObserverSample[] }> {
  const params = buildParams({
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@399'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${siteCoord(site)}'`,
    TLIST: `'${jdUtcList.map((jd) => jd.toFixed(9)).join(',')}'`,
    TIME_TYPE: "'UT'",
    QUANTITIES: "'4,9,13,20'",
    ANG_FORMAT: "'DEG'",
    EXTRA_PREC: "'YES'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
  });
  const result = await fetchHorizons(`observer ${site.name}`, params);
  const samples = parseObserverRows(result.text, jdUtcList);
  console.log(`  ${site.name}: ${samples.length} truth rows`);
  return { site, query: result.params, samples };
}

function extractMetadata(text: string) {
  const version = metaString(text, /API VERSION:\s*([^\n]+)/, 'API version');
  const clock = metaString(text, /Ephemeris \/ API_USER\s+([^\n]+)/, 'Horizons clock');
  const targetLine = /Target body name:\s*([^\n]+)/.exec(text)?.[1]?.trim() ?? '';
  const solution = /\{source:\s*([^}]+)\}/.exec(targetLine)?.[1]?.trim() ?? '';
  const name = targetLine.replace(/\s*\{source:[^}]*\}\s*$/, '').trim();
  const solutionDate = /Soln\.date:\s*([^\n]+)/.exec(text)?.[1]?.trim() ?? '';
  const h = metaNumber(text, /H=\s*([0-9.]+)\s+G=/, 'H');
  const g = metaNumber(text, /H=\s*[0-9.]+\s+G=\s*([0-9.]+)/, 'G');
  const radiusKm = metaNumber(text, /RAD=\s*([0-9.]+)/, 'RAD');
  return { apiVersion: version, clock, name, solution, solutionDate, h, g, radiusKm };
}

function compactVectors(metadata: object, rows: number[][]): string {
  const head = JSON.stringify(metadata, null, 2);
  const tail = rows.map((row) => `    [${row.join(',')}]`).join(',\n');
  return `${head.slice(0, -2)},\n  "vectors": [\n${tail}\n  ]\n}\n`;
}

async function main(): Promise<void> {
  console.log('Apophis Watch ephemeris fetch');
  console.log('  source: NASA/JPL Horizons', API_URL);

  console.log(`\n[1/6] Geocentric ICRF state vectors, TDB, ${STEP_SECONDS} s step`);
  const vectorParams = buildParams({
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    START_TIME: `'${MAIN_START}'`,
    STOP_TIME: `'${MAIN_STOP}'`,
    STEP_SIZE: `'${STEP_SECONDS / 60} m'`,
    REF_PLANE: "'FRAME'",
    REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'2'",
    OUT_UNITS: "'KM-S'",
    TIME_TYPE: "'TDB'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'YES'",
  });
  const main = await fetchHorizons('main vectors', vectorParams);
  const vectors = parseVectorRows(main.text);
  const meta = extractMetadata(main.text);
  console.log(
    `  ${vectors.length} rows, ${meta.name}, solution ${meta.solution}, H=${meta.h} G=${meta.g} R=${meta.radiusKm} km`,
  );
  if (vectors.length !== 2911) {
    console.warn(`  warning: expected 2911 rows, got ${vectors.length}`);
  }

  const data: ApophisDataFile = {
    schemaVersion: 1,
    target: {
      name: meta.name,
      horizonsId: '99942',
      solution: meta.solution,
      radiusKm: meta.radiusKm,
      absoluteMagnitudeH: meta.h,
      slopeG: meta.g,
    },
    source: {
      provider: 'NASA/JPL Horizons',
      apiVersion: meta.apiVersion,
      retrievedAt: new Date().toISOString(),
      horizonsClock: meta.clock,
      queryUrl: main.url,
      query: main.params,
      responseHeader: [
        `Target: ${meta.name}`,
        `Solution: ${meta.solution} (${meta.solutionDate})`,
        `Output: geocentric 500@399, ICRF, state vectors, km & km/s, TDB, ${STEP_SECONDS} s`,
      ].join('\n'),
    },
    time: {
      scale: 'TDB',
      jdStart: vectors[0][0],
      jdEnd: vectors[vectors.length - 1][0],
      stepSeconds: STEP_SECONDS,
      interpolation: 'cubic-hermite',
      ttMinusUtcSeconds: TT_MINUS_UTC_SECONDS,
      leapSeconds: LEAP_SECONDS_2029,
      notes:
        'Julian dates are TDB. UTC = TDB - (TDB-TT) - 69.184 s for this 2029 window; ' +
        'the app converts explicitly. Hermite interpolation uses position and velocity.',
    },
    vectors,
  };

  const ephem = new TableEphemeris(data);
  const ca = findClosestApproach(ephem);
  console.log(
    `\n  derived closest approach: ${ca.utc.toISOString()} (${ca.jdTdb} TDB), ` +
      `${ca.geocentricDistanceKm.toFixed(1)} km from centre, ` +
      `${ca.surfaceDistanceKm.toFixed(1)} km above the WGS84 surface`,
  );

  console.log('\n[2/6] Independent close-approach truth (10 s UTC vectors)');
  const caUnixMs = ca.utc.getTime();
  // Horizons VECTORS step sizes accept d/h/m, not seconds; use an explicit
  // 10-second time list instead so the sample instants are exact.
  const caTruthJdList = Array.from({ length: 37 }, (_, i) =>
    msToJd(caUnixMs + (i - 18) * 10_000),
  );
  const caTruthParams = buildParams({
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    TLIST: `'${caTruthJdList.map((jd) => jd.toFixed(9)).join(',')}'`,
    REF_PLANE: "'FRAME'",
    REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'2'",
    OUT_UNITS: "'KM-S'",
    TIME_TYPE: "'UT'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
  });
  const caTruthResult = await fetchHorizons('close approach truth', caTruthParams);
  const caTruthRows = parseVectorRows(caTruthResult.text);
  let caTruthBest = { jd: 0, r: Infinity };
  for (const row of caTruthRows) {
    const r = Math.hypot(row[1], row[2], row[3]);
    if (r < caTruthBest.r) caTruthBest = { jd: row[0], r };
  }
  // Parabolic refinement using the three samples around the minimum.
  const caTruthSamples = caTruthRows
    .map((row) => ({ jd: row[0], r: Math.hypot(row[1], row[2], row[3]) }))
    .sort((a, b) => a.jd - b.jd);
  const minIndex = caTruthSamples.findIndex((s) => s.jd === caTruthBest.jd);
  let caTruthJd = caTruthBest.jd;
  if (minIndex > 0 && minIndex < caTruthSamples.length - 1) {
    const [p0, p1, p2] = [
      caTruthSamples[minIndex - 1],
      caTruthSamples[minIndex],
      caTruthSamples[minIndex + 1],
    ];
    const denom = p0.r - 2 * p1.r + p2.r;
    const shift = denom !== 0 ? (0.5 * (p0.r - p2.r)) / denom : 0;
    caTruthJd = p1.jd + shift * (p1.jd - p0.jd);
  }
  console.log(
    `  Horizons 10 s UTC minimum: ${jdUtcToDate(caTruthJd).toISOString()} (${caTruthBest.r.toFixed(1)} km)`,
  );

  console.log('\n[3/6] Interpolation truth vectors (30 s offset, every 2 min, TDB)');
  const interpParams = buildParams({
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    START_TIME: "'2029-04-12 21:30:30'",
    STOP_TIME: "'2029-04-14 21:59:30'",
    STEP_SIZE: "'2 m'",
    REF_PLANE: "'FRAME'",
    REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'2'",
    OUT_UNITS: "'KM-S'",
    TIME_TYPE: "'TDB'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
  });
  const interpResult = await fetchHorizons('interpolation truth', interpParams);
  const interpRows = parseVectorRows(interpResult.text);
  let maxPositionErrorKm = 0;
  let maxVelocityErrorKmS = 0;
  for (const row of interpRows) {
    const state = ephem.stateAtJdTdb(row[0]);
    const dp = Math.hypot(
      state.positionKm.x - row[1],
      state.positionKm.y - row[2],
      state.positionKm.z - row[3],
    );
    const dv = Math.hypot(
      state.velocityKmS.x - row[4],
      state.velocityKmS.y - row[5],
      state.velocityKmS.z - row[6],
    );
    maxPositionErrorKm = Math.max(maxPositionErrorKm, dp);
    maxVelocityErrorKmS = Math.max(maxVelocityErrorKmS, dv);
  }
  console.log(
    `  ${interpRows.length} truth samples; max Hermite position error ${maxPositionErrorKm.toFixed(6)} km, ` +
      `velocity ${maxVelocityErrorKmS.toExponential(2)} km/s`,
  );

  console.log('\n[4/6] Observer-table truth at five sites');
  const offsetsHours = [-12, -6, -1, 0, 1, 6, 12];
  const jdUtcList = offsetsHours
    .map((h) => msToJd(caUnixMs + h * 3_600_000))
    .sort((a, b) => a - b);
  const observers = [];
  for (const site of SITES) {
    observers.push(await fetchObserverTruth(site, jdUtcList));
    await sleep(250);
  }

  console.log('\n[5/6] Topocentric closest-approach truth (Brasov, 10 s UTC)');
  // The topocentric minimum can be several minutes before the geocentric
  // one; cover ±20 minutes at 1-minute resolution first (Horizons rejects
  // very long TLIST requests), then refine ±2 min at 10 s.
  const brasov = SITES[0];
  const calendar = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const topoCoarseParams = buildParams({
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@399'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${siteCoord(brasov)}'`,
    START_TIME: `'${calendar(new Date(caUnixMs - 20 * 60_000))}'`,
    STOP_TIME: `'${calendar(new Date(caUnixMs + 20 * 60_000))}'`,
    STEP_SIZE: "'1 m'",
    TIME_TYPE: "'UT'",
    QUANTITIES: "'20'",
    EXTRA_PREC: "'YES'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
  });
  const topoCoarseResult = await fetchHorizons('topocentric CA coarse', topoCoarseParams);
  const topoCoarseLines = betweenMarkers(topoCoarseResult.text).filter(isDataLine);
  const topoCoarse = topoCoarseLines.map((line, index) => {
    const fields = line.split(',').map((f) => f.trim());
    return {
      jdUtc: msToJd(caUnixMs + (index - 20) * 60_000),
      rangeAu: Number(fields[3]),
    };
  });
  let coarseBest = topoCoarse[0];
  for (const row of topoCoarse) if (row.rangeAu < coarseBest.rangeAu) coarseBest = row;

  const topoFineJdList = Array.from({ length: 25 }, (_, i) =>
    coarseBest.jdUtc + (i - 12) * (10 / 86400),
  );
  const topoFineParams = buildParams({
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@399'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${siteCoord(brasov)}'`,
    TLIST: `'${topoFineJdList.map((jd) => jd.toFixed(9)).join(',')}'`,
    TIME_TYPE: "'UT'",
    QUANTITIES: "'20'",
    EXTRA_PREC: "'YES'",
    CSV_FORMAT: "'YES'",
    OBJ_DATA: "'NO'",
  });
  const topoFineResult = await fetchHorizons('topocentric CA fine', topoFineParams);
  const topoCaRows = parseRangeRows(topoFineResult.text, topoFineJdList);
  let topoBest = topoCaRows[0];
  for (const row of topoCaRows) if (row.rangeAu < topoBest.rangeAu) topoBest = row;
  const topoIndex = topoCaRows.findIndex((r) => r.jdUtc === topoBest.jdUtc);
  let topoTruthJd = topoBest.jdUtc;
  if (topoIndex > 0 && topoIndex < topoCaRows.length - 1) {
    const p0 = topoCaRows[topoIndex - 1].rangeAu;
    const p1 = topoCaRows[topoIndex].rangeAu;
    const p2 = topoCaRows[topoIndex + 1].rangeAu;
    const denom = p0 - 2 * p1 + p2;
    const shift = denom !== 0 ? (0.5 * (p0 - p2)) / denom : 0;
    topoTruthJd = topoBest.jdUtc + shift * (10 / 86400);
  }
  console.log(
    `  topocentric minimum: ${jdUtcToDate(topoTruthJd).toISOString()} (${(topoBest.rangeAu * 149597870.7).toFixed(1)} km)`,
  );

  console.log('\n[6/6] Cross-check our pipeline against observer truth');
  let overallMaxArcmin = 0;
  for (const entry of observers) {
    let siteMax = 0;
    let siteMaxAt = '';
    for (const sample of entry.samples) {
      const date = new Date(jdToMs(sample.jdUtc));
      const sky = computeTopocentric(ephem, entry.site, date);
      const sep = horizontalSeparationDeg(
        sky.azimuthDeg,
        sky.elevationDeg,
        sample.azimuthDeg,
        sample.elevationDeg,
      );
      const arcmin = sep * 60;
      if (arcmin > siteMax) {
        siteMax = arcmin;
        siteMaxAt = sample.utc;
      }
    }
    overallMaxArcmin = Math.max(overallMaxArcmin, siteMax);
    console.log(
      `  ${entry.site.name}: max az/el error ${siteMax.toFixed(3)} arcmin at ${siteMaxAt}`,
    );
  }
  console.log(`  OVERALL MAX: ${overallMaxArcmin.toFixed(3)} arcmin`);

  // ---- write files -------------------------------------------------------
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await mkdir(dirname(VALIDATION_PATH), { recursive: true });
  await writeFile(DATA_PATH, compactVectors(data, vectors));

  const validation = {
    schemaVersion: 1,
    retrievedAt: new Date().toISOString(),
    source: {
      provider: 'NASA/JPL Horizons',
      apiVersion: meta.apiVersion,
      horizonsClock: meta.clock,
      solution: meta.solution,
    },
    mainQuery: main.params,
    interpolation: {
      note:
        'Truth vectors are 30 s offset from the 60 s main grid, every 2 minutes. ' +
        'They are NOT used to build the app data; they only measure Hermite error.',
      query: interpResult.params,
      stepSeconds: 120,
      offsetSeconds: 30,
      maxPositionErrorKm,
      maxVelocityErrorKmS,
      samples: interpRows,
    },
    closestApproachTruth: {
      query: caTruthParams,
      refinedJdUtc: caTruthJd,
      refinedUtc: jdUtcToDate(caTruthJd).toISOString(),
      geocentricDistanceKm: caTruthBest.r,
      samples: caTruthRows,
    },
    observerTruth: observers,
    topocentricClosestApproachTruth: {
      site: brasov,
      coarseQuery: topoCoarseParams,
      query: topoFineParams,
      refinedJdUtc: topoTruthJd,
      refinedUtc: jdUtcToDate(topoTruthJd).toISOString(),
      rangeKm: topoBest.rangeAu * 149597870.7,
      samples: topoCaRows,
    },
    computedAtFetch: {
      closestApproachUtc: ca.utc.toISOString(),
      closestApproachJdTdb: ca.jdTdb,
      maxObserverErrorArcmin: overallMaxArcmin,
    },
  };
  await writeFile(VALIDATION_PATH, JSON.stringify(validation, null, 2) + '\n');

  console.log(`\nwrote ${DATA_PATH}`);
  console.log(`wrote ${VALIDATION_PATH}`);
  console.log(
    `\nSanity: CA UTC ${ca.utc.toISOString()} vs independent ${jdUtcToDate(caTruthJd).toISOString()}`,
  );
}

main().catch((error) => {
  console.error('\nFATAL:', error);
  process.exitCode = 1;
});
