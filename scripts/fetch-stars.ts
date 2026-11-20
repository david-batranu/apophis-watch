/**
 * Build the bundled bright-star + constellation-line catalogue.
 *
 * Stars:    HYG Database v4.4, CC BY-SA 4.0.
 * Lines:    Marc van der Sluys, ConstellationLines v1.4, CC BY 4.0.
 *
 * Both sources are pinned to immutable commits. The generated star file is a
 * derived database and is distributed under CC BY-SA 4.0; the constellation
 * line portions are CC BY 4.0. See public/data/README.md and the app credits.
 *
 * Run: npm run fetch:stars
 */
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConstellationLine,
  StarCatalogue,
  StarRecord,
} from '../src/sky/catalog';

const HYG_COMMIT = '53e3df311869e813ace5f1ad2ec4ce909f13256c';
const HYG_URL = `https://codeberg.org/astronexus/hyg/media/commit/${HYG_COMMIT}/data/hyg/CURRENT/hyg_v44.csv.gz`;
const LINES_COMMIT = '158ea7c588dd78a295dc977326e72ad29004d8eb';
const LINES_URL = `https://raw.githubusercontent.com/MarcvdSluys/ConstellationLines/${LINES_COMMIT}/ConstellationLines.dat`;
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/data/stars.json',
);
const README = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/data/README.md',
);
const MAG_LIMIT = 5;

interface HygRow {
  hr: number | null;
  hip: string;
  proper: string;
  bf: string;
  ra: number;
  dec: number;
  mag: number;
  ci: number | null;
}

