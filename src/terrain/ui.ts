/**
 * Terrain tab UI and orchestration.
 *
 * Everything is mounted inside the host-provided root. Shared app state is
 * read-only here; observer/ground/time changes go through TerrainHostApi.
 */

import { formatLocal, formatUtc } from '../ui/timeFormat';
import { t } from '../i18n';
import type { UiState } from '../state/store';
import {
  buildingsFromSnapshot,
  clearOfflineData,
  prepareOfflineArea,
  verifyPreparedSnapshot,
} from '../offline/prepare';
import {
  formatBytes,
  formatPreparedDate,
  storageInfo,
  type OfflineSnapshot,
} from '../offline/snapshot';
import {
  DEFAULT_BUILDING_HEIGHT_M,
  OverpassRateLimitError,
  OverpassRequestError,
  OverpassTimeoutError,
  defaultHeightShare,
  fetchBuildings,
} from './buildings';
import {
  cacheKeyCount,
  clearBuildingCache,
  clearTerrainCache,
  putCachedBuildings,
} from './cache';
import { parseImportedBuildings } from './bundledAreas';
import { latLonToEnu } from './geo';
import { computeHorizonProfile } from './horizon';
import { drawHorizonChart } from './horizonChart';
import type { TerrainHostApi, TerrainWorkstream } from './host';
import { TerrainMap } from './mapView';
import { renderOfflineBaseMap } from './offlineMap';
import {
  fieldCheckKey,
  loadFieldChecks,
  setFieldCheck,
  type FieldCheckStore,
} from './fieldChecks';
import { buildApophisPath, formatSector, observerKey } from './path';
import { LocalScene3D, type SceneReadout } from './scene3d';
import {
  formatClearPercent,
  generateSearchCandidates,
  searchBestSpots,
  type BestSpotInput,
  type BestSpotRunOptions,
} from './bestSpot';
import { describeBestSpot } from './bestSpotText';
import {
  buildingAtPoint,
  loadTerrainGrid,
  prepareBuildings,
  sceneGroundElevationM,
  tallestBuildingAtPoint,
  type TerrainLoadProgress,
} from './terrainGrid';
import type {
  ApophisPathInfo,
  BestSpotSummary,
  BuildingsResult,
  HorizonProfile,
  PreparedBuilding,
  TerrainGrid,
} from './types';
import './terrain.css';

const DEFAULT_EYE_HEIGHT_M = 1.7;
const DEFAULT_BUILDING_RADIUS_M = 1_000;
const DEFAULT_SEARCH_RADIUS_M = 3_000;
const DEFAULT_SPACING_M = 100;
const DEFAULT_MARGIN_DEG = 2;
const TERRAIN_RADIUS_MARGIN_M = 4_000;
const MAX_TILES = 81;
const BUILDING_DEBOUNCE_MS = 1_200;
const TERRAIN_DEBOUNCE_MS = 650;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function fmtM(value: number, digits = 1): string {
  return `${value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })} m`;
}

function fmtKm(value: number, digits = 2): string {
  return `${(value / 1000).toFixed(digits)} km`;
}

export class TerrainUi implements TerrainWorkstream {
  private readonly root: HTMLElement;
  private readonly api: TerrainHostApi;
  private readonly refs: Record<string, HTMLElement> = {};
  private state: Readonly<UiState> | null = null;
  private mounted = false;
  private unsubscribe: (() => void) | null = null;

  private map: TerrainMap | null = null;
  private scene: LocalScene3D | null = null;

  private grid: TerrainGrid | null = null;
  private buildingsResult: BuildingsResult | null = null;
  private preparedBuildings: PreparedBuilding[] = [];
  private path: ApophisPathInfo | null = null;
  private profile: HorizonProfile | null = null;
  private bestSpot: BestSpotSummary | null = null;

  private eyeHeightM = DEFAULT_EYE_HEIGHT_M;
  private eyeMode: 'ground' | 'floor' | 'rooftop' = 'ground';
  private floor = 3;
  private eyeCustomised = false;
  private lastStateEyeHeight = DEFAULT_EYE_HEIGHT_M;

  private buildingRadiusM = DEFAULT_BUILDING_RADIUS_M;
  private searchRadiusM = DEFAULT_SEARCH_RADIUS_M;
  private spacingM = DEFAULT_SPACING_M;
  private marginDeg = DEFAULT_MARGIN_DEG;

  private viewpoint = { eastM: 0, northM: 0, groundElevationM: 0 };
  private viewpointLatDeg = 0;
  private viewpointLonDeg = 0;
  private viewingCandidate = false;
  private viewpointInsideBuilding: PreparedBuilding | null = null;

  private lastObserverLocationKey = '';
  private lastStateGround: number | null = null;
  private mapPick: { lat: number; lon: number } | null = null;
  private recenterOnNextUpdate = false;

  private terrainAbort: AbortController | null = null;
  private terrainDebounce: number | null = null;
  private terrainLoading = false;
  private lastTerrainKey = '';

  private buildingAbort: AbortController | null = null;
  private buildingDebounce: number | null = null;
  private buildingLoading = false;
  private buildingCooldownUntil = 0;
  private cooldownTimer: number | null = null;
  private lastBuildingKey = '';

  private bestSpotBusy = false;
  private bestSpotCancelRequested = false;
  private bestSpotWorker: Worker | null = null;
  private bestSpotRequestId = 0;

  private fieldChecks: FieldCheckStore = loadFieldChecks();

  private offlineBusy = false;
  private offlineAbort: AbortController | null = null;
  private offlinePrepared: OfflineSnapshot | null = null;
  private offlineBuildingsAppliedAt = 0;
  private lastOfflineRenderKey = '';
  private lastOfflineMapKey = '';
  private lastVerifiedPreparedAt = 0;

  private chartTimer: number | null = null;
  private timeUpdateRaf: number | null = null;

