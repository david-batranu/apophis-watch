/**
 * Dev-only harness for the terrain tab. It is not imported by production and
 * exists so the map/DEM/Overpass/Three.js integration can be exercised in a
 * browser before the orchestrator adds the real tab.
 *
 * Open /src/terrain/dev.html from `npm run dev`.
 */

import '../styles.css';
import { TableEphemeris } from '../ephemeris/hermite';
import type { ApophisDataFile } from '../ephemeris/types';
import { SimulationSession } from '../state/session';
import {
  initialUiState,
  type ObserverConfig,
  type UiState,
} from '../state/store';
import type { StarCatalogue } from '../sky/catalog';
import { createTerrainWorkstream, type TerrainHostApi } from './index';

const root = document.getElementById('root');
const hostStatus = document.getElementById('host-status');
if (!root) throw new Error('missing #root');

const response = await fetch('/data/apophis-2029.json');
if (!response.ok) throw new Error(`ephemeris HTTP ${response.status}`);
const ephem = new TableEphemeris((await response.json()) as ApophisDataFile);

let observer: ObserverConfig = {
  latitudeDeg: 45.6427,
  longitudeDeg: 25.5887,
  groundElevationM: null,
  eyeHeightM: 1.7,
};
const toLocation = (): { latitudeDeg: number; longitudeDeg: number; elevationM: number } => ({
  latitudeDeg: observer.latitudeDeg,
  longitudeDeg: observer.longitudeDeg,
  elevationM: (observer.groundElevationM ?? 0) + observer.eyeHeightM,
});
let session = new SimulationSession(ephem, toLocation());
let state: UiState = {
  ...initialUiState,
  observer,
  locationSource: 'preset',
  locationStatus: 'Dev harness: Brasov preview.',
  utcMs: session.topocentricCa.utc.getTime(),
  dataWindowStartMs: session.windowStartMs,
  dataWindowEndMs: session.windowEndMs,
  ready: true,
};

const listeners = new Set<(state: Readonly<UiState>) => void>();
function emit(): void {
  for (const listener of listeners) listener(state);
}
function rebuildSession(): void {
  session = new SimulationSession(ephem, toLocation());
  state = {
    ...state,
    observer: { ...observer },
    utcMs:
      state.utcMs === null
        ? session.topocentricCa.utc.getTime()
        : Math.min(
            session.windowEndMs,
            Math.max(session.windowStartMs, state.utcMs),
          ),
    dataWindowStartMs: session.windowStartMs,
    dataWindowEndMs: session.windowEndMs,
  };
}

const api: TerrainHostApi = {
  getState: () => state,
  subscribe: (listener) => {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  },
  getSession: () => session,
  getEphemeris: () => ephem,
  getCatalogue: (): StarCatalogue | null => null,
  setObserver: (lat, lon, groundElevationM) => {
    observer = {
      ...observer,
      latitudeDeg: lat,
      longitudeDeg: lon,
      groundElevationM:
        groundElevationM === undefined
          ? observer.groundElevationM
          : groundElevationM,
    };
    rebuildSession();
    emit();
  },
  setGroundElevationM: (m) => {
    observer = { ...observer, groundElevationM: m };
    rebuildSession();
    emit();
  },
  setTimeUtcMs: (ms) => {
    state = {
      ...state,
      utcMs: Math.min(session.windowEndMs, Math.max(session.windowStartMs, ms)),
    };
    emit();
  },
  setStatus: (message) => {
    if (hostStatus) hostStatus.textContent = message ?? 'ready';
  },
  setEyeHeightM: (m) => {
    observer = { ...observer, eyeHeightM: m };
    rebuildSession();
    emit();
  },
};

const workstream = createTerrainWorkstream(root, api);
workstream.mount();
workstream.update(state);

// Dev-only hooks for browser smoke tests.
(window as unknown as {
  __terrainDev: {
    setNight: (night: boolean) => void;
    setTime: (ms: number) => void;
    setObserver: (lat: number, lon: number) => void;
  };
}).__terrainDev = {
  setNight: (night) => {
    state = { ...state, toggles: { ...state.toggles, nightMode: night } };
    emit();
  },
  setTime: (ms) => {
    state = { ...state, utcMs: ms };
    emit();
  },
  setObserver: (lat, lon) => {
    observer = { ...observer, latitudeDeg: lat, longitudeDeg: lon };
    rebuildSession();
    emit();
  },
};
