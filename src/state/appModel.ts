import { TableEphemeris } from '../ephemeris/hermite';
import type { ApophisDataFile } from '../ephemeris/types';
import {
  loadStarCatalogue,
  validateStarCatalogue,
  type StarCatalogue,
} from '../sky/catalog';
import {
  isInsidePreparedArea,
  loadPreparedSnapshot,
  type OfflineSnapshot,
} from '../offline/snapshot';
import { SimulationSession, type JumpTarget } from './session';
import {
  effectiveElevationM,
  toObserverLocation,
  uiStore,
  type DisplayToggles,
  type LocationSource,
  type ObserverConfig,
  type OfflineUiState,
  type UiState,
  type UiStore,
  type ViewMode,
} from './store';
import { PRESETS, type PresetLocation } from './appTypes';

export interface EphemerisSourceInfo {
  provider: string;
  solution: string;
  retrievedAt: string;
  queryUrl: string | null;
  activeSource: 'built-in' | 'prepared';
  preparedAt: number | null;
}

export class OfflineUnavailableError extends Error {
  constructor() {
    super(
      'No offline area is prepared. Connect to the internet, open Local 3D and use “Prepare for offline”, then try again.',
    );
    this.name = 'OfflineUnavailableError';
  }
}

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
  private dataFile: ApophisDataFile | null = null;
  private session: SimulationSession | null = null;
  private catalogue: StarCatalogue | null = null;
  private geolocationRequested = false;
  private offlineSnapshot: OfflineSnapshot | null = null;
  private usingOfflineData = false;

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
    if (this.usingOfflineData) {
      this.store.update({
        locationStatus:
          'Browser location is not used offline. Set coordinates manually or reconnect.',
      });
      return;
    }
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

  getOfflineSnapshot(): OfflineSnapshot | null {
    return this.offlineSnapshot;
  }

  isUsingOfflineData(): boolean {
    return this.usingOfflineData;
  }

  getEphemerisSource(): EphemerisSourceInfo | null {
    if (!this.dataFile) return null;
    return {
      provider: this.dataFile.source.provider,
      solution: this.dataFile.target.solution,
      retrievedAt: this.dataFile.source.retrievedAt,
      queryUrl: this.dataFile.source.queryUrl ?? null,
      activeSource: this.usingOfflineData ? 'prepared' : 'built-in',
      preparedAt: this.offlineSnapshot?.preparedAt ?? null,
    };
  }

  async init(): Promise<AppModelInitResult> {
    this.offlineSnapshot = await loadPreparedSnapshot();
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    let data: ApophisDataFile;

    if (online) {
      try {
        const response = await fetch(`${this.baseUrl}data/apophis-2029.json`, {
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!response.ok) {
          throw new Error(`Ephemeris fetch failed: HTTP ${response.status}`);
        }
        data = (await response.json()) as ApophisDataFile;
      } catch (error) {
        if (!this.offlineSnapshot) throw error;
        data = JSON.parse(this.offlineSnapshot.ephemeris.text) as ApophisDataFile;
        this.usingOfflineData = true;
      }
    } else {
      if (!this.offlineSnapshot) throw new OfflineUnavailableError();
      data = JSON.parse(this.offlineSnapshot.ephemeris.text) as ApophisDataFile;
      this.usingOfflineData = true;
    }

    this.dataFile = data;
    this.ephem = new TableEphemeris(data);
    const snapshot = this.offlineSnapshot;
    const urlObserver = this.observerFromUrl();
    const fallback = this.observerFromPreset(PRESETS[0]);
    const offlineObserver = snapshot
      ? {
          latitudeDeg: snapshot.area.latitudeDeg,
          longitudeDeg: snapshot.area.longitudeDeg,
          groundElevationM: snapshot.area.groundElevationM,
          eyeHeightM: snapshot.area.eyeHeightM,
        }
      : null;
    const observer = this.usingOfflineData
      ? urlObserver ?? offlineObserver ?? fallback
      : urlObserver ?? fallback;
    const source: LocationSource = this.usingOfflineData
      ? 'offline'
      : urlObserver
        ? 'url'
        : 'fallback';
    const status = this.usingOfflineData
      ? this.offlineLocationStatus(observer, urlObserver !== null)
      : urlObserver
        ? 'Observer set from URL parameters.'
        : 'Locating you… showing Brasov preview. You can set a location manually.';
    this.applyObserver(observer, source, status, false);

    if (this.usingOfflineData && snapshot?.stars) {
      try {
        this.catalogue = validateStarCatalogue(
          JSON.parse(snapshot.stars.text) as unknown,
        );
      } catch {
        this.catalogue = null;
      }
    } else {
      this.catalogue = await loadStarCatalogue(this.baseUrl);
    }
    this.store.update({ ready: true });
    this.refreshOfflineState();

    if (!urlObserver && !this.usingOfflineData) {
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
    if (view === 'space' || view === 'sky' || view === 'local' || view === 'ar') {
      this.setViewMode(view);
    }
    if (params.get('refraction') === '0') this.setToggle('refraction', false);
    if (params.get('night') === '1') this.setToggle('nightMode', true);
    if (params.get('constellations') === '0') this.setToggle('constellations', false);
    if (params.get('enlarged') === '1') this.setToggle('enlargedMarker', true);
    const minEl = Number(params.get('minEl'));
    if (Number.isFinite(minEl)) this.setMinGoodElevation(minEl);

    return { catalogue: this.catalogue };
  }

  private offlineLocationStatus(
    observer: ObserverConfig,
    fromUrl: boolean,
  ): string {
    const snapshot = this.offlineSnapshot;
    if (!snapshot) return 'Offline mode: no prepared area.';
    const inside = isInsidePreparedArea(
      snapshot,
      observer.latitudeDeg,
      observer.longitudeDeg,
    );
    if (!inside) {
      return `Offline: this location is not prepared. Terrain, buildings and the offline base map are only available near ${snapshot.area.label}. Sky and AR still work for the selected coordinates.`;
    }
    return `Offline: using the prepared area ${snapshot.area.label}${
      fromUrl ? ' (URL coordinates)' : ''
    }. Prepared ${new Date(snapshot.preparedAt).toISOString()}.`;
  }

  /** Called by the terrain tab after Prepare/Clear. */
  setOfflineSnapshot(snapshot: OfflineSnapshot | null): void {
    this.offlineSnapshot = snapshot;
    this.refreshOfflineState();
  }

  private refreshOfflineState(): void {
    const snapshot = this.offlineSnapshot;
    const state = this.store.getState();
    const observer = state.observer;
    const mismatch =
      this.usingOfflineData && snapshot && observer
        ? !isInsidePreparedArea(
            snapshot,
            observer.latitudeDeg,
            observer.longitudeDeg,
          )
        : false;
    const offline: OfflineUiState = {
      active: this.usingOfflineData,
      preparedAt: snapshot?.preparedAt ?? null,
      areaLabel: snapshot?.area.label ?? null,
      areaLatDeg: snapshot?.area.latitudeDeg ?? null,
      areaLonDeg: snapshot?.area.longitudeDeg ?? null,
      areaRadiusM: snapshot?.area.terrainRadiusM ?? null,
      searchRadiusM: snapshot?.area.searchRadiusM ?? null,
      mismatch,
      message: this.usingOfflineData
        ? mismatch
          ? `Offline: terrain and buildings are only prepared for ${snapshot?.area.label ?? 'one area'}. Sky and AR still work here.`
          : `Offline: all sky/AR data and the prepared terrain area are available. Prepared ${new Date(
              snapshot?.preparedAt ?? Date.now(),
            ).toISOString()}.`
        : null,
    };
    this.store.update({ offline });
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
    this.refreshOfflineState();
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
    this.store.update({ viewMode: mode, auxStatus: null });
  }

  setToggle<K extends keyof DisplayToggles>(key: K, value: DisplayToggles[K]): void {
    this.store.updateToggles({ [key]: value } as Partial<DisplayToggles>);
  }

  setMinGoodElevation(deg: number): void {
    this.store.update({ minGoodElevationDeg: Math.min(90, Math.max(0, deg)) });
  }

  /**
   * Shared adapter for the terrain workstream: move the observer, keeping the
   * clock and the rest of the UI state intact. Returns an error string or null.
   */
  setObserverFromExternal(
    latitudeDeg: number,
    longitudeDeg: number,
    groundElevationM: number | null = null,
  ): string | null {
    if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
      return 'Latitude must be between -90 and 90 degrees.';
    }
    if (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
      return 'Longitude must be between -180 and 180 degrees.';
    }
    if (
      groundElevationM !== null &&
      (!Number.isFinite(groundElevationM) ||
        groundElevationM < -500 ||
        groundElevationM > 9000)
    ) {
      return 'Ground elevation must be between -500 and 9000 m.';
    }
    const current = this.store.getState().observer;
    this.applyObserver(
      {
        latitudeDeg,
        longitudeDeg,
        groundElevationM,
        eyeHeightM: current?.eyeHeightM ?? 1.7,
      },
      'manual',
      'Observer moved from the terrain/map panel.',
    );
    return null;
  }

  setGroundElevationM(elevationM: number): void {
    const current = this.store.getState().observer;
    if (!current || !Number.isFinite(elevationM)) return;
    this.applyObserver(
      {
        ...current,
        groundElevationM: Math.min(9000, Math.max(-500, elevationM)),
      },
      this.store.getState().locationSource,
      `Ground elevation ${elevationM.toFixed(1)} m from the terrain DEM; eye height ${current.eyeHeightM.toFixed(1)} m.`,
    );
  }

  setEyeHeightM(eyeHeightM: number): void {
    const current = this.store.getState().observer;
    if (!current || !Number.isFinite(eyeHeightM)) return;
    const clamped = Math.min(100, Math.max(0, eyeHeightM));
    this.applyObserver(
      { ...current, eyeHeightM: clamped },
      this.store.getState().locationSource,
      `Eye height ${clamped.toFixed(1)} m above ground; no terrain occlusion in the shared sky readout.`,
    );
  }

  setStatus(message: string | null): void {
    this.store.update({ auxStatus: message });
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
