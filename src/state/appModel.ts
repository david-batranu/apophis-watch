import { TableEphemeris } from '../ephemeris/hermite';
import type { ApophisDataFile } from '../ephemeris/types';
import { t } from '../i18n';
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
import {
  defaultPreferences,
  loadPreferences,
  savePreferences,
  type StoredPreferences,
} from './preferences';
import { PRESETS, type PresetLocation } from './appTypes';

type InitialLocationSource =
  | 'url'
  | 'stored'
  | 'offline'
  | 'geolocation'
  | 'fallback';

const VIEW_MODES: ViewMode[] = ['sky', 'space', 'local', 'ar'];

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
    super(t('location.offlineUnavailable'));
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
  private preferences: StoredPreferences = defaultPreferences();
  private initializing = true;
  private initialLocationSource: InitialLocationSource = 'fallback';
  private persistTimer: number | null = null;

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

  useBrowserLocation(onResult?: (ok: boolean) => void): void {
    if (this.usingOfflineData) {
      this.store.update({
        locationStatus: t('location.browserOffline'),
      });
      onResult?.(false);
      return;
    }
    this.geolocationRequested = false;
    this.store.update({ locationStatus: t('location.requesting') });
    this.requestGeolocation(onResult);
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
          throw new Error(
            t('location.ephemerisFetchFailed', { status: response.status }),
          );
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

    this.preferences = loadPreferences();
    this.store.updateToggles(this.preferences.toggles);
    this.store.update({
      minGoodElevationDeg: this.preferences.minGoodElevationDeg,
    });

    const snapshot = this.offlineSnapshot;
    const urlObserver = this.observerFromUrl();
    const storedObserver = this.preferences.observer;
    const fallback = this.observerFromPreset(PRESETS[0]);
    const offlineObserver = snapshot
      ? {
          latitudeDeg: snapshot.area.latitudeDeg,
          longitudeDeg: snapshot.area.longitudeDeg,
          groundElevationM: snapshot.area.groundElevationM,
          eyeHeightM: snapshot.area.eyeHeightM,
        }
      : null;
    // If this origin already has location permission, start at the user's
    // actual location without showing a permission prompt. First-time visitors
    // still get the explicit location card.
    const autoObserver =
      !this.usingOfflineData && !urlObserver && !storedObserver
        ? await this.defaultBrowserObserver()
        : null;
    const observer = this.usingOfflineData
      ? urlObserver ?? offlineObserver ?? fallback
      : urlObserver ?? storedObserver ?? autoObserver ?? fallback;
    const source: LocationSource = this.usingOfflineData
      ? 'offline'
      : urlObserver
        ? 'url'
        : storedObserver
          ? 'manual'
          : autoObserver
            ? 'geolocation'
            : 'fallback';
    this.initialLocationSource = this.usingOfflineData
      ? 'offline'
      : urlObserver
        ? 'url'
        : storedObserver
          ? 'stored'
          : autoObserver
            ? 'geolocation'
            : 'fallback';
    const status = this.usingOfflineData
      ? this.offlineLocationStatus(observer, urlObserver !== null)
      : urlObserver
        ? t('location.fromUrl')
        : storedObserver
          ? t('location.restoredStatus')
          : autoObserver
            ? t('location.usingBrowser')
            : t('location.previewStatus');
    this.applyObserver(observer, source, status, false, false);

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

    const urlUtc = this.urlUtc();
    if (urlUtc !== null) {
      this.setUtc(urlUtc);
    } else if (this.session) {
      this.setUtc(this.session.topocentricCa.utc.getTime());
    }

    const params = new URLSearchParams(window.location.search);
    const urlView = params.get('view');
    const initialView =
      urlView && VIEW_MODES.includes(urlView as ViewMode)
        ? (urlView as ViewMode)
        : this.preferences.viewMode;
    this.setViewMode(initialView);
    if (params.get('refraction') === '0') this.setToggle('refraction', false);
    if (params.get('night') === '1') this.setToggle('nightMode', true);
    if (params.get('constellations') === '0') this.setToggle('constellations', false);
    if (params.get('enlarged') === '1') this.setToggle('enlargedMarker', true);
    const minElRaw = params.get('minEl');
    if (minElRaw !== null && minElRaw.trim() !== '') {
      const minEl = Number(minElRaw);
      if (Number.isFinite(minEl)) this.setMinGoodElevation(minEl);
    }

    this.initializing = false;
    return { catalogue: this.catalogue };
  }

  private offlineLocationStatus(
    observer: ObserverConfig,
    fromUrl: boolean,
  ): string {
    const snapshot = this.offlineSnapshot;
    if (!snapshot) return t('location.offlineNoPreparedArea');
    const inside = isInsidePreparedArea(
      snapshot,
      observer.latitudeDeg,
      observer.longitudeDeg,
    );
    if (!inside) {
      return t('location.offlineNotPrepared', {
        area: snapshot.area.label,
      });
    }
    return t('location.offlineUsingPrepared', {
      area: snapshot.area.label,
      urlSuffix: fromUrl ? t('location.offlineUrlSuffix') : '',
      preparedAt: new Date(snapshot.preparedAt).toISOString(),
    });
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
          ? t('location.offlineMismatch', {
              area: snapshot?.area.label ?? t('location.offlineOneArea'),
            })
          : t('location.offlineAllAvailable', {
              preparedAt: new Date(
                snapshot?.preparedAt ?? Date.now(),
              ).toISOString(),
            })
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
    const latRaw = params.get('lat');
    const lonRaw = params.get('lon');
    if (
      latRaw === null ||
      latRaw.trim() === '' ||
      lonRaw === null ||
      lonRaw.trim() === ''
    ) {
      return null;
    }
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
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
    persistObserver = true,
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
    if (!this.initializing) {
      if (persistObserver) {
        this.preferences.observer = { ...observer };
        this.preferences.locationPromptDismissed = true;
      }
      this.persistPreferences();
    }
  }

  /**
   * Use the browser location only when permission was already granted.
   * Never trigger a permission prompt during startup.
   */
  private async defaultBrowserObserver(): Promise<ObserverConfig | null> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return null;
    }
    try {
      if (
        !navigator.permissions ||
        typeof navigator.permissions.query !== 'function'
      ) {
        return null;
      }
      const permission = await navigator.permissions.query({
        name: 'geolocation',
      });
      if (permission.state !== 'granted') return null;
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 3_500);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          window.clearTimeout(timer);
          resolve({
            latitudeDeg: position.coords.latitude,
            longitudeDeg: position.coords.longitude,
            groundElevationM: null,
            eyeHeightM: 1.7,
          });
        },
        () => {
          window.clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 3_000, maximumAge: 600_000 },
      );
    });
  }

  private requestGeolocation(onResult?: (ok: boolean) => void): void {
    if (this.geolocationRequested) return;
    this.geolocationRequested = true;
    if (!('geolocation' in navigator)) {
      this.store.update({
        locationStatus: t('location.geolocationUnavailable'),
      });
      onResult?.(false);
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
          t('location.usingBrowser'),
        );
        onResult?.(true);
      },
      () => {
        this.store.update({
          locationStatus: t('location.denied'),
        });
        onResult?.(false);
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
      t('location.presetStatus', {
        preset: preset.name,
        elevation: preset.groundElevationM,
      }),
    );
  }

  /** Returns a validation error, or null on success. */
  setManualObserver(input: ManualObserverInput): string | null {
    if (!Number.isFinite(input.latitudeDeg) || input.latitudeDeg < -90 || input.latitudeDeg > 90) {
      return t('location.validationLat');
    }
    if (!Number.isFinite(input.longitudeDeg) || input.longitudeDeg < -180 || input.longitudeDeg > 180) {
      return t('location.validationLon');
    }
    if (!Number.isFinite(input.eyeHeightM) || input.eyeHeightM < 0 || input.eyeHeightM > 100) {
      return t('location.validationEyeHeight');
    }
    if (
      input.groundElevationM !== null &&
      (!Number.isFinite(input.groundElevationM) || input.groundElevationM < -500 || input.groundElevationM > 9000)
    ) {
      return t('location.validationGroundOptional');
    }
    this.applyObserver(
      {
        latitudeDeg: input.latitudeDeg,
        longitudeDeg: input.longitudeDeg,
        groundElevationM: input.groundElevationM,
        eyeHeightM: input.eyeHeightM,
      },
      'manual',
      t('location.manualStatus', {
        ground:
          input.groundElevationM === null
            ? t('location.groundUnknownAssumed')
            : t('location.groundValue', {
                elevation: input.groundElevationM,
              }),
        eye: input.eyeHeightM.toFixed(1),
      }),
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
        ? t('location.timeOutsideWindow')
        : atEnd && this.store.getState().playing
          ? t('location.endOfWindow')
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
    this.persistPreferences();
  }

  setToggle<K extends keyof DisplayToggles>(key: K, value: DisplayToggles[K]): void {
    this.store.updateToggles({ [key]: value } as Partial<DisplayToggles>);
    this.persistPreferences();
  }

  setMinGoodElevation(deg: number): void {
    this.store.update({ minGoodElevationDeg: Math.min(90, Math.max(0, deg)) });
    this.persistPreferencesSoon();
  }

  /** True only when no URL, stored or prepared-area location was available. */
  shouldPromptForLocation(): boolean {
    return (
      this.initialLocationSource === 'fallback' &&
      !this.preferences.locationPromptDismissed
    );
  }

  hasSavedLocation(): boolean {
    return this.preferences.observer !== null;
  }

  dismissLocationPrompt(): void {
    this.preferences.locationPromptDismissed = true;
    this.persistPreferences();
  }

  /** Forget the stored place but keep the current in-memory observer. */
  forgetSavedLocation(): void {
    this.preferences.observer = null;
    this.preferences.locationPromptDismissed = false;
    this.persistPreferences();
  }

  shouldShowOfflineReadyBanner(): boolean {
    return !this.preferences.offlineBannerDismissed;
  }

  dismissOfflineReadyBanner(): void {
    this.preferences.offlineBannerDismissed = true;
    this.persistPreferences();
  }

  private persistPreferences(): void {
    if (this.initializing) return;
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const state = this.store.getState();
    this.preferences = {
      ...this.preferences,
      // AR needs camera/sensor permission and a user gesture. Restoring it on
      // launch would prompt before the user asks, so reopen on the sky instead.
      viewMode: state.viewMode === 'ar' ? 'sky' : state.viewMode,
      toggles: { ...state.toggles },
      minGoodElevationDeg: state.minGoodElevationDeg,
    };
    savePreferences(this.preferences);
  }

  /** Sliders fire continuously; avoid one synchronous storage write per pixel. */
  private persistPreferencesSoon(): void {
    if (this.initializing || this.persistTimer !== null) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.persistPreferences();
    }, 200);
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
      return t('location.validationLat');
    }
    if (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
      return t('location.validationLon');
    }
    if (
      groundElevationM !== null &&
      (!Number.isFinite(groundElevationM) ||
        groundElevationM < -500 ||
        groundElevationM > 9000)
    ) {
      return t('location.validationGround');
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
      t('location.fromTerrain'),
    );
    return null;
  }

  setGroundElevationM(elevationM: number): void {
    const current = this.store.getState().observer;
    if (!current || !Number.isFinite(elevationM)) return;
    const source = this.store.getState().locationSource;
    this.applyObserver(
      {
        ...current,
        groundElevationM: Math.min(9000, Math.max(-500, elevationM)),
      },
      source,
      t('location.groundFromDem', {
        elevation: elevationM.toFixed(1),
        eye: current.eyeHeightM.toFixed(1),
      }),
      true,
      this.shouldPersistObserverSource(source),
    );
  }

  setEyeHeightM(eyeHeightM: number): void {
    const current = this.store.getState().observer;
    if (!current || !Number.isFinite(eyeHeightM)) return;
    const clamped = Math.min(100, Math.max(0, eyeHeightM));
    const source = this.store.getState().locationSource;
    this.applyObserver(
      { ...current, eyeHeightM: clamped },
      source,
      t('location.eyeHeightStatus', { eye: clamped.toFixed(1) }),
      true,
      this.shouldPersistObserverSource(source),
    );
  }

  private shouldPersistObserverSource(source: LocationSource): boolean {
    return (
      source === 'manual' || source === 'preset' || source === 'geolocation'
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
      this.store.update({
        error: t('location.noJump', {
          target: t(JUMP_LABELS[target]),
        }),
      });
      return;
    }
    this.setUtc(ms);
  }

  /** Four-decimal location summary for the UI. */
  observerSummary(): string {
    const observer = this.store.getState().observer;
    if (!observer) return t('location.noObserver');
    return t('location.observerSummary', {
      lat: observer.latitudeDeg.toFixed(4),
      lon: observer.longitudeDeg.toFixed(4),
      elevation: effectiveElevationM(observer).toFixed(1),
    });
  }
}

const JUMP_LABELS = {
  topocentricCa: 'jump.topocentricCa',
  geocentricCa: 'jump.geocentricCa',
  rise: 'jump.rise',
  set: 'jump.set',
  maxElevation: 'jump.maxElevation',
  visibilityStart: 'jump.visibilityStart',
  visibilityEnd: 'jump.visibilityEnd',
} as const;