/** Minimal RFC-4180 CSV parser: HYG fields contain commas and quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function number(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main(): Promise<void> {
  console.log('Downloading HYG v4.4 and ConstellationLines v1.4');
  const hygResponse = await fetch(HYG_URL, {
    headers: { 'User-Agent': 'ApophisWatch/0.1 (static astronomy build)' },
  });
  if (!hygResponse.ok) throw new Error(`HYG: HTTP ${hygResponse.status}`);
  const hygText = gunzipSync(
    Buffer.from(await hygResponse.arrayBuffer()),
  ).toString('utf8');
  const linesResponse = await fetch(LINES_URL, {
    headers: { 'User-Agent': 'ApophisWatch/0.1 (static astronomy build)' },
  });
  if (!linesResponse.ok) throw new Error(`ConstellationLines: HTTP ${linesResponse.status}`);
  const linesText = await linesResponse.text();

  const rows = parseCsv(hygText);
  const header = rows.shift();
  if (!header) throw new Error('HYG CSV has no header');
  const index = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`HYG CSV missing column ${name}`);
    return i;
  };
  const col = {
    id: index('id'),
    hip: index('hip'),
    hr: index('hr'),
    bf: index('bf'),
    proper: index('proper'),
    ra: index('ra'),
    dec: index('dec'),
    mag: index('mag'),
    ci: index('ci'),
  };

  const all: HygRow[] = [];
  for (const row of rows) {
    if (!row || row.length < header.length) continue;
    // HYG's `ra` column is hours (e.g. Sirius 6.752481 h), not degrees.
    const raHours = number(row[col.ra]);
    const ra = raHours === null ? null : raHours * 15;
    const dec = number(row[col.dec]);
    const mag = number(row[col.mag]);
    if (ra === null || dec === null || mag === null) continue;
    const hr = number(row[col.hr]);
    all.push({
      hr: hr === null ? null : Math.trunc(hr),
      hip: row[col.hip]?.trim() ?? '',
      proper: row[col.proper]?.trim() ?? '',
      bf: row[col.bf]?.trim() ?? '',
      ra,
      dec,
      mag,
      ci: number(row[col.ci]),
    });
  }

  const stars: StarRecord[] = [];
  for (const row of all) {
    // Sol has mag -26.7 and zero distance; it is not a sky star.
    if (row.hr === null && row.proper === 'Sol') continue;
    if (row.mag >= MAG_LIMIT) continue;
    const star: StarRecord = {
      id: row.hip || `${row.ra.toFixed(6)},${row.dec.toFixed(6)}`,
      raDeg: row.ra,
      decDeg: row.dec,
      mag: row.mag,
    };
    const name = row.proper || row.bf;
    if (name) star.name = name;
    if (row.ci !== null) star.colourIndex = row.ci;
    stars.push(star);
  }
  stars.sort((a, b) => a.mag - b.mag);

  const byHr = new Map<number, HygRow>();
  for (const row of all) if (row.hr !== null) byHr.set(row.hr, row);

  const constellations: ConstellationLine[] = [];
  const missingHrs: number[] = [];
  for (const rawLine of linesText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    const name = fields[0];
    const count = Number(fields[1]);
    if (!Number.isInteger(count) || count < 2) continue;
    const hrs = fields.slice(2, 2 + count).map((x) => Number(x));
    const segments: [number, number][][] = [];
    let current: [number, number][] = [];
    for (const hr of hrs) {
      const row = byHr.get(hr);
      if (!row) {
        missingHrs.push(hr);
        // Do not bridge across an absent vertex: close this polyline and
        // begin a new one at the next available star.
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }
      current.push([row.ra, row.dec]);
    }
    if (current.length >= 2) segments.push(current);
    if (segments.length > 0) constellations.push({ name, segments });
  }

  const payload: StarCatalogue = {
    metadata: {
      source:
        'HYG Database v4.4 (stars, commit 53e3df3) + ConstellationLines v1.4 (lines, commit 158ea7c)',
      license:
        'Stars: CC BY-SA 4.0. Constellation lines: CC BY 4.0. The combined stars.json is a derived database distributed under CC BY-SA 4.0.',
      attribution:
        'Star data: HYG Database v4.4, David Nash / Astronomy Nexus, CC BY-SA 4.0 (https://codeberg.org/astronexus/hyg). Based partly on Hipparcos (ESA). Constellation lines: Marc van der Sluys, ConstellationLines v1.4, CC BY 4.0 (https://github.com/MarcvdSluys/ConstellationLines, DOI 10.5281/zenodo.23210182). Changes: filtered stars to V < 5, converted to JSON, joined BSC HR line vertices to J2000 RA/Dec.',
      retrievedAt: new Date().toISOString(),
      magnitudeLimit: MAG_LIMIT,
      starCount: stars.length,
      constellationSource:
        'Marc van der Sluys, ConstellationLines v1.4 (BSC HR vertex lists)',
      constellationLicense: 'CC BY 4.0',
      notes:
        `J2000 RA/Dec in degrees. Stars are filtered to apparent magnitude < 5; constellation line vertices are joined from the full HYG table so faint line endpoints are preserved. ${missingHrs.length} BSC HR vertices (of 840) are absent from HYG v4.4; lines are split at those vertices rather than bridged.`,
    },
    stars,
    constellations,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload));
  const notice = `# Bundled star catalogue and constellation lines

## Stars — HYG Database v4.4

- Source: https://codeberg.org/astronexus/hyg
- Pinned commit: ${HYG_COMMIT}
- Licence: **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: David Nash / Astronomy Nexus, HYG Database v4.4.
- Changes: filtered to apparent magnitude < 5, reformatted as JSON.
- The derived star data in \`stars.json\` remains **CC BY-SA 4.0**.
- HYG is partly based on Hipparcos (ESA). ESA's Hipparcos catalogue is
  distributed under CC BY-NC 3.0 IGO; review that restriction before any
  commercial use.

## Constellation lines — ConstellationLines v1.4

- Source: https://github.com/MarcvdSluys/ConstellationLines
- Pinned commit: ${LINES_COMMIT}
- DOI: 10.5281/zenodo.23210182
- Licence: **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/)
- Copyright: Marc van der Sluys, 2005–2026.
- Changes: joined BSC HR-number vertices to J2000 RA/Dec from HYG and
  reformatted as JSON. Line vertices include stars fainter than V=5.

## Generated

- Retrieved: ${payload.metadata.retrievedAt}
- Stars: ${stars.length}; constellation polylines: ${constellations.length}
- Missing BSC HR line vertices: ${missingHrs.length} of 840 (lines are split there, not bridged)
- Combined file: ${(Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(1)} KiB
`;
  await writeFile(README, notice);
  console.log(
    `wrote ${OUT}: ${stars.length} stars, ${constellations.length} lines, missing HR vertices ${missingHrs.length}${missingHrs.length ? ` (${missingHrs.join(', ')})` : ''}`,
  );
  console.log(`wrote ${README}`);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exitCode = 1;
});
