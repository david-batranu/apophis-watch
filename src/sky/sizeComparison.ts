/**
 * Angular sizes of familiar objects if they were placed at Apophis' current
 * distance. Physical sizes are sourced; angular sizes are calculated, never
 * hardcoded.
 */
export interface ComparisonObject {
  id: string;
  name: string;
  /** Physical size used for the comparison, metres. */
  sizeM: number;
  source: string;
  sourceUrl: string;
  note?: string;
}

export const COMPARISON_OBJECTS: ComparisonObject[] = [
  {
    id: 'moon',
    name: 'Moon',
    sizeM: 3_474_800,
    source: 'NASA Moon Fact Sheet (mean diameter 3,474.8 km)',
    sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    note: 'Shown as if it were at Apophis’ distance, not at its real 384,400 km.',
  },
  {
    id: 'apophis',
    name: 'Apophis',
    sizeM: 340,
    source: 'JPL Horizons: equivalent radius 0.170 km',
    sourceUrl: 'https://ssd.jpl.nasa.gov/api/horizons.api',
    note: '2 × 0.170 km.',
  },
  {
    id: 'eiffel',
    name: 'Eiffel Tower (height)',
    sizeM: 330,
    source: 'Eiffel Tower official: 330 m including antennas',
    sourceUrl: 'https://www.toureiffel.paris/en/the-monument/key-figures',
  },
  {
    id: 'football',
    name: 'Football pitch (length)',
    sizeM: 105,
    source: 'FIFA stadium guidelines / IFAB: recommended 105 m × 68 m',
    sourceUrl:
      'https://publications.fifa.com/de/football-stadiums-guidelines/technical-guideline/stadium-guidelines/pitch-dimensions-and-surrounding-areas/',
  },
  {
    id: 'iss',
    name: 'ISS (solar-array span)',
    sizeM: 109,
    source: 'NASA: ISS structure 109 m across the arrays',
    sourceUrl: 'https://www.nasa.gov/reference/international-space-station/',
  },
];

/** Small-angle angular diameter in arcseconds for a size in metres at distance km. */
export function angularDiameterArcsec(sizeM: number, distanceKm: number): number {
  if (!(sizeM > 0) || !(distanceKm > 0)) {
    throw new RangeError('size and distance must be positive');
  }
  // Exact: 2 atan(radius/distance), converted radians -> arcseconds.
  return (2 * Math.atan(sizeM / 2000 / distanceKm) * 180 * 3600) / Math.PI;
}

export interface ComparisonRow extends ComparisonObject {
  angularArcsec: number;
  relativeToApophis: number;
}

export function comparisonAtDistance(distanceKm: number): ComparisonRow[] {
  const apophis = angularDiameterArcsec(
    COMPARISON_OBJECTS.find((o) => o.id === 'apophis')!.sizeM,
    distanceKm,
  );
  return COMPARISON_OBJECTS.map((object) => {
    const angularArcsec = angularDiameterArcsec(object.sizeM, distanceKm);
    return {
      ...object,
      angularArcsec,
      relativeToApophis: angularArcsec / apophis,
    };
  });
}
