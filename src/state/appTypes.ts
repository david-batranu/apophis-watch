import type { StarCatalogue } from '../sky/catalog';

export interface PresetLocation {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  groundElevationM: number;
}

export const PRESETS: PresetLocation[] = [
  {
    id: 'brasov',
    name: 'Brasov, Romania',
    latitudeDeg: 45.6427,
    longitudeDeg: 25.5887,
    groundElevationM: 600,
  },
  {
    id: 'cape-town',
    name: 'Cape Town, South Africa',
    latitudeDeg: -33.9249,
    longitudeDeg: 18.4241,
    groundElevationM: 15,
  },
  {
    id: 'tenerife',
    name: 'Teide Observatory, Tenerife',
    latitudeDeg: 28.3006,
    longitudeDeg: -16.5106,
    groundElevationM: 2390,
  },
  {
    id: 'longyearbyen',
    name: 'Longyearbyen, Svalbard',
    latitudeDeg: 78.2232,
    longitudeDeg: 15.6469,
    groundElevationM: 10,
  },
];

/** Asynchronously loaded star/constellation data; UI degrades gracefully. */
export interface AppAssets {
  stars: StarCatalogue | null;
}

export interface AppModelOptions {
  baseUrl?: string;
  store: import('./store').UiStore;
}

export type AppAssetsLoader = (baseUrl: string) => Promise<StarCatalogue | null>;

export { SimulationSession } from './session';
