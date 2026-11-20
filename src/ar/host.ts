import type { EphemerisProvider } from '../ephemeris/types';
import type { StarCatalogue } from '../sky/catalog';
import type { SimulationSession } from '../state/session';
import type { UiState } from '../state/store';

/**
 * Host contract for the AR workstream. The orchestrator owns the clock,
 * observer, session, ephemeris and shared UI state; the AR module never
 * recomputes the Apophis ephemeris.
 */
export interface ArHostApi {
  getState(): Readonly<UiState>;
  subscribe(listener: (state: Readonly<UiState>) => void): () => void;
  getSession(): SimulationSession | null;
  getEphemeris(): EphemerisProvider | null;
  getCatalogue(): StarCatalogue | null;
  setTimeUtcMs(ms: number): void;
  setPlaying(playing: boolean): void;
  setStatus(message: string | null): void;
}

export interface ArWorkstream {
  mount(): void;
  unmount(): void;
  update(state: Readonly<UiState>): void;
}