  constructor(root: HTMLElement, api: TerrainHostApi) {
    this.root = root;
    this.api = api;
    this.root.innerHTML = this.template();
    this.root.classList.add('tw-root');
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-ref]')) {
      this.refs[node.dataset.ref!] = node;
    }
    this.bindEvents();
    const state = api.getState();
    this.state = state;
    this.lastStateEyeHeight = state.observer?.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
    this.eyeHeightM = this.lastStateEyeHeight;
    this.lastStateGround = state.observer?.groundElevationM ?? null;
    this.offlinePrepared = api.getOfflineSnapshot?.() ?? null;
    this.renderStaticText();
    void this.renderOfflineStatus(true);
  }

  private ref<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.refs[id] as T;
  }

  private template(): string {
    return `
      <div class="tw-head">
        <div class="tw-head-title">
          <h2>${t('terrain.headerTitle')}</h2>
          <p>${t('terrain.headerIntro')}</p>
        </div>
        <div class="tw-head-badges">
          <span class="tw-badge" data-ref="dem-badge">${t('terrain.badgeDem')}</span>
          <span class="tw-badge" data-ref="building-badge">${t('terrain.badgeBuildings')}</span>
        </div>
      </div>
      <div class="tw-status" data-ref="status" role="status" aria-live="polite">${t('terrain.statusReady')}</div>

      <div class="tw-grid tw-grid-2">
        <section class="tw-card">
          <h3>${t('terrain.observerTitle')}</h3>
          <div class="tw-map" data-ref="map" aria-label="${t('terrain.observerMapAria')}"></div>
          <div class="tw-row tw-row-wrap">
            <label class="tw-field">${t('terrain.observerLat')}
              <input data-ref="lat" inputmode="decimal" placeholder="45.6427" />
            </label>
            <label class="tw-field">${t('terrain.observerLon')}
              <input data-ref="lon" inputmode="decimal" placeholder="25.5887" />
            </label>
            <button class="tw-btn" data-action="apply-observer" type="button">${t('terrain.observerApply')}</button>
            <button class="tw-btn ghost" data-action="use-browser-location" type="button">${t('terrain.observerRecenter')}</button>
          </div>
          <div class="tw-row tw-row-wrap">
            <label class="tw-field">${t('terrain.eyeHeight')}
              <input data-ref="eye" type="number" min="0" max="200" step="0.1" value="1.7" />
            </label>
            <label class="tw-field">${t('terrain.eyeMode')}
              <select data-ref="eye-mode">
                <option value="ground">${t('terrain.eyeModeGround')}</option>
                <option value="floor">${t('terrain.eyeModeFloor')}</option>
                <option value="rooftop">${t('terrain.eyeModeRooftop')}</option>
              </select>
            </label>
            <label class="tw-field tw-floor-field">${t('terrain.eyeFloor')}
              <input data-ref="floor" type="number" min="1" max="100" step="1" value="3" />
            </label>
          </div>
          <p class="tw-note" data-ref="eye-note">${t('terrain.eyeNoteInitial')}</p>
          <p class="tw-note tw-ground-note" data-ref="ground-note">${t('terrain.groundWaiting')}</p>
          <p class="tw-note">${t('terrain.groundNote')}</p>
        </section>

        <section class="tw-card">
          <h3>${t('terrain.demTitle')}</h3>
          <div class="tw-split">
            <div>
              <p class="tw-note tw-strong" data-ref="dem-info">${t('terrain.demNotLoaded')}</p>
              <div class="tw-progress" aria-hidden="true"><div data-ref="terrain-progress"></div></div>
              <div class="tw-row tw-row-wrap">
                <button class="tw-btn" data-action="reload-terrain" type="button">${t('terrain.demReload')}</button>
                <button class="tw-btn ghost" data-action="clear-terrain-cache" type="button">${t('terrain.demClearCache')}</button>
              </div>
              <p class="tw-note" data-ref="terrain-detail">${t('terrain.demDetailIdle')}</p>
            </div>
            <div>
              <p class="tw-note tw-strong" data-ref="building-info">${t('terrain.buildingsNotLoaded')}</p>
              <div class="tw-row tw-row-wrap">
                <button class="tw-btn" data-action="load-buildings" type="button">${t('terrain.buildingsFetch')}</button>
                <button class="tw-btn ghost" data-action="clear-building-cache" type="button">${t('terrain.buildingsClearCache')}</button>
              </div>
              <label class="tw-field">${t('terrain.buildingsRadius')}
                <input data-ref="building-radius" type="number" min="50" max="5000" step="50" value="1000" />
              </label>
              <label class="tw-field">${t('terrain.buildingsImportLabel')}
                <input data-ref="import-file" type="file" accept=".geojson,.json,application/geo+json,application/json" />
              </label>
              <p class="tw-note" data-ref="import-status">${t('terrain.buildingsImportIdle')}</p>
              <p class="tw-note" data-ref="building-detail">${t('terrain.buildingsDetailIdle')}</p>
            </div>
          </div>
          <div class="tw-credits">
            ${t('terrain.creditsTerrain')}
            <br />${t('terrain.creditsBuildings')}
            <br />${t('terrain.creditsHeightPriority')}
          </div>
        </section>
      </div>

      <div class="tw-grid tw-grid-2">
        <section class="tw-card">
          <h3>${t('terrain.sceneTitle')} <span class="tw-subtitle">${t('terrain.sceneSubtitle')}</span></h3>
          <div class="tw-scene" data-ref="scene" aria-label="${t('terrain.sceneAria')}"></div>
          <div class="tw-row tw-row-wrap">
            <button class="tw-btn" data-action="look-apophis" type="button">${t('terrain.sceneLook')}</button>
            <button class="tw-btn ghost" data-nav="0" type="button">${t('terrain.sceneNavN')}</button>
            <button class="tw-btn ghost" data-nav="90" type="button">${t('terrain.sceneNavE')}</button>
            <button class="tw-btn ghost" data-nav="180" type="button">${t('terrain.sceneNavS')}</button>
            <button class="tw-btn ghost" data-nav="270" type="button">${t('terrain.sceneNavW')}</button>
            <span class="tw-chip">${t('terrain.sceneFov')} <span data-ref="fov">62°</span></span>
          </div>
          <div class="tw-row">
            <label class="tw-grow">${t('terrain.sceneTime')}
              <input data-ref="time" type="range" min="0" max="10000" step="1" value="5000" aria-label="${t('terrain.sceneTimeAria')}" />
            </label>
            <span class="tw-chip" data-ref="time-label">—</span>
          </div>
          <p class="tw-note" data-ref="scene-readout">${t('terrain.sceneHint')}</p>
          <p class="tw-note">${t('terrain.sceneNote')}</p>
        </section>

        <section class="tw-card">
          <h3>${t('terrain.horizonTitle')} <span class="tw-subtitle">${t('terrain.horizonSubtitle')}</span></h3>
          <canvas class="tw-chart" data-ref="horizon-chart" aria-label="${t('terrain.horizonAria')}"></canvas>
          <p class="tw-note" data-ref="horizon-info">${t('terrain.horizonEmpty')}</p>
          <p class="tw-note tw-strong" data-ref="path-info">${t('terrain.pathWaiting')}</p>
          <p class="tw-note" data-ref="parallax-info">${t('terrain.parallaxWaiting')}</p>
        </section>
      </div>

      <section class="tw-card">
        <h3>${t('terrain.bestTitle')} <span class="tw-subtitle">${t('terrain.bestSubtitle')}</span></h3>
        <div class="tw-row tw-row-wrap">
          <label class="tw-field">${t('terrain.bestSearchRadius')}
            <input data-ref="search-radius" type="number" min="500" max="10000" step="100" value="3000" />
          </label>
          <label class="tw-field">${t('terrain.bestSpacing')}
            <input data-ref="spacing" type="number" min="50" max="100" step="10" value="100" />
          </label>
          <label class="tw-field">${t('terrain.bestMargin')}
            <input data-ref="margin" type="number" min="0" max="20" step="0.5" value="2" />
          </label>
          <button class="tw-btn primary" data-action="run-best" type="button">${t('terrain.bestRun')}</button>
          <button class="tw-btn danger" data-action="cancel-best" type="button" disabled>${t('terrain.bestCancel')}</button>
        </div>
        <div class="tw-progress" aria-hidden="true"><div data-ref="best-progress"></div></div>
        <p class="tw-note tw-strong" data-ref="best-status">${t('terrain.bestStatusIdle')}</p>
        <div class="tw-split tw-best-split">
          <div>
            <p class="tw-note">${t('terrain.bestHeatmapNote')}</p>
            <p class="tw-note" data-ref="best-summary">—</p>
            <p class="tw-note" data-ref="best-warning"></p>
          </div>
          <ol class="tw-results" data-ref="best-list"></ol>
        </div>
        <div class="tw-note" data-ref="best-detail"></div>
        <div class="tw-field-check" data-ref="field-check"></div>
        <p class="tw-note">${t('terrain.bestDisclaimer')}</p>
      </section>

      <section class="tw-card tw-offline-card" data-ref="offline-card">
        <h3>${t('terrain.offlineTitle')} <span class="tw-subtitle">${t('terrain.offlineSubtitle')}</span></h3>
        <p class="tw-note tw-strong" data-ref="offline-status">${t('terrain.offlineStatusNone')}</p>
        <div class="tw-row tw-row-wrap">
          <button class="tw-btn primary" data-action="prepare-offline" type="button">${t('terrain.offlinePrepare')}</button>
          <button class="tw-btn danger" data-action="cancel-offline" type="button" disabled>${t('terrain.offlineCancel')}</button>
          <button class="tw-btn ghost" data-action="clear-offline" type="button">${t('terrain.offlineClear')}</button>
        </div>
        <div class="tw-progress" aria-hidden="true"><div data-ref="offline-progress"></div></div>
        <p class="tw-note" data-ref="offline-storage">${t('terrain.offlineStoragePending')}</p>
        <ul class="tw-offline-list" data-ref="offline-contents"></ul>
        <p class="tw-note tw-warn" data-ref="offline-warning"></p>
        <p class="tw-note">${t('terrain.offlineStoredNote')}</p>
      </section>

      <footer class="tw-footer">
        <p>${t('terrain.footerMethod')}</p>
        <p>${t('terrain.footerLicences')}</p>
        <p class="tw-mono" data-ref="build-info">${t('terrain.footerBuildInfo')}</p>
      </footer>
    `;
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const resultItem = target.closest<HTMLElement>('[data-result-index]');
      if (resultItem) {
        this.selectResult(Number(resultItem.dataset.resultIndex));
        return;
      }
      const nav = target.closest<HTMLElement>('[data-nav]');
      if (nav) {
        const az = Number(nav.dataset.nav);
        this.scene?.lookAtAzimuth(az, az === 0 ? 10 : 6);
        return;
      }
      const button = target.closest<HTMLElement>('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      switch (action) {
        case 'apply-observer':
          this.applyManualObserver();
          break;
        case 'use-browser-location':
          this.map?.setObserver(
            this.state?.observer?.latitudeDeg ?? 45.6427,
            this.state?.observer?.longitudeDeg ?? 25.5887,
            { recenter: true },
          );
          break;
        case 'reload-terrain':
          this.loadTerrainNow();
          break;
        case 'clear-terrain-cache':
          void this.clearTerrainCache();
          break;
        case 'load-buildings':
          void this.fetchBuildingsNow();
          break;
        case 'clear-building-cache':
          void this.clearBuildingCacheNow();
          break;
        case 'run-best':
          void this.runBestSpot();
          break;
        case 'cancel-best':
          this.cancelBestSpot();
          break;
        case 'look-apophis':
          this.scene?.lookAtApophis();
          break;
        case 'use-observer':
          this.useCandidateAsObserver(Number(button.dataset.index));
          break;
        case 'prepare-offline':
          void this.prepareOffline();
          break;
        case 'cancel-offline':
          this.cancelOffline();
          break;
        case 'clear-offline':
          void this.clearOffline();
          break;
        case 'field-pass':
          this.recordFieldCheck(Number(button.dataset.index), 'pass');
          break;
        case 'field-fail':
          this.recordFieldCheck(Number(button.dataset.index), 'fail');
          break;
        default:
          break;
      }
    });

    this.root.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.dataset.fieldNote !== undefined) {
        this.recordFieldNote(Number(target.dataset.index), target.value);
        return;
      }
      switch (target.dataset.ref) {
        case 'eye':
          this.setEyeHeightFromInput(target.value);
          break;
        case 'floor':
          if (this.eyeMode === 'floor') {
            this.floor = Math.max(1, Math.round(finiteNumber(target.value, 3)));
            this.applyFloorEyeHeight();
          }
          break;
        case 'building-radius': {
          const value = clampNumber(
            finiteNumber(target.value, DEFAULT_BUILDING_RADIUS_M),
            50,
            5_000,
          );
          if (value !== this.buildingRadiusM) {
            this.buildingRadiusM = value;
            this.updateSearchArea();
            this.invalidateBestSpot(t('terrain.invalidateBuildingRadius'));
            this.scheduleBuildings();
          }
          break;
        }
        case 'search-radius': {
          const value = clampNumber(
            finiteNumber(target.value, DEFAULT_SEARCH_RADIUS_M),
            500,
            10_000,
          );
          if (value !== this.searchRadiusM) {
            this.searchRadiusM = value;
            this.updateSearchArea();
            this.invalidateBestSpot(t('terrain.invalidateSearchRadius'));
            this.scheduleTerrainLoad();
          }
          break;
        }
        case 'spacing': {
          const value = clampNumber(
            finiteNumber(target.value, DEFAULT_SPACING_M),
            50,
            100,
          );
          if (value !== this.spacingM) {
            this.spacingM = value;
            this.invalidateBestSpot(t('terrain.invalidateSpacing'));
          }
          break;
        }
        case 'margin': {
          const value = clampNumber(
            finiteNumber(target.value, DEFAULT_MARGIN_DEG),
            0,
            20,
          );
          if (value !== this.marginDeg) {
            this.marginDeg = value;
            this.invalidateBestSpot(t('terrain.invalidateMargin'));
            this.scheduleChart();
          }
          break;
        }
        case 'time':
          this.applyTimeSlider(Number(target.value));
          break;
        default:
          break;
      }
    });

    this.root.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if (target.dataset.ref === 'import-file' && target instanceof HTMLInputElement) {
        void this.importBuildingsFile(target);
        return;
      }
      if (target.dataset.ref === 'eye-mode') {
        this.eyeMode = target.value as 'ground' | 'floor' | 'rooftop';
        this.eyeCustomised = true;
        this.applyEyeMode();
      }
    });
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.root.classList.remove('tw-unmounted');
    if (!this.map) {
      this.map = new TerrainMap(this.ref('map'), {
        onObserverPick: (lat, lon) => {
          this.mapPick = { lat, lon };
          this.api.setObserver(lat, lon);
        },
        onResultPick: (index) => this.selectResult(index),
        offline: this.api.getState().offline.active || navigator.onLine === false,
      });
    }
    if (!this.scene) {
      this.scene = new LocalScene3D(this.ref('scene'));
      this.scene.onReadout = (readout) => this.renderSceneReadout(readout);
    }
    const state = this.api.getState();
    this.state = state;
    this.root.classList.toggle('tw-night', state.toggles.nightMode);
    this.map?.setNightMode(state.toggles.nightMode);
    // Subscribe here as well as exposing update(): the module is correct when
    // the host pushes state and when it relies on this subscription.
    this.unsubscribe?.();
    this.unsubscribe = this.api.subscribe((next) => this.update(next));
    this.syncAll(true);
    requestAnimationFrame(() => {
      this.map?.invalidateSize();
      this.drawChartNow();
    });
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.root.classList.add('tw-unmounted');
    if (this.terrainDebounce !== null) window.clearTimeout(this.terrainDebounce);
    if (this.buildingDebounce !== null) window.clearTimeout(this.buildingDebounce);
    if (this.chartTimer !== null) window.clearTimeout(this.chartTimer);
    if (this.timeUpdateRaf !== null) cancelAnimationFrame(this.timeUpdateRaf);
    this.terrainDebounce = null;
    this.buildingDebounce = null;
    this.chartTimer = null;
    this.terrainAbort?.abort();
    this.buildingAbort?.abort();
    this.terrainAbort = null;
    this.buildingAbort = null;
    this.bestSpotCancelRequested = true;
    this.bestSpotWorker?.terminate();
    this.bestSpotWorker = null;
    this.stopCooldownTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.map?.dispose();
    this.map = null;
    this.scene?.dispose();
    this.scene = null;
  }

  update(state: Readonly<UiState>): void {
    this.state = state;
    this.root.classList.toggle('tw-night', state.toggles.nightMode);
    if (!this.mounted) return;
    this.map?.setNightMode(state.toggles.nightMode);
    this.scene?.setState({ nightMode: state.toggles.nightMode });
    this.syncAll(false);
    void this.renderOfflineStatus(false);
    if (state.offline.active) this.applyOfflineBuildings();
    this.maybeApplyOfflineMap();
  }

  private syncAll(initial: boolean): void {
    const state = this.state;
    if (!state) return;
    this.syncObserver(initial);
    this.syncEyeFromState();
    this.syncTime();
    this.renderTimeLabel();
    this.updateSearchArea();
    this.scheduleChart();
  }

  private syncObserver(initial: boolean): void {
    const state = this.state;
    const observer = state?.observer;
    if (!observer) {
      this.setStatus(t('terrain.observerMissing'), 'warn');
      return;
    }
    const key = `${observer.latitudeDeg.toFixed(6)}|${observer.longitudeDeg.toFixed(6)}`;
    const changed = key !== this.lastObserverLocationKey;
    this.lastObserverLocationKey = key;
    const latInput = this.ref<HTMLInputElement>('lat');
    const lonInput = this.ref<HTMLInputElement>('lon');
    if (document.activeElement !== latInput) latInput.value = observer.latitudeDeg.toFixed(5);
    if (document.activeElement !== lonInput) lonInput.value = observer.longitudeDeg.toFixed(5);
    const fromMap =
      this.mapPick !== null &&
      Math.abs(this.mapPick.lat - observer.latitudeDeg) < 1e-7 &&
      Math.abs(this.mapPick.lon - observer.longitudeDeg) < 1e-7;
    const recenter = !fromMap && (this.recenterOnNextUpdate || initial);
    this.recenterOnNextUpdate = false;
    this.mapPick = null;
    this.map?.setObserver(observer.latitudeDeg, observer.longitudeDeg, {
      recenter,
    });
    if (changed) {
      this.viewingCandidate = false;
      this.map?.clearViewpoint();
      this.viewpoint = {
        eastM: 0,
        northM: 0,
        groundElevationM: observer.groundElevationM ?? 0,
      };
      this.viewpointLatDeg = observer.latitudeDeg;
      this.viewpointLonDeg = observer.longitudeDeg;
      this.invalidateBestSpot(t('terrain.invalidateObserver'));
      this.profile = null;
      this.path = null;
      this.terrainAbort?.abort();
      this.buildingAbort?.abort();
      this.terrainAbort = null;
      this.buildingAbort = null;
      this.terrainLoading = false;
      this.buildingLoading = false;
      this.grid = null;
      this.buildingsResult = null;
      this.preparedBuildings = [];
      this.lastTerrainKey = '';
      this.lastBuildingKey = '';
      this.setProgress('terrain-progress', 0);
      this.setProgress('best-progress', 0);
      this.ref('dem-badge').textContent = t('terrain.badgeDemLoading');
      this.ref('dem-badge').className = 'tw-badge';
      this.ref('building-badge').textContent = t('terrain.badgeBuildings');
      this.ref('building-badge').className = 'tw-badge';
      this.scene?.setState({
        grid: null,
        buildings: [],
        horizon: null,
        path: null,
        viewpoint: this.viewpoint,
        eyeHeightM: this.eyeHeightM,
      });
      this.ensurePath();
      this.scheduleTerrainLoad();
      this.scheduleBuildings();
    }
    if (observer.groundElevationM !== this.lastStateGround) {
      this.lastStateGround = observer.groundElevationM;
      this.renderGroundNote();
    }
    if (changed) this.renderGroundNote();
  }

  private syncEyeFromState(): void {
    const stateEye = this.state?.observer?.eyeHeightM;
    if (
      stateEye !== undefined &&
      Math.abs(stateEye - this.lastStateEyeHeight) > 1e-9
    ) {
      this.lastStateEyeHeight = stateEye;
      if (!this.eyeCustomised && this.eyeMode === 'ground') {
        this.eyeHeightM = stateEye;
        this.eyeCustomised = false;
        const input = this.ref<HTMLInputElement>('eye');
        if (document.activeElement !== input) input.value = stateEye.toFixed(1);
        this.applyEyeHeightToScene();
      }
    }
  }

  private syncTime(): void {
    const state = this.state;
    if (!state || state.utcMs === null) return;
    const slider = this.ref<HTMLInputElement>('time');
    if (
      state.dataWindowStartMs !== null &&
      state.dataWindowEndMs !== null &&
      document.activeElement !== slider
    ) {
      const fraction =
        (state.utcMs - state.dataWindowStartMs) /
        Math.max(1, state.dataWindowEndMs - state.dataWindowStartMs);
      slider.value = String(Math.round(clampNumber(fraction, 0, 1) * 10000));
    }
    this.scene?.setState({
      utcMs: state.utcMs,
      grid: this.grid,
      path: this.path,
      eyeHeightM: this.eyeHeightM,
      horizon: this.profile,
      nightMode: state.toggles.nightMode,
    });
    this.scheduleChart();
  }

  private renderTimeLabel(): void {
    const state = this.state;
    if (!state || state.utcMs === null) {
      this.ref('time-label').textContent = '—';
      return;
    }
    const utc = formatUtc(state.utcMs);
    let local = '';
    try {
      local = formatLocal(state.utcMs, state.timeZone).label;
    } catch {
      local = '';
    }
    this.ref('time-label').textContent = local
      ? t('terrain.timeLabelLocal', {
          utc: utc.slice(0, 16),
          local: local.slice(11, 16),
        })
      : utc;
    this.scene?.setState({ utcMs: state.utcMs });
  }

  private applyTimeSlider(value: number): void {
    const state = this.state;
    if (
      !state ||
      state.dataWindowStartMs === null ||
      state.dataWindowEndMs === null
    ) {
      return;
    }
    const fraction = clampNumber(value / 10000, 0, 1);
    this.api.setTimeUtcMs(
      state.dataWindowStartMs +
        fraction * (state.dataWindowEndMs - state.dataWindowStartMs),
    );
  }

  private applyManualObserver(): void {
    const lat = Number(this.ref<HTMLInputElement>('lat').value);
    const lon = Number(this.ref<HTMLInputElement>('lon').value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      this.setStatus(t('terrain.observerErrorLat'), 'bad');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      this.setStatus(t('terrain.observerErrorLon'), 'bad');
      return;
    }
    this.recenterOnNextUpdate = true;
    this.api.setObserver(lat, lon);
  }

  private setEyeHeightFromInput(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    this.eyeHeightM = clampNumber(parsed, 0, 200);
    this.eyeMode = 'ground';
    this.eyeCustomised = true;
    this.ref<HTMLSelectElement>('eye-mode').value = 'ground';
    this.api.setEyeHeightM?.(this.eyeHeightM);
    this.applyEyeHeightToScene();
    this.renderEyeNote();
  }

  private applyEyeMode(): void {
    if (this.eyeMode === 'floor') {
      this.applyFloorEyeHeight();
      return;
    }
    if (this.eyeMode === 'rooftop') {
      this.applyRooftopEyeHeight();
      return;
    }
    const parsed = Number(this.ref<HTMLInputElement>('eye').value);
    this.eyeHeightM = Number.isFinite(parsed)
      ? clampNumber(parsed, 0, 200)
      : DEFAULT_EYE_HEIGHT_M;
    this.api.setEyeHeightM?.(this.eyeHeightM);
    this.applyEyeHeightToScene();
    this.renderEyeNote();
  }

  private applyFloorEyeHeight(): void {
    this.eyeHeightM = (this.floor - 1) * 3 + DEFAULT_EYE_HEIGHT_M;
    this.ref<HTMLInputElement>('eye').value = this.eyeHeightM.toFixed(1);
    this.api.setEyeHeightM?.(this.eyeHeightM);
    this.applyEyeHeightToScene();
    this.renderEyeNote();
  }

  private applyRooftopEyeHeight(): void {
    const prepared = this.preparedBuildings;
    if (!this.grid || prepared.length === 0) {
      this.setStatus(
        t('terrain.eyeErrorRooftopNoBuildings'),
        'warn',
      );
      this.eyeMode = 'ground';
      this.ref<HTMLSelectElement>('eye-mode').value = 'ground';
      return;
    }
    const enu = latLonToEnu(
      this.viewpointLatDeg,
      this.viewpointLonDeg,
      this.grid.originLatDeg,
      this.grid.originLonDeg,
    );
    const building = tallestBuildingAtPoint(prepared, enu.eastM, enu.northM);
    if (!building) {
      this.setStatus(
        t('terrain.eyeErrorRooftopNoFootprint'),
        'warn',
      );
      this.eyeMode = 'ground';
      this.ref<HTMLSelectElement>('eye-mode').value = 'ground';
      this.applyEyeMode();
      return;
    }
    this.eyeHeightM = building.heightM + DEFAULT_EYE_HEIGHT_M;
    this.ref<HTMLInputElement>('eye').value = this.eyeHeightM.toFixed(1);
    this.api.setEyeHeightM?.(this.eyeHeightM);
    this.applyEyeHeightToScene();
    this.renderEyeNote(
      t('terrain.eyeRooftopDetail', {
        id: building.id,
        height: building.heightM.toFixed(1),
        source:
          building.heightSource === 'default'
            ? t('terrain.eyeDefaultHeight')
            : building.heightSource,
      }),
    );
  }

  private applyEyeHeightToScene(): void {
    this.scene?.setState({
      eyeHeightM: this.eyeHeightM,
      grid: this.grid,
      path: this.path,
      utcMs: this.state?.utcMs ?? null,
      viewpoint: this.viewpoint,
      nightMode: this.state?.toggles.nightMode ?? false,
    });
    if (this.grid) {
      this.recomputeProfileAtViewpoint();
    }
    this.invalidateBestSpot(t('terrain.invalidateEyeHeight'));
    this.scheduleChart();
  }

  private renderEyeNote(extra?: string): void {
    const base =
      this.eyeMode === 'floor'
        ? t('terrain.eyeNoteFloor', {
            floor: this.floor,
            height: fmtM(this.eyeHeightM),
          })
        : this.eyeMode === 'rooftop'
          ? t('terrain.eyeNoteRooftop', { height: fmtM(this.eyeHeightM) })
          : t('terrain.eyeNoteGround', { height: fmtM(this.eyeHeightM) });
    const hostNote = this.api.setEyeHeightM
      ? t('terrain.eyeHostAvailable')
      : t('terrain.eyeHostUnavailable');
    this.ref('eye-note').textContent = t('terrain.eyeNoteCombined', {
      base,
      extra: extra ?? '',
      suffix: t('terrain.eyeNoteSuffix'),
      host: hostNote,
    });
  }

  private terrainRadius(): number {
    return clampNumber(
      Math.max(this.searchRadiusM + TERRAIN_RADIUS_MARGIN_M, 4_000),
      4_000,
      12_000,
    );
  }

  private scheduleTerrainLoad(): void {
    if (!this.mounted) return;
    if (this.terrainDebounce !== null) window.clearTimeout(this.terrainDebounce);
    this.terrainDebounce = window.setTimeout(() => {
      this.terrainDebounce = null;
      void this.loadTerrainNow();
    }, TERRAIN_DEBOUNCE_MS);
  }

  private async loadTerrainNow(): Promise<void> {
    const state = this.state;
    const observer = state?.observer;
    if (!observer || !this.mounted) return;
    if (state?.offline.active && state.offline.mismatch) {
      this.ref('dem-badge').textContent = t('terrain.badgeDemNotPrepared');
      this.ref('dem-badge').className = 'tw-badge warn';
      this.setStatus(
        t('terrain.offlineTerrainNotPrepared'),
        'warn',
        true,
      );
      return;
    }    const requestKey = `${observer.latitudeDeg.toFixed(6)}|${observer.longitudeDeg.toFixed(
      6,
    )}|${this.terrainRadius()}`;
    if (requestKey === this.lastTerrainKey && this.grid && !this.terrainLoading) {
      return;
    }
    this.terrainAbort?.abort();
    const controller = new AbortController();
    this.terrainAbort = controller;
    this.terrainLoading = true;
    this.setProgress('terrain-progress', 0.04);
    this.setStatus(
      t('terrain.statusDemLoading', {
        lat: observer.latitudeDeg.toFixed(4),
        lon: observer.longitudeDeg.toFixed(4),
      }),
      'info',
    );
    try {
      const grid = await loadTerrainGrid({
        latitudeDeg: observer.latitudeDeg,
        longitudeDeg: observer.longitudeDeg,
        radiusM: this.terrainRadius(),
        maxTiles: MAX_TILES,
        maxZoom: 14,
        signal: controller.signal,
        onProgress: (progress) => this.onTerrainProgress(progress),
      });
      if (controller.signal.aborted) return;
      const current = this.state?.observer;
      if (
        !current ||
        Math.abs(current.latitudeDeg - observer.latitudeDeg) > 1e-7 ||
        Math.abs(current.longitudeDeg - observer.longitudeDeg) > 1e-7
      ) {
        return;
      }
      this.grid = grid;
      this.lastTerrainKey = requestKey;
      this.preparedBuildings = this.buildingsResult
        ? prepareBuildings(grid, this.buildingsResult.buildings)
        : [];
      this.terrainLoading = false;
      this.setProgress('terrain-progress', 1);
      this.renderDemInfo(grid);
      this.renderGroundNote();
      this.updateGroundElevationFromDem(grid);
      this.scene?.setState({
        grid,
        buildings: this.preparedBuildings,
        path: this.path,
        utcMs: this.state?.utcMs ?? null,
        eyeHeightM: this.eyeHeightM,
        // Keep a candidate viewpoint only if it is still inside this DEM.
        viewpoint: this.viewingCandidate ? this.viewpoint : null,
        nightMode: this.state?.toggles.nightMode ?? false,
      });
      if (!this.viewingCandidate) {
        this.viewpoint = {
          eastM: 0,
          northM: 0,
          groundElevationM: sceneGroundElevationM(grid),
        };
        this.viewpointLatDeg = observer.latitudeDeg;
        this.viewpointLonDeg = observer.longitudeDeg;
      }
      this.recomputeProfileAtViewpoint();
      this.maybeApplyOfflineMap();
      this.setStatus(
        t('terrain.statusDemReady', {
          zoom: grid.zoom,
          spacing: grid.spacingM.toFixed(1),
          tiles: grid.requestedTiles,
          failed: grid.failedTiles,
          ground: Number.isFinite(grid.observerGroundElevationM)
            ? fmtM(grid.observerGroundElevationM)
            : t('terrain.unknown'),
        }),
        grid.failedTiles > 0 ? 'warn' : 'good',
      );
      this.api.setStatus(
        t('terrain.statusHostDemReady', {
          zoom: grid.zoom,
          spacing: grid.spacingM.toFixed(1),
        }),
      );
      void this.updateCacheCounts();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.terrainLoading = false;
      this.setProgress('terrain-progress', 0);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(
        t('terrain.statusDemFailed', { message }),
        'bad',
        true,
      );
      this.ref('dem-badge').textContent = t('terrain.badgeDemFailed');
      this.ref('dem-badge').className = 'tw-badge bad';
    } finally {
      if (this.terrainAbort === controller) this.terrainAbort = null;
    }
  }

  private onTerrainProgress(progress: TerrainLoadProgress): void {
    const fraction =
      progress.phase === 'done'
        ? 1
        : progress.phase === 'stitching'
          ? 0.92
          : progress.total > 0
            ? 0.05 + 0.85 * (progress.loaded / progress.total)
            : 0.05;
    this.setProgress('terrain-progress', fraction);
    this.ref('terrain-detail').textContent = progress.message;
    if (progress.loaded > 0 && progress.phase === 'tiles') {
      this.ref('dem-badge').textContent = t('terrain.badgeDemProgress', {
        loaded: progress.loaded,
        total: progress.total,
      });
      this.ref('dem-badge').className = 'tw-badge';
    }
  }

  private updateGroundElevationFromDem(grid: TerrainGrid): void {
    const ground = grid.observerGroundElevationM;
    if (!Number.isFinite(ground)) return;
    const rounded = Math.round(ground * 10) / 10;
    const current = this.state?.observer?.groundElevationM ?? null;
    if (current === null || Math.abs(current - rounded) > 0.5) {
      this.api.setGroundElevationM(rounded);
    }
  }

  private renderGroundNote(): void {
    const observer = this.state?.observer;
    const grid = this.grid;
    const sharedGround = grid
      ? grid.observerGroundElevationM
      : observer?.groundElevationM ?? null;
    if (
      sharedGround === null ||
      sharedGround === undefined ||
      !Number.isFinite(sharedGround)
    ) {
      this.ref('ground-note').textContent = t('terrain.groundUnknown');
      return;
    }
    const localGround = grid ? sceneGroundElevationM(grid) : sharedGround;
    const difference = localGround - sharedGround;
    if (Number.isFinite(localGround) && Math.abs(difference) > 0.1) {
      this.ref('ground-note').textContent = t('terrain.groundMismatch', {
        local: fmtM(localGround),
        shared: fmtM(sharedGround),
        difference: fmtM(Math.abs(difference)),
        altitude: fmtM(localGround + this.eyeHeightM),
      });
      return;
    }
    this.ref('ground-note').textContent = t('terrain.groundOk', {
      ground: fmtM(sharedGround),
      altitude: fmtM(localGround + this.eyeHeightM),
    });
  }

  private renderDemInfo(grid: TerrainGrid): void {
    const widthKm = (grid.width * grid.spacingEastM) / 1000;
    const heightKm = (grid.height * grid.spacingNorthM) / 1000;
    this.ref('dem-info').textContent = t('terrain.demInfo', {
      zoom: grid.zoom,
      spacing: grid.spacingM.toFixed(1),
      width: widthKm.toFixed(1),
      height: heightKm.toFixed(1),
      tiles: grid.requestedTiles,
      cached: grid.cachedTiles,
      network: grid.networkTiles,
      failed: grid.failedTiles,
      ground: Number.isFinite(grid.observerGroundElevationM)
        ? fmtM(grid.observerGroundElevationM)
        : t('terrain.unknown'),
    });
    this.ref('dem-badge').textContent = t('terrain.badgeDemValue', {
      zoom: grid.zoom,
      spacing: grid.spacingM.toFixed(1),
    });
    this.ref('dem-badge').className =
      grid.failedTiles > 0 ? 'tw-badge warn' : 'tw-badge good';
    this.ref('terrain-detail').textContent =
      grid.failedTiles > 0
        ? t('terrain.demDetailFailed', { count: grid.failedTiles })
        : t('terrain.demDetailOk');
  }

  private scheduleBuildings(): void {
    if (!this.mounted) return;
    if (this.state?.offline.active) {
      if (this.offlinePrepared?.buildings) {
        this.applyOfflineBuildings();
      } else {
        this.ref('building-badge').textContent = t('terrain.buildingsOfflineBadge');
        this.ref('building-badge').className = 'tw-badge warn';
        this.ref('building-detail').textContent = t('terrain.buildingsOfflineDetail');
      }
      return;
    }
    if (this.buildingDebounce !== null) window.clearTimeout(this.buildingDebounce);
    if (Date.now() < this.buildingCooldownUntil) {
      this.showCooldown();
      return;
    }
    this.buildingDebounce = window.setTimeout(() => {
      this.buildingDebounce = null;
      void this.fetchBuildingsNow();
    }, BUILDING_DEBOUNCE_MS);
  }

  private async importBuildingsFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    const observer = this.state?.observer;
    if (!observer) {
      this.ref('import-status').textContent = t('terrain.importNoObserver');
      return;
    }
    const grid = this.grid;
    if (!grid) {
      this.ref('import-status').textContent = t('terrain.importWaitDem');
      return;
    }
    try {
      const text = await file.text();
      const result = parseImportedBuildings(
        text,
        observer.latitudeDeg,
        observer.longitudeDeg,
        this.buildingRadiusM,
        {
          source: 'import',
          sourceLabel: file.name,
          fileName: file.name,
          retrievedAt: new Date().toISOString(),
          license: 'ODbL',
        },
      );
      if (result.buildings.length === 0) {
        this.ref('import-status').textContent = t('terrain.importNoPolygons');
        return;
      }
      this.buildingsResult = result;
      this.offlineBuildingsAppliedAt = this.offlinePrepared?.preparedAt ?? 0;
      this.lastBuildingKey = `${result.centerLatDeg.toFixed(5)}|${result.centerLonDeg.toFixed(
        5,
      )}|${Math.round(result.queryRadiusM)}`;
      this.preparedBuildings = prepareBuildings(grid, result.buildings);
      this.renderBuildingsInfo(result);
      this.scene?.setState({
        buildings: this.preparedBuildings,
        grid,
        horizon: this.profile,
      });
      this.recomputeProfileAtViewpoint();
      await putCachedBuildings(
        observer.latitudeDeg,
        observer.longitudeDeg,
        this.buildingRadiusM,
        result,
      );
      this.invalidateBestSpot(t('terrain.invalidateBuildingsImported'));
      this.ref('import-status').textContent = t(
        'terrain.importSuccessStatus',
        {
          count: result.buildings.length,
          file: file.name,
          defaultCount: result.defaultHeightCount,
        },
      );
      this.setStatus(
        t('terrain.importSuccessHost', {
          count: result.buildings.length,
          file: file.name,
        }),
        'good',
        true,
      );
      input.value = '';
      void this.updateCacheCounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ref('import-status').textContent = t('terrain.importFailedStatus', {
        message,
      });
      this.setStatus(
        t('terrain.importFailedHost', { message }),
        'bad',
        true,
      );
    }
  }

  private async fetchBuildingsNow(
    radiusOverride?: number,
    options: { quiet?: boolean } = {},
  ): Promise<BuildingsResult | null> {
    const observer = this.state?.observer;
    if (!observer || !this.mounted) return null;
    if (navigator.onLine === false) {
      if (this.offlinePrepared?.buildings) {
        this.applyOfflineBuildings();
        if (this.buildingsResult) return this.buildingsResult;
      }
      this.setStatus(
        t('terrain.buildingsOfflineStatus'),
        'warn',
        true,
      );
      this.ref('building-badge').textContent = t('terrain.buildingsOfflineBadge');
      this.ref('building-badge').className = 'tw-badge warn';
      return null;
    }
    if (this.buildingDebounce !== null) {
      window.clearTimeout(this.buildingDebounce);
      this.buildingDebounce = null;
    }
    if (Date.now() < this.buildingCooldownUntil) {
      this.showCooldown();
      return null;
    }
    const radius = clampNumber(
      radiusOverride ?? this.buildingRadiusM,
      50,
      5_000,
    );
    const key = `${observer.latitudeDeg.toFixed(5)}|${observer.longitudeDeg.toFixed(
      5,
    )}|${radius}`;
    if (this.buildingsResult && key === this.lastBuildingKey) {
      if (!options.quiet) {
        this.setStatus(
          t('terrain.buildingsAlreadyLoaded', {
            count: this.buildingsResult.buildings.length,
          }),
          'info',
        );
      }
      return this.buildingsResult;
    }
    this.buildingAbort?.abort();
    const controller = new AbortController();
    this.buildingAbort = controller;
    this.buildingLoading = true;
    this.ref('building-badge').textContent = t('terrain.badgeBuildingsLoading');
    this.ref('building-badge').className = 'tw-badge';
    try {
      const result = await fetchBuildings({
        latitudeDeg: observer.latitudeDeg,
        longitudeDeg: observer.longitudeDeg,
        radiusM: radius,
        baseUrl: import.meta.env.BASE_URL,
        allowBundled: true,
        signal: controller.signal,
        onProgress: (message) => {
          this.ref('building-detail').textContent = message;
        },
      });
      if (controller.signal.aborted) return null;
      this.buildingsResult = result;
      this.lastBuildingKey = key;
      this.buildingLoading = false;
      this.preparedBuildings = this.grid
        ? prepareBuildings(this.grid, result.buildings)
        : [];
      this.renderBuildingsInfo(result);
      this.scene?.setState({
        buildings: this.preparedBuildings,
        grid: this.grid,
        horizon: this.profile,
      });
      this.recomputeProfileAtViewpoint();
      if (!options.quiet) {
        this.invalidateBestSpot(t('terrain.invalidateBuildingsUpdated'));
      }
      this.setStatus(
        t('terrain.buildingsLoadedStatus', {
          count: result.buildings.length,
          radius: fmtKm(result.queryRadiusM, 1),
          defaultCount: result.defaultHeightCount,
          defaultHeight: DEFAULT_BUILDING_HEIGHT_M,
        }),
        result.buildings.length === 0 ? 'warn' : 'good',
      );
      this.api.setStatus(
        t('terrain.buildingsLoadedHost', {
          count: result.buildings.length,
        }),
      );
      void this.updateCacheCounts();
      return result;
    } catch (error) {
      if (controller.signal.aborted) return null;
      this.buildingLoading = false;
      if (error instanceof OverpassRateLimitError) {
        this.buildingCooldownUntil = Date.now() + error.retryAfterMs;
        this.startCooldownTimer();
        this.setStatus(error.message, 'bad', true);
        this.ref('building-badge').textContent = t('terrain.badgeBuildingsCooldown');
        this.ref('building-badge').className = 'tw-badge bad';
        this.ref('building-detail').textContent = t(
          'terrain.buildingsRateLimitDetail',
        );
      } else if (error instanceof OverpassTimeoutError) {
        this.setStatus(
          t('terrain.buildingsTimeoutStatus', { message: error.message }),
          'bad',
          true,
        );
        this.ref('building-badge').textContent = t('terrain.badgeBuildingsTimeout');
        this.ref('building-badge').className = 'tw-badge bad';
        this.ref('building-detail').textContent = t(
          'terrain.buildingsTimeoutDetail',
        );
      } else if (error instanceof OverpassRequestError) {
        this.setStatus(
          t('terrain.overpassError', { message: error.message }),
          'bad',
          true,
        );
        this.ref('building-badge').textContent = t('terrain.badgeBuildingsError');
        this.ref('building-badge').className = 'tw-badge bad';
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus(
          t('terrain.buildingFetchFailed', { message }),
          'bad',
          true,
        );
        this.ref('building-badge').textContent = t('terrain.badgeBuildingsError');
        this.ref('building-badge').className = 'tw-badge bad';
      }
      return null;
    } finally {
      if (this.buildingAbort === controller) this.buildingAbort = null;
    }
  }

  private renderBuildingsInfo(result: BuildingsResult): void {
    const share = defaultHeightShare(result);
    this.ref('building-info').textContent = t('terrain.buildingsInfo', {
      count: result.buildings.length,
      tagged: result.taggedHeightCount,
      defaultCount: result.defaultHeightCount,
      percent: (share * 100).toFixed(0),
      radius: fmtKm(result.queryRadiusM, 1),
      source: result.source,
      sourceLabel: result.sourceLabel
        ? t('terrain.buildingsSourceLabel', { label: result.sourceLabel })
        : '',
      retrieved: result.retrievedAt
        ? t('terrain.buildingsRetrieved', { time: result.retrievedAt })
        : '',
      osm: result.osmTimestamp
        ? t('terrain.buildingsOsm', { time: result.osmTimestamp })
        : '',
    });
    this.ref('building-badge').textContent = t('terrain.badgeBuildingsValue', {
      count: result.buildings.length,
      percent: (share * 100).toFixed(0),
    });
    this.ref('building-badge').className =
      result.buildings.length === 0 ? 'tw-badge warn' : 'tw-badge good';
    this.ref('building-detail').textContent =
      result.buildings.length === 0
        ? t('terrain.buildingsNoneDetail')
        : t('terrain.buildingsDefaultDetail', {
            defaultCount: result.defaultHeightCount,
            total: result.buildings.length,
            percent: (share * 100).toFixed(0),
          });
  }

  private startCooldownTimer(): void {
    this.stopCooldownTimer();
    this.showCooldown();
    this.cooldownTimer = window.setInterval(() => {
      if (Date.now() >= this.buildingCooldownUntil) {
        this.stopCooldownTimer();
        this.ref('building-detail').textContent = t(
          'terrain.buildingsCooldownFinished',
        );
        this.ref('building-badge').textContent = t('terrain.badgeBuildingsReady');
        this.ref('building-badge').className = 'tw-badge';
      } else {
        this.showCooldown();
      }
    }, 1_000);
  }

  private showCooldown(): void {
    const remaining = Math.max(
      0,
      Math.ceil((this.buildingCooldownUntil - Date.now()) / 1000),
    );
    if (remaining <= 0) return;
    this.ref('building-detail').textContent = t('terrain.buildingsCooldown', {
      seconds: remaining,
    });
    this.ref('building-badge').textContent = t(
      'terrain.badgeBuildingsCountdown',
      { seconds: remaining },
    );
    this.ref('building-badge').className = 'tw-badge bad';
  }

  private stopCooldownTimer(): void {
    if (this.cooldownTimer !== null) {
      window.clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  private async clearTerrainCache(): Promise<void> {
    await clearTerrainCache();
    this.lastTerrainKey = '';
    this.setStatus(t('terrain.cacheTerrainCleared'), 'info');
    void this.updateCacheCounts();
  }

  private async clearBuildingCacheNow(): Promise<void> {
    await clearBuildingCache();
    this.lastBuildingKey = '';
    this.setStatus(t('terrain.cacheBuildingCleared'), 'info');
    void this.updateCacheCounts();
  }

  private async updateCacheCounts(): Promise<void> {
    const [tiles, buildingQueries] = await Promise.all([
      cacheKeyCount('terrarium/'),
      cacheKeyCount('overpass/'),
    ]);
    this.ref('build-info').textContent = t('terrain.buildInfoValue', {
      tiles,
      queries: buildingQueries,
    });
  }

  private updateSearchArea(): void {
    const observer = this.state?.observer;
    if (!observer) return;
    this.map?.setSearchArea(
      observer.latitudeDeg,
      observer.longitudeDeg,
      this.searchRadiusM,
      this.buildingRadiusM,
    );
  }

  private ensurePath(): ApophisPathInfo | null {
    const session = this.api.getSession();
    if (!session) {
      this.ref('path-info').textContent = t('terrain.pathNoSession');
      return null;
    }
    const key = observerKey(session.observer);
    if (this.path && this.path.observerKey === key) return this.path;
    this.path = buildApophisPath(session, { stepSeconds: 30 });
    this.renderPathInfo();
    this.scene?.setState({
      path: this.path,
      utcMs: this.state?.utcMs ?? null,
      grid: this.grid,
      eyeHeightM: this.eyeHeightM,
    });
    return this.path;
  }

  private renderPathInfo(): void {
    const path = this.path;
    const session = this.api.getSession();
    if (!path || !session) {
      this.ref('path-info').textContent = t('terrain.pathNoSessionYet');
      return;
    }
    const maxSample = path.samples.reduce(
      (best, sample) =>
        sample.elevationDeg > best.elevationDeg ? sample : best,
      path.samples[0],
    );
    const interval = session.visibleIntervalForJump();
    const start = interval ? formatUtc(interval.startUtc.getTime()) : '—';
    const end = interval ? formatUtc(interval.endUtc.getTime()) : '—';
    this.ref('path-info').innerHTML = t('terrain.pathInfo', {
      sector: escapeHtml(formatSector(path.sector)),
      min: path.sector.minElevationDeg.toFixed(1),
      max: path.sector.maxElevationDeg.toFixed(1),
      maxUtc: escapeHtml(formatUtc(maxSample.utcMs)),
      start: escapeHtml(start),
      end: escapeHtml(end),
      samples: path.samples.length,
    });
    this.ref('parallax-info').textContent = t('terrain.parallaxInfo', {
      arcsec: path.parallax.arcsec.toFixed(2),
      range: path.parallax.rangeKm.toLocaleString('en-US', {
        maximumFractionDigits: 0,
      }),
      geocentricArcsec: path.parallaxAtGeocentricCa.arcsec.toFixed(2),
      geocentricRange: path.parallaxAtGeocentricCa.rangeKm.toLocaleString(
        'en-US',
        { maximumFractionDigits: 0 },
      ),
    });
    this.scheduleChart();
  }

  private recomputeProfileAtViewpoint(): void {
    const grid = this.grid;
    if (!grid) return;
    // The observer horizon must share the local ENU anchor with the 3D mesh
    // and camera. The Mercator observer sample (grid.observerGroundElevationM)
    // stays the shared astronomy ground, not the local scene ground. At Cape
    // Town the two differ by 0.92 m, which matters for a near obstruction.
    const point = {
      latitudeDeg: this.viewpointLatDeg,
      longitudeDeg: this.viewpointLonDeg,
      groundElevationM:
        this.viewingCandidate && Number.isFinite(this.viewpoint.groundElevationM)
          ? this.viewpoint.groundElevationM
          : sceneGroundElevationM(grid),
      eyeHeightM: this.eyeHeightM,
    };
    if (!Number.isFinite(point.groundElevationM)) return;
    this.viewpointInsideBuilding = null;
    const enu = latLonToEnu(
      this.viewpointLatDeg,
      this.viewpointLonDeg,
      grid.originLatDeg,
      grid.originLonDeg,
    );
    const inside = buildingAtPoint(
      this.preparedBuildings,
      enu.eastM,
      enu.northM,
    );
    if (
      inside &&
      point.groundElevationM + this.eyeHeightM <
        inside.baseElevationM + inside.heightM - 0.1
    ) {
      this.viewpointInsideBuilding = inside;
    }
    this.profile = computeHorizonProfile(
      grid,
      point,
      this.preparedBuildings,
      {
        stepDeg: 1,
        buildingMaxDistanceM: this.buildingRadiusM,
      },
    );
    this.scene?.setState({
      horizon: this.profile,
      grid,
      buildings: this.preparedBuildings,
      viewpoint: this.viewpoint,
      eyeHeightM: this.eyeHeightM,
      path: this.path,
      utcMs: this.state?.utcMs ?? null,
      nightMode: this.state?.toggles.nightMode ?? false,
    });
    this.renderHorizonInfo();
    this.scheduleChart();
  }

  private renderHorizonInfo(): void {
    const profile = this.profile;
    if (!profile) {
      this.ref('horizon-info').textContent = t('terrain.horizonEmpty');
      return;
    }
    let maxSample = profile.samples[0];
    for (const sample of profile.samples) {
      if (sample.elevationDeg > maxSample.elevationDeg) maxSample = sample;
    }
    const source =
      maxSample.source === 'building'
        ? t('terrain.horizonBuildingSource', {
            id: maxSample.sourceId ?? '?',
          })
        : maxSample.source;
    const location = this.viewingCandidate
      ? t('terrain.horizonCandidate', {
          lat: profile.pointLatDeg.toFixed(5),
          lon: profile.pointLonDeg.toFixed(5),
        })
      : t('terrain.horizonObserver');
    const insideWarning = this.viewpointInsideBuilding
      ? t('terrain.horizonInside', {
          id: this.viewpointInsideBuilding.id,
          height: fmtM(this.viewpointInsideBuilding.heightM),
        })
      : '';
    const anchorNote =
      !this.viewingCandidate &&
      this.grid &&
      Number.isFinite(this.grid.observerGroundElevationM) &&
      Math.abs(
        profile.groundElevationM - this.grid.observerGroundElevationM,
      ) > 0.1
        ? t('terrain.horizonAnchor', {
            ground: fmtM(this.grid.observerGroundElevationM),
          })
        : '';
    this.ref('horizon-info').textContent = t('terrain.horizonInfo', {
      location,
      ground: fmtM(profile.groundElevationM),
      eye: fmtM(profile.eyeHeightM),
      total: fmtM(profile.eyeElevationM),
      elevation: maxSample.elevationDeg.toFixed(1),
      azimuth: maxSample.azimuthDeg.toFixed(0),
      source,
      distance:
        maxSample.distanceM !== null
          ? t('terrain.horizonDistance', {
              distance: fmtKm(maxSample.distanceM, 1),
            })
          : '',
      buildings: profile.buildingCount,
      radius: fmtKm(this.buildingRadiusM, 1),
      anchor: anchorNote,
      inside: insideWarning,
    });
  }

  private scheduleChart(): void {
    if (!this.mounted) return;
    if (this.chartTimer !== null) return;
    this.chartTimer = window.setTimeout(() => {
      this.chartTimer = null;
      this.drawChartNow();
    }, 120);
  }

  private drawChartNow(): void {
    if (!this.mounted) return;
    drawHorizonChart(this.ref<HTMLCanvasElement>('horizon-chart'), {
      profile: this.profile,
      path: this.path,
      utcMs: this.state?.utcMs ?? null,
      marginDeg: this.marginDeg,
      nightMode: this.state?.toggles.nightMode ?? false,
    });
  }

  private renderSceneReadout(readout: SceneReadout): void {
    const marker =
      readout.markerAzimuthDeg === null || readout.markerElevationDeg === null
        ? t('terrain.sceneMarkerUnavailable')
        : t('terrain.sceneMarker', {
            az: readout.markerAzimuthDeg.toFixed(2),
            el: readout.markerElevationDeg.toFixed(2),
            horizon: readout.horizonAtMarkerDeg?.toFixed(1) ?? '—',
            state: readout.markerBelowHorizon
              ? t('terrain.sceneStateBelow')
              : readout.markerOccluded
                ? t('terrain.sceneStateOccluded')
                : t('terrain.sceneStateVisible'),
          });
    this.ref('scene-readout').textContent = t('terrain.sceneCamera', {
      az: readout.cameraAzimuthDeg.toFixed(1),
      el: readout.cameraElevationDeg.toFixed(1),
      fov: readout.fovDeg.toFixed(0),
      marker,
    });
    this.ref('fov').textContent = `${readout.fovDeg.toFixed(0)}°`;
  }

  private async runBestSpot(): Promise<void> {
    if (this.bestSpotBusy) return;
    const session = this.api.getSession();
    const grid = this.grid;
    if (!session || !grid) {
      this.setStatus(
        t('terrain.bestErrorNeedsDem'),
        'warn',
      );
      return;
    }
    if (session.visibility.intervals.length === 0) {
      const reason =
        session.visibility.reason || t('terrain.bestErrorNoWindow');
      this.ref('best-status').textContent = reason;
      this.setStatus(reason, 'warn', true);
      return;
    }
    const path = this.ensurePath();
    if (!path) return;
    this.bestSpotBusy = true;
    this.bestSpotCancelRequested = false;
    this.setBestBusy(true);
    this.setProgress('best-progress', 0.02);
    this.ref('best-status').textContent = t('terrain.bestStatusPreparing');

    const requiredBuildingRadius = clampNumber(
      this.searchRadiusM + this.buildingRadiusM,
      50,
      5_000,
    );
    let buildingsIncomplete = false;
    if (
      !this.buildingsResult ||
      this.buildingsResult.queryRadiusM < requiredBuildingRadius - 10 ||
      Math.abs(
        this.buildingsResult.centerLatDeg -
          (this.state?.observer?.latitudeDeg ?? 0),
      ) > 1e-4 ||
      Math.abs(
        this.buildingsResult.centerLonDeg -
          (this.state?.observer?.longitudeDeg ?? 0),
      ) > 1e-4
    ) {
      this.setStatus(
        t('terrain.bestStatusFetchingBuildings', {
          radius: fmtKm(requiredBuildingRadius, 1),
        }),
        'info',
      );
      const result = await this.fetchBuildingsNow(requiredBuildingRadius, {
        quiet: true,
      });
      if (!result) {
        buildingsIncomplete = true;
        this.setStatus(
          t('terrain.bestWarningBuildingsIncomplete'),
          'warn',
          true,
        );
      }
    } else {
      buildingsIncomplete =
        this.buildingsResult.queryRadiusM <
        this.searchRadiusM + this.buildingRadiusM - 10;
    }
    if (this.bestSpotCancelRequested) {
      this.finishBestSpot();
      return;
    }
    if (this.grid !== grid) {
      this.finishBestSpot();
      this.setStatus(
        t('terrain.bestWarningCancelled'),
        'warn',
      );
      return;
    }

    const candidates = generateSearchCandidates(
      grid,
      this.searchRadiusM,
      this.spacingM,
    );
    if (candidates.length === 0) {
      this.finishBestSpot();
      this.setStatus(
        t('terrain.bestErrorNoCandidates'),
        'bad',
        true,
      );
      return;
    }
    const buildings = prepareBuildings(
      grid,
      this.buildingsResult?.buildings ?? [],
    );
    this.preparedBuildings = buildings;
    const input: BestSpotInput = {
      grid,
      buildings,
      path: path.samples,
      candidates,
      eyeHeightM: this.eyeHeightM,
      marginDeg: this.marginDeg,
      buildingRadiusM: this.buildingRadiusM,
      radiusM: this.searchRadiusM,
      spacingM: this.spacingM,
      noVisibilityWindow: session.visibility.intervals.length === 0,
      buildingsIncomplete,
    };
    this.ref('best-status').textContent = t('terrain.bestStatusScoringStart', {
      count: candidates.length.toLocaleString('en-US'),
    });
    const requestId = ++this.bestSpotRequestId;
    const onProgress = (processed: number, total: number): void => {
      if (requestId !== this.bestSpotRequestId) return;
      const fraction = total > 0 ? processed / total : 0;
      this.setProgress('best-progress', fraction);
      this.ref('best-status').textContent = t('terrain.bestStatusScoring', {
        processed: processed.toLocaleString('en-US'),
        total: total.toLocaleString('en-US'),
      });
    };
    const onDone = (summary: BestSpotSummary): void => {
      if (requestId !== this.bestSpotRequestId) return;
      if (summary.cancelled) {
        this.finishBestSpot();
        this.setStatus(t('terrain.bestStatusCancelled'), 'info');
        return;
      }
      this.bestSpot = summary;
      this.finishBestSpot();
      this.setProgress('best-progress', 1);
      this.renderBestSpot(summary);
      this.map?.setBestSpots(summary, grid);
      const detail = summary.top[0]
        ? t('terrain.bestStatusCompleteClear', {
            percent: formatClearPercent(summary.top[0].scorePessimistic),
            lat: summary.top[0].latitudeDeg.toFixed(5),
            lon: summary.top[0].longitudeDeg.toFixed(5),
          })
        : t('terrain.bestStatusCompleteNoClear');
      const suffix = t('terrain.bestStatusCompleteSuffix', {
        count: summary.processed.toLocaleString('en-US'),
        seconds: (summary.elapsedMs / 1000).toFixed(1),
      });
      this.ref('best-status').textContent = `${t(
        'terrain.bestStatusCompletePrefix',
      )}${detail}${suffix}`;
      this.setStatus(
        t('terrain.bestHostStatus', { summary: `${detail}${suffix}` }),
        'good',
        true,
      );
      this.api.setStatus(
        t('terrain.bestHostTop', { count: summary.top.length }),
      );
    };
    const onError = (message: string): void => {
      if (requestId !== this.bestSpotRequestId) return;
      this.finishBestSpot();
      this.ref('best-status').textContent = t('terrain.bestStatusFailed', {
        message,
      });
      this.setStatus(
        t('terrain.bestStatusHostFailed', { message }),
        'bad',
        true,
      );
    };

    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(
          new URL('../workers/bestSpot.worker.ts', import.meta.url),
          { type: 'module' },
        );
        this.bestSpotWorker = worker;
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as
            | { type: 'progress'; requestId: number; processed: number; total: number }
            | { type: 'done'; requestId: number; summary: BestSpotSummary }
            | { type: 'error'; requestId: number; message: string };
          if (data.requestId !== requestId) return;
          if (data.type === 'progress') {
            onProgress(data.processed, data.total);
          } else if (data.type === 'done') {
            worker.terminate();
            if (this.bestSpotWorker === worker) this.bestSpotWorker = null;
            onDone(data.summary);
          } else if (data.type === 'error') {
            worker.terminate();
            if (this.bestSpotWorker === worker) this.bestSpotWorker = null;
            onError(data.message);
          }
        };
        worker.onerror = (event) => {
          worker.terminate();
          if (this.bestSpotWorker === worker) this.bestSpotWorker = null;
          onError(event.message || t('terrain.bestWorkerError'));
        };
        worker.postMessage({ type: 'run', requestId, input });
        return;
      } catch (error) {
        this.bestSpotWorker = null;
        console.warn('Worker unavailable, falling back to main thread:', error);
      }
    }

    const options: BestSpotRunOptions = {
      onProgress,
      shouldCancel: () => this.bestSpotCancelRequested,
      yieldEvery: 120,
    };
    try {
      const summary = await searchBestSpots(input, options);
      onDone(summary);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  private setBestBusy(busy: boolean): void {
    this.bestSpotBusy = busy;
    const runButton = this.root.querySelector<HTMLButtonElement>(
      '[data-action="run-best"]',
    );
    const cancelButton = this.root.querySelector<HTMLButtonElement>(
      '[data-action="cancel-best"]',
    );
    if (runButton) runButton.disabled = busy;
    if (cancelButton) cancelButton.disabled = !busy;
  }

  private cancelBestSpot(): void {
    if (!this.bestSpotBusy) return;
    this.bestSpotCancelRequested = true;
    this.bestSpotRequestId++;
    if (this.bestSpotWorker) {
      this.bestSpotWorker.terminate();
      this.bestSpotWorker = null;
    }
    this.finishBestSpot();
    this.setProgress('best-progress', 0);
    this.ref('best-status').textContent = t('terrain.bestStatusCancelledShort');
    this.setStatus(t('terrain.bestStatusCancelled'), 'info');
  }

  private finishBestSpot(): void {
    this.bestSpotBusy = false;
    this.bestSpotCancelRequested = false;
    this.bestSpotWorker?.terminate();
    this.bestSpotWorker = null;
    this.setBestBusy(false);
  }

  private renderBestSpot(summary: BestSpotSummary): void {
    const state = this.state;
    this.ref('best-summary').textContent = t('terrain.bestSummary', {
      count: summary.processed.toLocaleString('en-US'),
      radius: fmtKm(summary.radiusM, 1),
      spacing: summary.spacingM.toFixed(0),
      margin: summary.marginDeg.toFixed(1),
      pathSamples: summary.pathSamples,
      seconds: (summary.elapsedMs / 1000).toFixed(1),
    });
    this.ref('best-warning').textContent = summary.buildingsIncomplete
      ? t('terrain.bestWarningIncomplete')
      : '';
    const list = this.ref<HTMLOListElement>('best-list');
    list.innerHTML = '';
    if (summary.noVisibilityWindow) {
      list.innerHTML = `<li class="tw-result-empty">${escapeHtml(
        this.api.getSession()?.visibility.reason ||
          t('terrain.bestErrorNoWindow'),
      )}</li>`;
      this.ref('best-detail').textContent = '';
      return;
    }
    for (const [index, result] of summary.top.entries()) {
      const li = document.createElement('li');
      li.dataset.resultIndex = String(result.index);
      const timeZone = state?.timeZone ?? 'UTC';
      const reason = describeBestSpot(result, {
        timeZone,
        marginDeg: this.marginDeg,
      });
      const blockerParts: string[] = [];
      if (result.blockedByDefaultHeightBuildingSamples > 0) {
        blockerParts.push(
          t('terrain.blockersDefault', {
            count: result.blockedByDefaultHeightBuildingSamples,
          }),
        );
      }
      if (result.blockedByRealHeightBuildingSamples > 0) {
        blockerParts.push(
          t('terrain.blockersReal', {
            count: result.blockedByRealHeightBuildingSamples,
          }),
        );
      }
      if (result.blockedByTerrainSamples > 0) {
        blockerParts.push(t('terrain.blockersTerrain'));
      }
      const blockers =
        blockerParts.length > 0
          ? blockerParts.join(' · ')
          : t('terrain.blockersNone');
      const openSpace =
        result.nearestBuildingM === null
          ? t('terrain.openNoBuildings')
          : result.nearestBuildingM < 1
            ? t('terrain.openInside')
            : t('terrain.openNearest', {
                distance: result.nearestBuildingM.toFixed(0),
              });
      const rankFlag =
        result.rankSpread >= 5
          ? `<span class="tw-badge warn" title="${t(
              'terrain.rankFlagTitle',
            )}">${t('terrain.rankFlag', {
              spread: result.rankSpread,
            })}</span>`
          : '';
      li.innerHTML = `<span class="tw-rank">${t('terrain.rank', {
        rank: index + 1,
      })}</span>
        <span class="tw-score" style="--tw-score:${(result.scorePessimistic * 100).toFixed(0)}%">${escapeHtml(
          formatClearPercent(result.scorePessimistic),
        )}%</span>
        <span class="tw-result-text"><strong>${result.latitudeDeg.toFixed(
          5,
        )}°, ${result.longitudeDeg.toFixed(5)}°</strong> ${rankFlag}<br />
          <span class="tw-score-range">${escapeHtml(
            t('terrain.scoreRange', {
              optimistic: formatClearPercent(result.scoreOptimistic),
              pessimistic: formatClearPercent(result.scorePessimistic),
            }),
          )}</span><br />
          ${escapeHtml(reason)}<br />
          <span class="tw-small">${escapeHtml(
            t('terrain.blockers', {
              blockers,
              openSpace,
            }),
          )}</span>
        </span>`;
      list.appendChild(li);
    }
    if (summary.top.length === 0) {
      list.innerHTML = `<li class="tw-result-empty">${t(
        'terrain.bestDetailEmpty',
      )}</li>`;
    }
    this.ref('best-detail').textContent = t('terrain.bestDetailHint');
    this.renderFieldChecks(summary);
  }

  private selectResult(index: number): void {
    const summary = this.bestSpot;
    if (!summary) return;
    const result = summary.candidates.find((candidate) => candidate.index === index);
    if (!result) return;
    this.viewingCandidate = true;
    this.viewpoint = {
      eastM: result.eastM,
      northM: result.northM,
      groundElevationM: result.groundElevationM,
    };
    this.viewpointLatDeg = result.latitudeDeg;
    this.viewpointLonDeg = result.longitudeDeg;
    this.map?.clearViewpoint();
    this.map?.setViewpoint(result.latitudeDeg, result.longitudeDeg);
    this.map?.focus(result.latitudeDeg, result.longitudeDeg, 16);
    this.recomputeProfileAtViewpoint();
    this.scene?.setState({ viewpoint: this.viewpoint });
    this.scene?.lookAtApophis();
    this.ref('best-detail').innerHTML = `${t('terrain.bestViewpoint', {
      rank:
        summary.top.findIndex((item) => item.index === index) + 1,
      lat: result.latitudeDeg.toFixed(5),
      lon: result.longitudeDeg.toFixed(5),
      ground: fmtM(result.groundElevationM),
      score: (result.scorePessimistic * 100).toFixed(0),
      optimistic: (result.scoreOptimistic * 100).toFixed(0),
      rankPessimistic: result.rankPessimistic,
      rankOptimistic: result.rankOptimistic,
      spread: result.rankSpread,
      clearance: result.minClearanceDegPessimistic.toFixed(1),
      reason: escapeHtml(
        describeBestSpot(result, {
          timeZone: this.state?.timeZone ?? 'UTC',
          marginDeg: this.marginDeg,
        }),
      ),
    })} <button class="tw-btn ghost" data-action="use-observer" data-index="${
      result.index
    }" type="button">${t('terrain.bestMakeObserver')}</button>`;
  }

  private renderFieldChecks(summary: BestSpotSummary): void {
    const node = this.ref('field-check');
    if (summary.top.length === 0) {
      node.innerHTML = '';
      return;
    }
    const rows = summary.top.slice(0, 3).map((result, index) => {
      const key = fieldCheckKey(result.latitudeDeg, result.longitudeDeg);
      const record = this.fieldChecks[key];
      const status = record?.status ?? 'unknown';
      return `<div class="tw-field-item">
        <div class="tw-field-title">${t('terrain.fieldCheckItemTitle', {
          rank: index + 1,
          lat: result.latitudeDeg.toFixed(5),
          lon: result.longitudeDeg.toFixed(5),
        })}</div>
        <div class="tw-row tw-row-wrap" role="group" aria-label="${t(
          'terrain.fieldCheckGroupAria',
          { rank: index + 1 },
        )}">
          <button class="tw-btn small ${status === 'pass' ? 'primary' : 'ghost'}" data-action="field-pass" data-index="${
            result.index
          }" aria-pressed="${status === 'pass'}" type="button">${t(
            'terrain.fieldCheckPass',
          )}</button>
          <button class="tw-btn small ${status === 'fail' ? 'danger' : 'ghost'}" data-action="field-fail" data-index="${
            result.index
          }" aria-pressed="${status === 'fail'}" type="button">${t(
            'terrain.fieldCheckFail',
          )}</button>
          <span class="tw-chip">${
            status === 'unknown'
              ? t('terrain.fieldCheckNotChecked')
              : status
          }</span>
        </div>
        <label class="tw-field">${t('terrain.fieldCheckNoteLabel')}
          <input data-field-note data-index="${result.index}" value="${escapeHtml(
            record?.note ?? '',
          )}" placeholder="${t('terrain.fieldCheckNotePlaceholder')}" />
        </label>
      </div>`;
    });
    node.innerHTML = `<div class="tw-field-head"><strong>${t(
      'terrain.fieldCheckTitle',
    )}</strong><span class="tw-note">${t(
      'terrain.fieldCheckNote',
    )}</span></div>
      <div class="tw-field-grid">${rows.join('')}</div>`;
  }

  private recordFieldCheck(index: number, status: 'pass' | 'fail'): void {
    const result = this.bestSpot?.top.find((item) => item.index === index);
    if (!result) return;
    this.fieldChecks = setFieldCheck(
      this.fieldChecks,
      result.latitudeDeg,
      result.longitudeDeg,
      status,
    );
    if (this.bestSpot) this.renderFieldChecks(this.bestSpot);
  }

  private recordFieldNote(index: number, note: string): void {
    const result = this.bestSpot?.top.find((item) => item.index === index);
    if (!result) return;
    const key = fieldCheckKey(result.latitudeDeg, result.longitudeDeg);
    this.fieldChecks = setFieldCheck(
      this.fieldChecks,
      result.latitudeDeg,
      result.longitudeDeg,
      this.fieldChecks[key]?.status ?? 'unknown',
      note,
    );
  }

  private useCandidateAsObserver(index: number): void {
    const result = this.bestSpot?.candidates.find((item) => item.index === index);
    if (!result) return;
    this.recenterOnNextUpdate = true;
    this.api.setObserver(
      result.latitudeDeg,
      result.longitudeDeg,
      result.groundElevationM,
    );
  }

  private invalidateBestSpot(message: string): void {
    if (!this.bestSpot && !this.bestSpotBusy) return;
    this.bestSpot = null;
    this.bestSpotCancelRequested = true;
    this.bestSpotRequestId++;
    this.bestSpotWorker?.terminate();
    this.bestSpotWorker = null;
    this.bestSpotBusy = false;
    this.setBestBusy(false);
    this.setProgress('best-progress', 0);
    this.map?.clearBestSpots();
    this.ref<HTMLOListElement>('best-list').innerHTML = '';
    this.ref('best-summary').textContent = t('terrain.bestSummaryNone');
    this.ref('best-warning').textContent = '';
    this.ref('best-status').textContent = message;
    this.ref('best-detail').textContent = '';
    this.ref('field-check').innerHTML = '';
  }

  private setProgress(refId: string, fraction: number): void {
    const bar = this.ref(refId);
    bar.style.width = `${Math.round(clampNumber(fraction, 0, 1) * 100)}%`;
  }

  private setStatus(
    message: string,
    kind: 'info' | 'good' | 'warn' | 'bad' = 'info',
    notifyHost = false,
  ): void {
    const node = this.ref('status');
    node.textContent = message;
    node.className = `tw-status ${kind}`;
    if (notifyHost) this.api.setStatus(message);
  }

  private setOfflineBusy(busy: boolean): void {
    this.offlineBusy = busy;
    const prepare = this.root.querySelector<HTMLButtonElement>(
      '[data-action="prepare-offline"]',
    );
    const cancel = this.root.querySelector<HTMLButtonElement>(
      '[data-action="cancel-offline"]',
    );
    const clear = this.root.querySelector<HTMLButtonElement>(
      '[data-action="clear-offline"]',
    );
    if (prepare) prepare.disabled = busy;
    if (cancel) cancel.disabled = !busy;
    if (clear) clear.disabled = busy;
  }

  private async prepareOffline(): Promise<void> {
    if (this.offlineBusy) return;
    const observer = this.state?.observer;
    if (!observer) {
      this.setStatus(t('terrain.offlineErrorNoObserver'), 'warn');
      return;
    }
    if (navigator.onLine === false) {
      this.setStatus(
        t('terrain.offlineErrorOffline'),
        'bad',
        true,
      );
      return;
    }
    const controller = new AbortController();
    this.offlineAbort = controller;
    this.setOfflineBusy(true);
    this.setProgress('offline-progress', 0.01);
    this.ref('offline-status').textContent = t('terrain.offlineStatusPreparing');
    this.ref('offline-warning').textContent = '';
    try {
      const result = await prepareOfflineArea({
        observer,
        searchRadiusM: this.searchRadiusM,
        buildingRadiusM: this.buildingRadiusM,
        spacingM: this.spacingM,
        marginDeg: this.marginDeg,
        baseUrl: import.meta.env.BASE_URL,
        signal: controller.signal,
        onProgress: (progress) => {
          this.setProgress('offline-progress', progress.fraction);
          this.ref('offline-status').textContent = progress.message;
        },
      });
      this.offlinePrepared = result.snapshot;
      this.lastVerifiedPreparedAt = result.snapshot.preparedAt;
      this.api.setOfflineSnapshot?.(result.snapshot);
      this.setProgress('offline-progress', 1);
      this.ref('offline-status').textContent = t(
        'terrain.offlinePreparedStatus',
        {
          bytes: formatBytes(result.snapshot.totalBytes),
          date: formatPreparedDate(result.snapshot.preparedAt),
        },
      );
      this.ref('offline-warning').textContent = result.warnings.join(' ');
      this.setStatus(t('terrain.offlinePreparedHost'), 'good', true);
      this.renderOfflineStatus(true);
      this.applyOfflineBuildings();
      this.maybeApplyOfflineMap();
    } catch (error) {
      if (controller.signal.aborted) {
        this.ref('offline-status').textContent = t(
          'terrain.offlineStatusCancelled',
        );
        this.setStatus(t('terrain.offlineStatusCancelled'), 'info');
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.ref('offline-status').textContent = t(
          'terrain.offlineStatusFailed',
          { message },
        );
        this.ref('offline-warning').textContent = message;
        this.setStatus(
          t('terrain.offlineStatusFailed', { message }),
          'bad',
          true,
        );
      }
    } finally {
      this.offlineAbort = null;
      this.setOfflineBusy(false);
    }
  }

  private cancelOffline(): void {
    this.offlineAbort?.abort();
    this.offlineAbort = null;
    this.setProgress('offline-progress', 0);
    this.ref('offline-status').textContent = t('terrain.offlineStatusCancelled');
    this.setOfflineBusy(false);
  }

  private async clearOffline(): Promise<void> {
    if (this.offlineBusy) return;
    if (!window.confirm(t('terrain.offlineClearConfirm'))) {
      return;
    }
    await clearOfflineData();
    this.offlinePrepared = null;
    this.lastVerifiedPreparedAt = 0;
    this.api.setOfflineSnapshot?.(null);
    this.map?.clearOfflineBaseMap();
    this.map?.setOfflineMode(navigator.onLine === false);
    this.setProgress('offline-progress', 0);
    this.ref('offline-status').textContent = t('terrain.offlineStatusNone');
    this.ref('offline-contents').innerHTML = '';
    this.ref('offline-warning').textContent = '';
    this.setStatus(t('terrain.offlineCleared'), 'info', true);
    void this.renderOfflineStatus(true);
  }

  private async renderOfflineStatus(initial: boolean): Promise<void> {
    const snapshot =
      this.api.getOfflineSnapshot?.() ?? this.offlinePrepared ?? null;
    this.offlinePrepared = snapshot;
    const state = this.state;
    const key = [
      snapshot?.preparedAt,
      snapshot?.totalBytes,
      state?.offline.active,
      state?.offline.mismatch,
      state?.observer?.latitudeDeg,
      state?.observer?.longitudeDeg,
      state?.toggles.nightMode,
    ].join('|');
    if (!initial && key === this.lastOfflineRenderKey) return;
    this.lastOfflineRenderKey = key;

    const status = this.ref('offline-status');
    const contents = this.ref('offline-contents');
    const warning = this.ref('offline-warning');
    if (!snapshot) {
      status.textContent = state?.offline.active
        ? t('terrain.offlineStatusOfflineNoSnapshot')
        : t('terrain.offlineStatusNone');
      contents.innerHTML = '';
    } else {
      const b = snapshot.buildings;
      const active = state?.offline.active
        ? t('terrain.offlineRunning')
        : '';
      status.textContent = t('terrain.offlineStatusPrepared', {
        date: formatPreparedDate(snapshot.preparedAt),
        bytes: formatBytes(snapshot.totalBytes),
        active,
      });
      contents.innerHTML = `
        ${t('terrain.offlineContentsEphemeris', {
          provider: escapeHtml(snapshot.ephemeris.provider),
          solution: escapeHtml(snapshot.ephemeris.solution),
          retrieved: escapeHtml(snapshot.ephemeris.retrievedAt),
          bytes: formatBytes(snapshot.ephemeris.bytes),
        })}
        ${t('terrain.offlineContentsStars', {
          stars: snapshot.stars
            ? `${escapeHtml(snapshot.stars.source)} · ${formatBytes(
                snapshot.stars.bytes,
              )}`
            : t('terrain.offlineNotStored'),
        })}
        ${t('terrain.offlineContentsTerrain', {
          tiles: snapshot.terrain.tileCount,
          zoom: snapshot.area.terrainZoom,
          bytes: formatBytes(snapshot.terrain.bytes),
          attribution: escapeHtml(snapshot.terrain.attribution),
        })}
        ${t('terrain.offlineContentsBuildings', {
          buildings: b
            ? t('terrain.offlineBuildingsValue', {
                count: b.count,
                defaultCount: b.defaultHeightCount,
                bytes: formatBytes(b.bytes),
                source: escapeHtml(b.source),
                sourceLabel: b.sourceLabel
                  ? t('terrain.buildingsSourceLabel', {
                      label: escapeHtml(b.sourceLabel),
                    })
                  : '',
              })
            : t('terrain.offlineBuildingsMissing'),
        })}
        ${t('terrain.offlineContentsBaseMap')}
      `;
    }
    if (state?.offline.mismatch) {
      warning.textContent = t('terrain.offlineMismatchWarning');
    } else if (snapshot?.warnings.length) {
      warning.textContent = snapshot.warnings.join(' ');
    } else {
      warning.textContent = '';
    }

    if (snapshot && snapshot.preparedAt !== this.lastVerifiedPreparedAt) {
      this.lastVerifiedPreparedAt = snapshot.preparedAt;
      const integrity = await verifyPreparedSnapshot();
      if (integrity && !integrity.ok) {
        warning.textContent =
          integrity.message ?? t('terrain.offlineIncomplete');
      }
    }

    const storage = await storageInfo();
    this.ref('offline-storage').textContent = storage.supported
      ? t('terrain.offlineStorage', {
          persistence: storage.persisted
            ? t('terrain.offlinePersistent')
            : t('terrain.offlineBestEffort'),
          used:
            storage.usageBytes === null
              ? t('terrain.unknown')
              : formatBytes(storage.usageBytes),
          quota:
            storage.quotaBytes === null
              ? t('terrain.unknown')
              : formatBytes(storage.quotaBytes),
        })
      : t('terrain.offlineStorageUnavailable');
    this.maybeApplyOfflineMap();
  }

  private applyOfflineBuildings(): void {
    const snapshot = this.offlinePrepared;
    if (!snapshot || !this.state?.offline.active) return;
    if (this.offlineBuildingsAppliedAt === snapshot.preparedAt && this.buildingsResult) {
      return;
    }
    const result = buildingsFromSnapshot(snapshot);
    if (!result) return;
    this.offlineBuildingsAppliedAt = snapshot.preparedAt;
    this.buildingsResult = result;
    this.lastBuildingKey = `${result.centerLatDeg.toFixed(5)}|${result.centerLonDeg.toFixed(
      5,
    )}|${Math.round(result.queryRadiusM)}`;
    this.preparedBuildings = this.grid
      ? prepareBuildings(this.grid, result.buildings)
      : [];
    this.renderBuildingsInfo(result);
    this.scene?.setState({
      buildings: this.preparedBuildings,
      grid: this.grid,
      horizon: this.profile,
    });
    this.recomputeProfileAtViewpoint();
    this.setStatus(
      t('terrain.offlineLoadedFromSnapshot', {
        count: result.buildings.length,
        retrieved: result.retrievedAt ?? t('terrain.unknown'),
      }),
      'info',
    );
  }

  private maybeApplyOfflineMap(): void {
    const state = this.state;
    if (!this.map || !state) return;
    if (!state.offline.active) {
      this.map.setOfflineMode(false);
      return;
    }
    this.map.setOfflineMode(true);
    if (!this.grid || state.offline.mismatch) {
      this.map.clearOfflineBaseMap();
      return;
    }
    const buildings = this.buildingsResult?.buildings ?? [];
    const key = `${this.grid.createdAt}|${buildings.length}|${state.toggles.nightMode}`;
    if (key === this.lastOfflineMapKey) return;
    this.lastOfflineMapKey = key;
    const rendered = renderOfflineBaseMap(
      this.grid,
      buildings,
      state.toggles.nightMode,
    );
    if (!rendered) {
      this.map.clearOfflineBaseMap();
      return;
    }
    this.map.setOfflineBaseMap(rendered.dataUrl, this.grid.bbox);
  }

  private renderStaticText(): void {
    this.renderEyeNote();
    this.renderGroundNote();
    this.ref('best-list').innerHTML = '';
    this.ref('best-summary').textContent = t('terrain.bestSummaryInitial');
    this.ref('fov').textContent = '62°';
    this.ref('build-info').textContent = t('terrain.footerBuildInfoInitial');
    this.ref('offline-status').textContent = t('terrain.offlineStatusNone');
    this.ref('offline-contents').innerHTML = '';
    this.ref('field-check').innerHTML = `<p class="tw-note">${t(
      'terrain.fieldCheckEmpty',
    )}</p>`;
  }
}
