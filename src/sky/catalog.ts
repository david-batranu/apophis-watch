export interface StarRecord {
  id: string;
  /** J2000 right ascension, degrees. */
  raDeg: number;
  /** J2000 declination, degrees. */
  decDeg: number;
  /** Apparent visual magnitude. */
  mag: number;
  name?: string;
  /** Optional B-V colour index, if the source provides it. */
  colourIndex?: number;
}

export interface ConstellationLine {
  name: string;
  /** Polylines as [RA degrees, Dec degrees] points (J2000). */
  segments: [number, number][][];
}

export interface StarCatalogueMetadata {
  source: string;
  license: string;
  attribution: string;
  retrievedAt: string;
  magnitudeLimit: number;
  starCount: number;
  constellationSource?: string;
  constellationLicense?: string;
  notes?: string;
}

export interface StarCatalogue {
  metadata: StarCatalogueMetadata;
  stars: StarRecord[];
  constellations: ConstellationLine[];
}

export function validateStarCatalogue(value: unknown): StarCatalogue {
  if (!value || typeof value !== 'object') throw new Error('star catalogue is not an object');
  const c = value as StarCatalogue;
  if (!Array.isArray(c.stars) || !Array.isArray(c.constellations)) {
    throw new Error('star catalogue missing stars/constellations');
  }
  for (const star of c.stars) {
    if (
      !star ||
      typeof star.id !== 'string' ||
      !Number.isFinite(star.raDeg) ||
      !Number.isFinite(star.decDeg) ||
      !Number.isFinite(star.mag)
    ) {
      throw new Error('malformed star record');
    }
    if (star.raDeg < 0 || star.raDeg >= 360 || star.decDeg < -90 || star.decDeg > 90) {
      throw new Error(`star ${star.id} has out-of-range coordinates`);
    }
  }
  for (const constellation of c.constellations) {
    if (!constellation.name || !Array.isArray(constellation.segments)) {
      throw new Error('malformed constellation entry');
    }
    for (const segment of constellation.segments) {
      if (!Array.isArray(segment) || segment.length < 2) {
        throw new Error(`constellation ${constellation.name} has a short segment`);
      }
      for (const point of segment) {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) ||
          point[0] < 0 ||
          point[0] >= 360 ||
          point[1] < -90 ||
          point[1] > 90
        ) {
          throw new Error(`constellation ${constellation.name} has an invalid point`);
        }
      }
    }
  }
  return c;
}

export async function loadStarCatalogue(baseUrl: string): Promise<StarCatalogue | null> {
  try {
    const response = await fetch(`${baseUrl}data/stars.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return validateStarCatalogue(await response.json());
  } catch (error) {
    console.warn('Star catalogue unavailable:', error);
    return null;
  }
}
