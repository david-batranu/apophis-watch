import { TableEphemeris } from '../ephemeris/hermite';
import type { ApophisDataFile } from '../ephemeris/types';
import { loadStarCatalogue, type StarCatalogue } from '../sky/catalog';
import { SimulationSession, type JumpTarget } from './session';
import {
  effectiveElevationM,
  toObserverLocation,
  uiStore,
  type DisplayToggles,
  type LocationSource,
  type ObserverConfig,
  type UiState,
  type UiStore,
  type ViewMode,
} from './store';
import { PRESETS, type PresetLocation } from './appTypes';

export interface ManualObserverInput {
  latitudeDeg: number;
  longitudeDeg: number;
  groundElevationM: number | null;
  eyeHeightM: number;
}

export interface AppModelInitResult {
  catalogue: StarCatalogue | null;
}

/**
 * Browser-facing application model. It owns the loaded ephemeris/session and
 * translates user intents into store changes. DOM handlers call these methods;
 * they never compute astronomy themselves.
 */
export class AppModel {
  private readonly store: UiStore;
  private readonly baseUrl: string;
  private ephem: TableEphemeris | null = null;
  private session: SimulationSession | null = null;
  private catalogue: StarCatalogue | null = null;
  private geolocationRequested = false;

  constructor(store: UiStore = uiStore, baseUrl = import.meta.env.BASE_URL) {
    this.store = store;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  getSession(): SimulationSession | null {
    return this.session;
  }

  getState(): Readonly<UiState> {
    return this.store.getState();
  }

  onState(listener: (state: Readonly<UiState>) => void): () => void {
    return this.store.subscribe(listener);
  }

  useBrowserLocation(): void {
    this.geolocationRequested = false;
    this.store.update({ locationStatus: 'Requesting browser location…' });
    this.requestGeolocation();
  }

  getEphemeris(): TableEphemeris | null {
    return this.ephem;
  }

  getCatalogue(): StarCatalogue | null {
    return this.catalogue;
  }

  async init(): Promise<AppModelInitResult> {
    const response = await fetch(`${this.baseUrl}data/apophis-2029.json`);
    if (!response.ok) throw new Error(`Ephemeris fetch failed: HTTP ${response.status}`);
    const data = (await response.json()) as ApophisDataFile;
    this.ephem = new TableEphemeris(data);

    const urlObserver = this.observerFromUrl();
    const fallback = this.observerFromPreset(PRESETS[0]);
    this.applyObserver(
      urlObserver ?? fallback,
      urlObserver ? 'url' : 'fallback',
      urlObserver
        ? 'Observer set from URL parameters.'
        : 'Locating you… showing Brasov preview. You can set a location manually.',
      false,
    );

    this.catalogue = await loadStarCatalogue(this.baseUrl);
    this.store.update({ ready: true });

    if (!urlObserver) {
      this.requestGeolocation();
    }

    const urlUtc = this.urlUtc();
    if (urlUtc !== null) {
      this.setUtc(urlUtc);
    } else if (this.session) {
      this.setUtc(this.session.topocentricCa.utc.getTime());
    }

    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'space' || view === 'sky') this.setViewMode(view);
    if (params.get('refraction') === '0') this.setToggle('refraction', false);
    if (params.get('night') === '1') this.setToggle('nightMode', true);
    if (params.get('constellations') === '0') this.setToggle('constellations', false);
    if (params.get('enlarged') === '1') this.setToggle('enlargedMarker', true);
    const minEl = Number(params.get('minEl'));
    if (Number.isFinite(minEl)) this.setMinGoodElevation(minEl);

    return { catalogue: this.catalogue };
  }

