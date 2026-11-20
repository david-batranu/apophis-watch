import type { EphemerisProvider, ObserverLocation } from '../ephemeris/types';
import type { StarCatalogue } from '../sky/catalog';
import type { SimulationSession } from '../state/session';
import type { UiState } from '../state/store';

/** The host app surface the terrain tab is allowed to use. */
export interface TerrainHostApi {
  getState(): Readonly<UiState>;
  subscribe(listener: (state: Readonly<UiState>) => void): () => void;
  getSession(): SimulationSession | null;
  getEphemeris(): EphemerisProvider | null;
  getCatalogue(): StarCatalogue | null;
  setObserver(lat: number, lon: number, groundElevationM?: number | null): void;
  setGroundElevationM(m: number): void;
  setTimeUtcMs(ms: number): void;
  setStatus(message: string | null): void;
  /**
   * Optional Phase 3 extension. The required API has no eye-height setter, so
   * the terrain tab keeps its own eye height and calls this when the host
   * implements it. Without it, floor/rooftop choices remain local to this tab.
   */
  setEyeHeightM?(m: number): void;
}

export interface TerrainWorkstream {
  mount(): void;
  unmount(): void;
  update(state: Readonly<UiState>): void;
}

export type TerrainObserverLocation = ObserverLocation;
