import type { ObserverLocation } from '../ephemeris/types';

export type ViewMode = 'sky' | 'space';
export type LocationSource = 'geolocation' | 'manual' | 'preset' | 'url' | 'fallback';

export interface ObserverConfig {
  latitudeDeg: number;
  longitudeDeg: number;
  /**
   * Ground elevation above sea level. Null means unknown; we then assume 0 m
   * and say so in the UI. GPS altitude is never used.
   */
  groundElevationM: number | null;
  /** Eye height above the ground. Phase 3 replaces the flat-ground assumption. */
  eyeHeightM: number;
}

export interface DisplayToggles {
  constellations: boolean;
  /** Display-only Bennett refraction. Validation remains airless. */
  refraction: boolean;
  enlargedMarker: boolean;
  nightMode: boolean;
}

export interface UiState {
  utcMs: number | null;
  playing: boolean;
  /** Playback multiplier, 1..600. */
  speed: number;
  observer: ObserverConfig | null;
  locationSource: LocationSource;
  locationStatus: string;
  viewMode: ViewMode;
  toggles: DisplayToggles;
  /** UI-only "good viewing" threshold; Phase 1 physical visibility is unchanged. */
  minGoodElevationDeg: number;
  timeZone: string;
  dataWindowStartMs: number | null;
  dataWindowEndMs: number | null;
  ready: boolean;
  error: string | null;
}

export function effectiveElevationM(observer: ObserverConfig): number {
  return (observer.groundElevationM ?? 0) + observer.eyeHeightM;
}

export function toObserverLocation(observer: ObserverConfig): ObserverLocation {
  return {
    latitudeDeg: observer.latitudeDeg,
    longitudeDeg: observer.longitudeDeg,
    elevationM: effectiveElevationM(observer),
  };
}

export const initialUiState: UiState = {
  utcMs: null,
  playing: false,
  speed: 60,
  observer: null,
  locationSource: 'fallback',
  locationStatus: 'Waiting for location.',
  viewMode: 'sky',
  toggles: {
    constellations: true,
    refraction: true,
    enlargedMarker: false,
    nightMode: false,
  },
  minGoodElevationDeg: 10,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  dataWindowStartMs: null,
  dataWindowEndMs: null,
  ready: false,
  error: null,
};

export type UiListener = (state: Readonly<UiState>) => void;

/**
 * The single source of truth for UI state. Panels subscribe here; they do not
 * keep duplicate location/time/toggle state. Derived astronomy lives in
 * SimulationSession/AppModel, not in this store.
 */
export class UiStore {
  private state: UiState;
  private readonly listeners = new Set<UiListener>();

  constructor(initial: UiState = initialUiState) {
    this.state = {
      ...initial,
      toggles: { ...initial.toggles },
    };
  }

  getState(): Readonly<UiState> {
    return this.state;
  }

  update(patch: Partial<UiState>): Readonly<UiState> {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  updateToggles(patch: Partial<DisplayToggles>): Readonly<UiState> {
    return this.update({ toggles: { ...this.state.toggles, ...patch } });
  }

  subscribe(listener: UiListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
}

export const uiStore = new UiStore();