  private observerFromUrl(): ObserverConfig | null {
    const params = new URLSearchParams(window.location.search);
    const presetId = params.get('preset');
    if (presetId) {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (preset) return this.observerFromPreset(preset);
    }
    const lat = Number(params.get('lat'));
    const lon = Number(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const elevRaw = params.get('elev');
    const eyeRaw = params.get('eye');
    const groundElevationM =
      elevRaw === null || elevRaw.trim() === '' ? null : Number(elevRaw);
    const eyeHeightM = eyeRaw === null ? 1.7 : Number(eyeRaw);
    return {
      latitudeDeg: lat,
      longitudeDeg: lon,
      groundElevationM:
        groundElevationM !== null && Number.isFinite(groundElevationM)
          ? groundElevationM
          : null,
      eyeHeightM: Number.isFinite(eyeHeightM) ? eyeHeightM : 1.7,
    };
  }

  private urlUtc(): number | null {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('utc');
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }

  private observerFromPreset(preset: PresetLocation): ObserverConfig {
    return {
      latitudeDeg: preset.latitudeDeg,
      longitudeDeg: preset.longitudeDeg,
      groundElevationM: preset.groundElevationM,
      eyeHeightM: 1.7,
    };
  }

  private applyObserver(
    observer: ObserverConfig,
    source: LocationSource,
    status: string,
    preserveTime = true,
  ): void {
    if (!this.ephem) return;
    const previous = this.store.getState();
    const session = new SimulationSession(this.ephem, toObserverLocation(observer));
    this.session = session;

    const current = previous.utcMs;
    const inside =
      current !== null &&
      current >= session.windowStartMs &&
      current <= session.windowEndMs;
    const utcMs = preserveTime && inside ? current : session.topocentricCa.utc.getTime();

    this.store.update({
      observer,
      locationSource: source,
      locationStatus: status,
      dataWindowStartMs: session.windowStartMs,
      dataWindowEndMs: session.windowEndMs,
      utcMs,
      ready: true,
      error: null,
    });
  }

  private requestGeolocation(): void {
    if (this.geolocationRequested) return;
    this.geolocationRequested = true;
    if (!('geolocation' in navigator)) {
      this.store.update({
        locationStatus:
          'Geolocation is unavailable. Using the Brasov preview; set coordinates or a preset.',
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.applyObserver(
          {
            latitudeDeg: position.coords.latitude,
            longitudeDeg: position.coords.longitude,
            groundElevationM: null,
            eyeHeightM: 1.7,
          },
          'geolocation',
          'Using browser location. GPS altitude ignored; eye height 1.7 m above unknown ground (no terrain data).',
        );
      },
      () => {
        this.store.update({
          locationStatus:
            'Location permission denied or unavailable. Using the Brasov preview; set coordinates or choose a preset.',
        });
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 600_000 },
    );
  }

  setPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.applyObserver(
      this.observerFromPreset(preset),
      'preset',
      `${preset.name} preset. Ground elevation ${preset.groundElevationM} m + eye height; no terrain data.`,
    );
  }

  /** Returns a validation error, or null on success. */
  setManualObserver(input: ManualObserverInput): string | null {
    if (!Number.isFinite(input.latitudeDeg) || input.latitudeDeg < -90 || input.latitudeDeg > 90) {
      return 'Latitude must be between -90 and 90 degrees.';
    }
    if (!Number.isFinite(input.longitudeDeg) || input.longitudeDeg < -180 || input.longitudeDeg > 180) {
      return 'Longitude must be between -180 and 180 degrees.';
    }
    if (!Number.isFinite(input.eyeHeightM) || input.eyeHeightM < 0 || input.eyeHeightM > 100) {
      return 'Eye height must be between 0 and 100 m.';
    }
    if (
      input.groundElevationM !== null &&
      (!Number.isFinite(input.groundElevationM) || input.groundElevationM < -500 || input.groundElevationM > 9000)
    ) {
      return 'Ground elevation must be between -500 and 9000 m, or left blank.';
    }
    this.applyObserver(
      {
        latitudeDeg: input.latitudeDeg,
        longitudeDeg: input.longitudeDeg,
        groundElevationM: input.groundElevationM,
        eyeHeightM: input.eyeHeightM,
      },
      'manual',
      `Manual location. Ground elevation ${
        input.groundElevationM === null ? 'unknown (0 m assumed)' : `${input.groundElevationM} m`
      } + ${input.eyeHeightM.toFixed(1)} m eye height; no terrain data.`,
    );
    return null;
  }

  setUtc(ms: number): void {
    const session = this.session;
    if (!session || !Number.isFinite(ms)) return;
    const clamped = Math.min(session.windowEndMs, Math.max(session.windowStartMs, ms));
    const outside = Math.abs(clamped - ms) > 1;
    const atEnd = clamped >= session.windowEndMs;
    this.store.update({
      utcMs: clamped,
      error: outside
        ? 'Requested time is outside the committed ±24 h data window; clamped.'
        : atEnd && this.store.getState().playing
          ? 'Reached the end of the data window.'
          : null,
      playing: atEnd ? false : this.store.getState().playing,
    });
  }

  advance(dtMs: number): void {
    const state = this.store.getState();
    if (!state.playing || state.utcMs === null) return;
    this.setUtc(state.utcMs + dtMs * state.speed);
  }

  setPlaying(playing: boolean): void {
    const state = this.store.getState();
    if (state.utcMs === null) return;
    if (playing && state.utcMs >= (state.dataWindowEndMs ?? Infinity)) {
      this.setUtc(state.dataWindowStartMs ?? state.utcMs);
    }
    this.store.update({ playing, error: null });
  }

  setSpeed(speed: number): void {
    this.store.update({ speed: Math.min(600, Math.max(1, speed)) });
  }

  setViewMode(mode: ViewMode): void {
    this.store.update({ viewMode: mode });
  }

  setToggle<K extends keyof DisplayToggles>(key: K, value: DisplayToggles[K]): void {
    this.store.updateToggles({ [key]: value } as Partial<DisplayToggles>);
  }

  setMinGoodElevation(deg: number): void {
    this.store.update({ minGoodElevationDeg: Math.min(90, Math.max(0, deg)) });
  }

  jumpTo(target: JumpTarget): void {
    const session = this.session;
    if (!session) return;
    const ms = session.jumpTarget(target);
    if (ms === null) {
      this.store.update({ error: `No ${target} available for this observer in the data window.` });
      return;
    }
    this.setUtc(ms);
  }

  /** Four-decimal location summary for the UI. */
  observerSummary(): string {
    const observer = this.store.getState().observer;
    if (!observer) return 'No observer set';
    return `${observer.latitudeDeg.toFixed(4)}°, ${observer.longitudeDeg.toFixed(4)}°, ${effectiveElevationM(observer).toFixed(1)} m effective`;
  }
}
