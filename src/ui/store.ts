import type { ObserverLocation } from '../ephemeris/types';

export type ViewMode = 'sky' | 'space' | 'local' | 'ar';
export type LocationSource = 'geolocation' | 'manual' | 'fallback';
export type CalibrationSource = 'none' | 'manual' | 'sun' | 'moon' | 'planet' | 'star';

export interface CalibrationState {
  headingOffsetDeg: number;
  pitchOffsetDeg: number;
  fovXDeg: number;
  fovYDeg: number;
  source: CalibrationSource;
}

export interface UiState {
  /** Null until geolocation or a manual map pick resolves. */
  location: ObserverLocation | null;
  locationSource: LocationSource;
  /** UTC instant shown by the simulator; null until the ephemeris is loaded. */
  timeUtcMs: number | null;
  playing: boolean;
  /** Playback multiplier, 1..600. */
  speed: number;
  viewMode: ViewMode;
  nightMode: boolean;
  refraction: boolean;
  /** Visibly labelled "not to scale" marker. */
  enlargedMarker: boolean;
  calibration: CalibrationState;
  terrain: {
    eyeHeightM: number;
    searchRadiusKm: number;
    rooftopFloor: number | null;
  };
  selectedBestSpotId: string | null;
}

export const initialUiState: UiState = {
  location: null,
  locationSource: 'fallback',
  timeUtcMs: null,
  playing: false,
  speed: 60,
  viewMode: 'sky',
  nightMode: false,
  refraction: false,
  enlargedMarker: false,
  calibration: {
    headingOffsetDeg: 0,
    pitchOffsetDeg: 0,
    fovXDeg: 60,
    fovYDeg: 45,
    source: 'none',
  },
  terrain: {
    eyeHeightM: 1.7,
    searchRadiusKm: 3,
    rooftopFloor: null,
  },
  selectedBestSpotId: null,
};

export type UiListener = (state: Readonly<UiState>) => void;

/**
 * One typed store for every panel. No panel keeps private duplicate state;
 * panels subscribe here and call update(). Ephemeris/sky/terrain/AR modules
 * stay pure and receive explicit inputs.
 */
export class UiStore {
  private state: UiState;
  private readonly listeners = new Set<UiListener>();

  constructor(initial: UiState = initialUiState) {
    this.state = { ...initial };
  }

  getState(): Readonly<UiState> {
    return this.state;
  }

  update(patch: Partial<UiState>): Readonly<UiState> {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  subscribe(listener: UiListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
}

export const uiStore = new UiStore();
