/**
 * Terrain tab UI and orchestration.
 *
 * Everything is mounted inside the host-provided root. Shared app state is
 * read-only here; observer/ground/time changes go through TerrainHostApi.
 */

import { formatLocal, formatUtc } from '../ui/timeFormat';
import type { UiState } from '../state/store';
import {
  DEFAULT_BUILDING_HEIGHT_M,
  OverpassRateLimitError,
  OverpassRequestError,
  OverpassTimeoutError,
  defaultHeightShare,
  fetchBuildings,
} from './buildings';
import { cacheKeyCount, clearBuildingCache, clearTerrainCache } from './cache';
import { latLonToEnu } from './geo';
import { computeHorizonProfile } from './horizon';
import { drawHorizonChart } from './horizonChart';
import type { TerrainHostApi, TerrainWorkstream } from './host';
import { TerrainMap } from './mapView';
import { buildApophisPath, formatSector, observerKey } from './path';
import { LocalScene3D, type SceneReadout } from './scene3d';
import {
  describeBestSpot,
  formatClearPercent,
  generateSearchCandidates,
  searchBestSpots,
  type BestSpotInput,
  type BestSpotRunOptions,
} from './bestSpot';
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
    this.renderStaticText();
  }

  private ref<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.refs[id] as T;
  }

  private template(): string {
    return `
      <div class="tw-head">
        <div class="tw-head-title">
          <h2>Terrain, buildings &amp; best spot</h2>
          <p>Local horizon from the AWS Terrarium DEM and OpenStreetMap buildings, with the Phase 1 Apophis path.</p>
        </div>
        <div class="tw-head-badges">
          <span class="tw-badge" data-ref="dem-badge">DEM: —</span>
          <span class="tw-badge" data-ref="building-badge">Buildings: —</span>
        </div>
      </div>
      <div class="tw-status" data-ref="status" role="status" aria-live="polite">Ready. Pick a point on the map or enter coordinates.</div>

      <div class="tw-grid tw-grid-2">
        <section class="tw-card">
          <h3>Observer &amp; map</h3>
          <div class="tw-map" data-ref="map" aria-label="OpenStreetMap location picker"></div>
          <div class="tw-row tw-row-wrap">
            <label class="tw-field">Latitude °
              <input data-ref="lat" inputmode="decimal" placeholder="45.6427" />
            </label>
            <label class="tw-field">Longitude °
              <input data-ref="lon" inputmode="decimal" placeholder="25.5887" />
            </label>
            <button class="tw-btn" data-action="apply-observer" type="button">Apply</button>
            <button class="tw-btn ghost" data-action="use-browser-location" type="button">Re-center on map</button>
          </div>
          <div class="tw-row tw-row-wrap">
            <label class="tw-field">Eye height (m)
              <input data-ref="eye" type="number" min="0" max="200" step="0.1" value="1.7" />
            </label>
            <label class="tw-field">Viewpoint
              <select data-ref="eye-mode">
                <option value="ground">Ground / custom eye height</option>
                <option value="floor">Floor N</option>
                <option value="rooftop">Rooftop (tallest OSM building)</option>
              </select>
            </label>
            <label class="tw-field tw-floor-field">Floor N
              <input data-ref="floor" type="number" min="1" max="100" step="1" value="3" />
            </label>
          </div>
          <p class="tw-note" data-ref="eye-note">Eye height 1.7 m above DEM ground. Floor N uses (N−1)×3 m + 1.7 m; rooftop uses the tallest OSM building at the point + 1.7 m.</p>
          <p class="tw-note tw-ground-note" data-ref="ground-note">Ground elevation: waiting for DEM.</p>
          <p class="tw-note">Ground elevation is taken from the DEM. Browser GPS altitude is only a cross-check and is never used. Eye height is added above the DEM ground for the shared sky/AR observer.</p>
        </section>

        <section class="tw-card">
          <h3>Terrain &amp; buildings</h3>
          <div class="tw-split">
            <div>
              <p class="tw-note tw-strong" data-ref="dem-info">DEM: not loaded.</p>
              <div class="tw-progress" aria-hidden="true"><div data-ref="terrain-progress"></div></div>
              <div class="tw-row tw-row-wrap">
                <button class="tw-btn" data-action="reload-terrain" type="button">Reload DEM</button>
                <button class="tw-btn ghost" data-action="clear-terrain-cache" type="button">Clear tile cache</button>
              </div>
              <p class="tw-note" data-ref="terrain-detail">AWS Terrarium z15 max; tiles cached in IndexedDB.</p>
            </div>
            <div>
              <p class="tw-note tw-strong" data-ref="building-info">Buildings: not loaded.</p>
              <div class="tw-row tw-row-wrap">
                <button class="tw-btn" data-action="load-buildings" type="button">Fetch buildings</button>
                <button class="tw-btn ghost" data-action="clear-building-cache" type="button">Clear cache</button>
              </div>
              <label class="tw-field">Building radius (m)
                <input data-ref="building-radius" type="number" min="50" max="5000" step="50" value="1000" />
              </label>
              <p class="tw-note" data-ref="building-detail">Overpass: one debounced query per settled view; no polling.</p>
            </div>
          </div>
          <div class="tw-credits">
            <strong>Terrain:</strong> Terrain Tiles by Mapzen / AWS Open Data. Sources include Copernicus EU-DEM, USGS 3DEP/NED, GMTED2010 and SRTM, NOAA ETOPO1, ArcticDEM (DigitalGlobe/NSF), Geoscience Australia, Austria DGM, Canada OGL, INEGI Mexico, LINZ New Zealand, Kartverket Norway and the UK Environment Agency. <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Full attribution</a>.
            <br /><strong>Buildings:</strong> © OpenStreetMap contributors, ODbL. Overpass API.
            <br /><strong>Height priority:</strong> <code>building:height</code> → <code>height</code> → <code>building:levels</code>×3 → 8 m default.
          </div>
        </section>
      </div>

      <div class="tw-grid tw-grid-2">
        <section class="tw-card">
          <h3>Local 3D view <span class="tw-subtitle">eye-height view</span></h3>
          <div class="tw-scene" data-ref="scene" aria-label="Local 3D terrain and building view"></div>
          <div class="tw-row tw-row-wrap">
            <button class="tw-btn" data-action="look-apophis" type="button">Look at Apophis</button>
            <button class="tw-btn ghost" data-nav="0" type="button">N</button>
            <button class="tw-btn ghost" data-nav="90" type="button">E</button>
            <button class="tw-btn ghost" data-nav="180" type="button">S</button>
            <button class="tw-btn ghost" data-nav="270" type="button">W</button>
            <span class="tw-chip">FOV <span data-ref="fov">62°</span></span>
          </div>
          <div class="tw-row">
            <label class="tw-grow">Time
              <input data-ref="time" type="range" min="0" max="10000" step="1" value="5000" aria-label="Time scrub" />
            </label>
            <span class="tw-chip" data-ref="time-label">—</span>
          </div>
          <p class="tw-note" data-ref="scene-readout">Drag to look, scroll/pinch to zoom. The horizon and Apophis trail are depth-tested against the terrain and buildings.</p>
          <p class="tw-note">The trail uses the once-per-area path. Light pollution is <strong>not</strong> modelled; visibility here is geometric skyline clearance only.</p>
        </section>

        <section class="tw-card">
          <h3>Horizon profile <span class="tw-subtitle">1° bins</span></h3>
          <canvas class="tw-chart" data-ref="horizon-chart" aria-label="Horizon elevation angle by azimuth"></canvas>
          <p class="tw-note" data-ref="horizon-info">Load a DEM to compute the local horizon.</p>
          <p class="tw-note tw-strong" data-ref="path-info">Apophis path: waiting for the simulation session.</p>
          <p class="tw-note" data-ref="parallax-info">Parallax check: —</p>
        </section>
      </div>

      <section class="tw-card">
        <h3>Best spot <span class="tw-subtitle">Apophis path computed once per area</span></h3>
        <div class="tw-row tw-row-wrap">
          <label class="tw-field">Search radius (m)
            <input data-ref="search-radius" type="number" min="500" max="10000" step="100" value="3000" />
          </label>
          <label class="tw-field">Grid spacing (m)
            <input data-ref="spacing" type="number" min="50" max="100" step="10" value="100" />
          </label>
          <label class="tw-field">Minimum elevation margin (°)
            <input data-ref="margin" type="number" min="0" max="20" step="0.5" value="2" />
          </label>
          <button class="tw-btn primary" data-action="run-best" type="button">Run search</button>
          <button class="tw-btn danger" data-action="cancel-best" type="button" disabled>Cancel</button>
        </div>
        <div class="tw-progress" aria-hidden="true"><div data-ref="best-progress"></div></div>
        <p class="tw-note tw-strong" data-ref="best-status">No search yet. The score is the fraction of the physical Phase 1 visibility window above the local horizon plus the margin.</p>
        <div class="tw-split tw-best-split">
          <div>
            <p class="tw-note">Heatmap: red = 0% clear, green = 100% clear. Tap a numbered result to teleport the local 3D camera and map. The app-wide observer is not changed unless you use “Make this the observer”.</p>
            <p class="tw-note" data-ref="best-summary">—</p>
            <p class="tw-note" data-ref="best-warning"></p>
          </div>
          <ol class="tw-results" data-ref="best-list"></ol>
        </div>
        <div class="tw-note" data-ref="best-detail"></div>
        <p class="tw-note">Light pollution, sky brightness, weather and trees are not modelled. Buildings come from OSM and may be missing or stale; default-height buildings are marked amber in 3D. Score is geometric skyline clearance only.</p>
      </section>

      <footer class="tw-footer">
        <p><strong>Method:</strong> AWS Terrarium DEM (Mapzen/joerd) → local ENU mesh with Earth curvature; Overpass <code>way["building"](around:…);out geom;</code>; horizon ray march at 1° azimuth; Phase 1 topocentric Apophis path computed once at the search centre. The 5 km parallax is tens of arcseconds, far below the 1° horizon bin. <strong>Light pollution is not modelled.</strong></p>
        <p><strong>Licences:</strong> Terrain Tiles by Mapzen / AWS Open Data · © OpenStreetMap contributors (ODbL) · Overpass API. Map tiles © OpenStreetMap contributors. See the project notices for full source attribution.</p>
        <p class="tw-mono" data-ref="build-info">Terrain workstream · phases: DEM, buildings, horizon, best spot, local 3D</p>
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
        default:
          break;
      }
    });

    this.root.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
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
            this.invalidateBestSpot('Building radius changed; run the search again.');
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
            this.invalidateBestSpot('Search radius changed; run the search again.');
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
            this.invalidateBestSpot('Grid spacing changed; run the search again.');
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
            this.invalidateBestSpot('Elevation margin changed; run the search again.');
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
      this.setStatus('No observer is set. Enter coordinates or pick a point on the map.', 'warn');
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
      this.invalidateBestSpot('Observer changed; run the search again.');
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
      this.ref('dem-badge').textContent = 'DEM: loading…';
      this.ref('dem-badge').className = 'tw-badge';
      this.ref('building-badge').textContent = 'Buildings: —';
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
      ? `${utc.slice(0, 16)}Z · ${local.slice(11, 16)} local`
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
      this.setStatus('Latitude must be between −90° and +90°.', 'bad');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      this.setStatus('Longitude must be between −180° and +180°.', 'bad');
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
        'Rooftop needs building data at the observer. Fetch buildings first.',
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
        'No OSM building footprint at this point; rooftop unavailable. Using the ground eye height.',
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
      `Rooftop of OSM way ${building.id}: ${building.heightM.toFixed(
        1,
      )} m (${building.heightSource === 'default' ? 'default 8 m height' : building.heightSource}) + 1.7 m eye.`,
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
    this.invalidateBestSpot('Eye height changed; run the search again.');
    this.scheduleChart();
  }

  private renderEyeNote(extra?: string): void {
    const base =
      this.eyeMode === 'floor'
        ? `Floor ${this.floor}: ${fmtM(this.eyeHeightM)} above DEM ground ((N−1)×3 m + 1.7 m).`
        : this.eyeMode === 'rooftop'
          ? `Rooftop: ${fmtM(this.eyeHeightM)} above DEM ground.`
          : `Eye height ${fmtM(this.eyeHeightM)} above DEM ground.`;
    const hostNote = this.api.setEyeHeightM
      ? 'The shared session eye height is updated through the optional host setter.'
      : 'The shared session has no eye-height setter in the required API, so this value is local to the terrain tab; the sky tab keeps its own eye height.';
    this.ref('eye-note').textContent = `${base} ${extra ?? ''} Floor N uses (N−1)×3 m + 1.7 m; rooftop uses the tallest OSM building + 1.7 m. ${hostNote}`;
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
    const requestKey = `${observer.latitudeDeg.toFixed(6)}|${observer.longitudeDeg.toFixed(
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
      `Loading DEM tiles around ${observer.latitudeDeg.toFixed(
        4,
      )}°, ${observer.longitudeDeg.toFixed(4)}°…`,
      'info',
    );
    try {
      const grid = await loadTerrainGrid({
        latitudeDeg: observer.latitudeDeg,
        longitudeDeg: observer.longitudeDeg,
        radiusM: this.terrainRadius(),
        maxTiles: MAX_TILES,
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
      this.setStatus(
        `DEM ready: z${grid.zoom}, ${grid.spacingM.toFixed(
          1,
        )} m/px, ${grid.requestedTiles} tiles (${
          grid.failedTiles
        } failed). Ground elevation ${Number.isFinite(
          grid.observerGroundElevationM,
        ) ? fmtM(grid.observerGroundElevationM) : 'unknown'}.`,
        grid.failedTiles > 0 ? 'warn' : 'good',
      );
      this.api.setStatus(
        `Terrain DEM z${grid.zoom} at ${grid.spacingM.toFixed(1)} m/px loaded.`,
      );
      void this.updateCacheCounts();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.terrainLoading = false;
      this.setProgress('terrain-progress', 0);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`DEM load failed: ${message}. Check the tile service and retry.`, 'bad', true);
      this.ref('dem-badge').textContent = 'DEM: failed';
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
      this.ref('dem-badge').textContent = `DEM: ${progress.loaded}/${progress.total}`;
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
    const ground = observer?.groundElevationM;
    if (ground === null || ground === undefined) {
      this.ref('ground-note').textContent =
        'Ground elevation: unknown until the DEM loads. GPS altitude is not used.';
      return;
    }
    this.ref('ground-note').textContent = `Ground elevation from DEM: ${fmtM(
      ground,
    )} above sea level. Browser GPS altitude is ignored; it is only a cross-check. Effective eye altitude: ${fmtM(
      ground + this.eyeHeightM,
    )}.`;
  }

  private renderDemInfo(grid: TerrainGrid): void {
    const widthKm = (grid.width * grid.spacingEastM) / 1000;
    const heightKm = (grid.height * grid.spacingNorthM) / 1000;
    this.ref('dem-info').textContent = `DEM: z${grid.zoom} · ${grid.spacingM.toFixed(
      1,
    )} m/px · ${widthKm.toFixed(1)} × ${heightKm.toFixed(
      1,
    )} km · ${grid.requestedTiles} tiles (${grid.cachedTiles} cached, ${
      grid.networkTiles
    } network, ${grid.failedTiles} failed) · ground ${Number.isFinite(
      grid.observerGroundElevationM,
    ) ? fmtM(grid.observerGroundElevationM) : 'unknown'}.`;
    this.ref('dem-badge').textContent = `DEM: z${grid.zoom} ${grid.spacingM.toFixed(
      1,
    )} m/px`;
    this.ref('dem-badge').className =
      grid.failedTiles > 0 ? 'tw-badge warn' : 'tw-badge good';
    this.ref('terrain-detail').textContent =
      grid.failedTiles > 0
        ? `${grid.failedTiles} tiles failed; gaps are transparent in 3D and skipped in the horizon. Use Reload DEM to retry.`
        : `Tile-aligned Web Mercator grid resampled to a local ENU frame; Earth curvature applied for distances > 5 km.`;
  }

  private scheduleBuildings(): void {
    if (!this.mounted) return;
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

  private async fetchBuildingsNow(
    radiusOverride?: number,
    options: { quiet?: boolean } = {},
  ): Promise<BuildingsResult | null> {
    const observer = this.state?.observer;
    if (!observer || !this.mounted) return null;
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
          `Buildings already loaded for this view (${this.buildingsResult.buildings.length} ways).`,
          'info',
        );
      }
      return this.buildingsResult;
    }
    this.buildingAbort?.abort();
    const controller = new AbortController();
    this.buildingAbort = controller;
    this.buildingLoading = true;
    this.ref('building-badge').textContent = 'Buildings: loading…';
    this.ref('building-badge').className = 'tw-badge';
    try {
      const result = await fetchBuildings({
        latitudeDeg: observer.latitudeDeg,
        longitudeDeg: observer.longitudeDeg,
        radiusM: radius,
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
        this.invalidateBestSpot('Buildings updated; run the search again.');
      }
      this.setStatus(
        `Buildings: ${result.buildings.length} ways within ${fmtKm(
          result.queryRadiusM,
          1,
        )}; ${result.defaultHeightCount} use the ${DEFAULT_BUILDING_HEIGHT_M} m default.`,
        result.buildings.length === 0 ? 'warn' : 'good',
      );
      this.api.setStatus(
        `Terrain buildings loaded: ${result.buildings.length} OSM ways.`,
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
        this.ref('building-badge').textContent = 'Buildings: cooldown';
        this.ref('building-badge').className = 'tw-badge bad';
        this.ref('building-detail').textContent =
          'Overpass returned HTTP 429. No automatic retry will be made; wait for the cooldown, then press Fetch buildings.';
      } else if (error instanceof OverpassTimeoutError) {
        this.setStatus(
          `${error.message} No automatic retry; press Fetch buildings to try again.`,
          'bad',
          true,
        );
        this.ref('building-badge').textContent = 'Buildings: timeout';
        this.ref('building-badge').className = 'tw-badge bad';
        this.ref('building-detail').textContent =
          'Overpass timed out or was slow. Data may be incomplete; the best-spot search can still run with existing buildings.';
      } else if (error instanceof OverpassRequestError) {
        this.setStatus(`Overpass error: ${error.message}`, 'bad', true);
        this.ref('building-badge').textContent = 'Buildings: error';
        this.ref('building-badge').className = 'tw-badge bad';
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus(`Building fetch failed: ${message}`, 'bad', true);
        this.ref('building-badge').textContent = 'Buildings: error';
        this.ref('building-badge').className = 'tw-badge bad';
      }
      return null;
    } finally {
      if (this.buildingAbort === controller) this.buildingAbort = null;
    }
  }

  private renderBuildingsInfo(result: BuildingsResult): void {
    const share = defaultHeightShare(result);
    this.ref('building-info').textContent = `Buildings: ${result.buildings.length} ways · ${result.taggedHeightCount} tagged · ${result.defaultHeightCount} default (${(share * 100).toFixed(
      0,
    )}%) · query ${fmtKm(result.queryRadiusM, 1)} · ${result.source}${
      result.osmTimestamp ? ` · OSM ${result.osmTimestamp}` : ''
    }.`;
    this.ref('building-badge').textContent = `Buildings: ${result.buildings.length} (${(share * 100).toFixed(0)}% default)`;
    this.ref('building-badge').className =
      result.buildings.length === 0 ? 'tw-badge warn' : 'tw-badge good';
    this.ref('building-detail').textContent =
      result.buildings.length === 0
        ? 'No building ways found in this radius. The horizon will use terrain only.'
        : `${result.defaultHeightCount} of ${result.buildings.length} ways (${(share * 100).toFixed(
            0,
          )}%) use the 8 m fallback height; these extrude amber in 3D. Height priority: building:height → height → building:levels×3 → 8 m. ODbL © OpenStreetMap contributors.`;
  }

  private startCooldownTimer(): void {
    this.stopCooldownTimer();
    this.showCooldown();
    this.cooldownTimer = window.setInterval(() => {
      if (Date.now() >= this.buildingCooldownUntil) {
        this.stopCooldownTimer();
        this.ref('building-detail').textContent =
          'Overpass cooldown finished. Press Fetch buildings to query once.';
        this.ref('building-badge').textContent = 'Buildings: ready';
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
    this.ref('building-detail').textContent = `Overpass cooldown: ${remaining} s remaining. No automatic retry.`;
    this.ref('building-badge').textContent = `Buildings: ${remaining}s`;
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
    this.setStatus('Terrain tile cache cleared.', 'info');
    void this.updateCacheCounts();
  }

  private async clearBuildingCacheNow(): Promise<void> {
    await clearBuildingCache();
    this.lastBuildingKey = '';
    this.setStatus('Building cache cleared.', 'info');
    void this.updateCacheCounts();
  }

  private async updateCacheCounts(): Promise<void> {
    const [tiles, buildingQueries] = await Promise.all([
      cacheKeyCount('terrarium/'),
      cacheKeyCount('overpass/'),
    ]);
    this.ref('build-info').textContent = `Terrain workstream · cached DEM tiles: ${tiles} · cached Overpass queries: ${buildingQueries}`;
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
      this.ref('path-info').textContent =
        'Apophis path: the simulation session is not ready.';
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
      this.ref('path-info').textContent =
        'Apophis path: no simulation session yet.';
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
    this.ref('path-info').innerHTML = `Apophis path (Phase 1, airless): <strong>${escapeHtml(
      formatSector(path.sector),
    )}</strong>; elevation ${path.sector.minElevationDeg.toFixed(
      1,
    )}°–${path.sector.maxElevationDeg.toFixed(1)}°, max at ${escapeHtml(
      formatUtc(maxSample.utcMs),
    )}. Physical visibility ${escapeHtml(start)} → ${escapeHtml(
      end,
    )}; ${path.samples.length} samples at 30 s. The path is computed <strong>once</strong> for this search area, not per candidate.`;
    this.ref('parallax-info').textContent = `Parallax over a 5 km baseline: ${path.parallax.arcsec.toFixed(
      2,
    )}″ at ${path.parallax.rangeKm.toLocaleString('en-US', {
      maximumFractionDigits: 0,
    })} km (worst on the visible path); ${path.parallaxAtGeocentricCa.arcsec.toFixed(
      2,
    )}″ at ${path.parallaxAtGeocentricCa.rangeKm.toLocaleString('en-US', {
      maximumFractionDigits: 0,
    })} km (geocentric CA). This is <1° horizon-bin width and shifts edge-of-ridge timing by seconds, not the ranking.`;
    this.scheduleChart();
  }

  private recomputeProfileAtViewpoint(): void {
    if (!this.grid) return;
    const point = {
      latitudeDeg: this.viewpointLatDeg,
      longitudeDeg: this.viewpointLonDeg,
      groundElevationM:
        this.viewingCandidate && Number.isFinite(this.viewpoint.groundElevationM)
          ? this.viewpoint.groundElevationM
          : this.grid.observerGroundElevationM,
      eyeHeightM: this.eyeHeightM,
    };
    if (!Number.isFinite(point.groundElevationM)) return;
    this.viewpointInsideBuilding = null;
    const enu = latLonToEnu(
      this.viewpointLatDeg,
      this.viewpointLonDeg,
      this.grid.originLatDeg,
      this.grid.originLonDeg,
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
      this.grid,
      point,
      this.preparedBuildings,
      {
        stepDeg: 1,
        buildingMaxDistanceM: this.buildingRadiusM,
      },
    );
    this.scene?.setState({
      horizon: this.profile,
      grid: this.grid,
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
      this.ref('horizon-info').textContent =
        'Load a DEM to compute the local horizon.';
      return;
    }
    let maxSample = profile.samples[0];
    for (const sample of profile.samples) {
      if (sample.elevationDeg > maxSample.elevationDeg) maxSample = sample;
    }
    const source =
      maxSample.source === 'building'
        ? `building way ${maxSample.sourceId ?? '?'}`
        : maxSample.source;
    const location = this.viewingCandidate
      ? `candidate ${profile.pointLatDeg.toFixed(5)}°, ${profile.pointLonDeg.toFixed(5)}°`
      : 'observer';
    const insideWarning = this.viewpointInsideBuilding
      ? ` The viewpoint is inside OSM building way ${this.viewpointInsideBuilding.id} (${fmtM(
          this.viewpointInsideBuilding.heightM,
        )} high); the ground 3D view is inside its walls. Choose Rooftop or move the point.`
      : '';
    this.ref('horizon-info').textContent = `Horizon at ${location}: ground ${fmtM(
      profile.groundElevationM,
    )} + eye ${fmtM(profile.eyeHeightM)} = ${fmtM(
      profile.eyeElevationM,
    )}; 360 bins at 1°; highest obstruction ${maxSample.elevationDeg.toFixed(
      1,
    )}° at az ${maxSample.azimuthDeg.toFixed(0)}° (${source}${
      maxSample.distanceM !== null
        ? `, ${fmtKm(maxSample.distanceM, 1)} away`
        : ''
    }); ${profile.buildingCount} buildings considered (within ${fmtKm(
      this.buildingRadiusM,
      1,
    )}). Terrain ray distance is limited by the DEM patch.${insideWarning}`;
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
        ? 'Apophis marker unavailable.'
        : `Apophis az ${readout.markerAzimuthDeg.toFixed(
            2,
          )}° el ${readout.markerElevationDeg.toFixed(
            2,
          )}°; horizon ${readout.horizonAtMarkerDeg?.toFixed(1) ?? '—'}° → ${
            readout.markerBelowHorizon
              ? 'below horizon'
              : readout.markerOccluded
                ? 'occluded by terrain/buildings'
                : 'visible'
          }.`;
    this.ref('scene-readout').textContent = `Camera az ${readout.cameraAzimuthDeg.toFixed(
      1,
    )}° el ${readout.cameraElevationDeg.toFixed(1)}° · FOV ${readout.fovDeg.toFixed(
      0,
    )}°. ${marker}`;
    this.ref('fov').textContent = `${readout.fovDeg.toFixed(0)}°`;
  }

  private async runBestSpot(): Promise<void> {
    if (this.bestSpotBusy) return;
    const session = this.api.getSession();
    const grid = this.grid;
    if (!session || !grid) {
      this.setStatus(
        'Best spot needs a loaded DEM and a simulation session. Wait for the DEM, then retry.',
        'warn',
      );
      return;
    }
    if (session.visibility.intervals.length === 0) {
      const reason =
        session.visibility.reason || 'No physical visibility window at this observer.';
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
    this.ref('best-status').textContent =
      'Preparing the search area and building coverage…';

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
        `Fetching buildings covering the search area (${fmtKm(
          requiredBuildingRadius,
          1,
        )})…`,
        'info',
      );
      const result = await this.fetchBuildingsNow(requiredBuildingRadius, {
        quiet: true,
      });
      if (!result) {
        buildingsIncomplete = true;
        this.setStatus(
          'Building data could not be expanded to cover the whole search area. Scores may be optimistic; buildings from the previous query are still used where available.',
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
        'Observer or DEM changed during the building fetch; search cancelled. Run it again.',
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
        'No candidate grid points fall inside the DEM. Reload the DEM or choose a smaller radius.',
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
    this.ref('best-status').textContent = `Scoring ${candidates.length.toLocaleString(
      'en-US',
    )} candidates in a Web Worker…`;
    const requestId = ++this.bestSpotRequestId;
    const onProgress = (processed: number, total: number): void => {
      if (requestId !== this.bestSpotRequestId) return;
      const fraction = total > 0 ? processed / total : 0;
      this.setProgress('best-progress', fraction);
      this.ref('best-status').textContent = `Scoring ${processed.toLocaleString(
        'en-US',
      )} / ${total.toLocaleString('en-US')} candidates…`;
    };
    const onDone = (summary: BestSpotSummary): void => {
      if (requestId !== this.bestSpotRequestId) return;
      if (summary.cancelled) {
        this.finishBestSpot();
        this.setStatus('Best-spot search cancelled.', 'info');
        return;
      }
      this.bestSpot = summary;
      this.finishBestSpot();
      this.setProgress('best-progress', 1);
      this.renderBestSpot(summary);
      this.map?.setBestSpots(summary, grid);
      const summaryText = `Search complete: ${
        summary.top[0]
          ? `${formatClearPercent(summary.top[0].score)}% clear at ${summary.top[0].latitudeDeg.toFixed(5)}°, ${summary.top[0].longitudeDeg.toFixed(5)}°`
          : 'no clear candidates'
      } · ${summary.processed.toLocaleString('en-US')} candidates in ${(
        summary.elapsedMs / 1000
      ).toFixed(1)} s.`;
      this.ref('best-status').textContent = summaryText;
      this.setStatus(
        `Best spot: ${summaryText.replace('Search complete: ', '')}`,
        'good',
        true,
      );
      this.api.setStatus(
        `Terrain best-spot search found ${summary.top.length} top candidates.`,
      );
    };
    const onError = (message: string): void => {
      if (requestId !== this.bestSpotRequestId) return;
      this.finishBestSpot();
      this.ref('best-status').textContent = `Search failed: ${message}`;
      this.setStatus(`Best-spot search failed: ${message}`, 'bad', true);
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
          onError(event.message || 'worker error');
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
    this.ref('best-status').textContent = 'Search cancelled.';
    this.setStatus('Best-spot search cancelled.', 'info');
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
    this.ref('best-summary').textContent = `${summary.processed.toLocaleString(
      'en-US',
    )} candidates · ${fmtKm(summary.radiusM, 1)} radius · ${summary.spacingM.toFixed(
      0,
    )} m spacing · ${summary.marginDeg.toFixed(
      1,
    )}° margin · ${summary.pathSamples} path samples · ${(
      summary.elapsedMs / 1000
    ).toFixed(1)} s. Score = fraction of the physical Phase 1 visibility window above the local horizon + margin.`;
    this.ref('best-warning').textContent = summary.buildingsIncomplete
      ? 'Warning: the Overpass query did not cover the full search area, so some buildings may be missing. Treat open-looking spots as provisional.'
      : '';
    const list = this.ref<HTMLOListElement>('best-list');
    list.innerHTML = '';
    if (summary.noVisibilityWindow) {
      list.innerHTML = `<li class="tw-result-empty">${escapeHtml(
        this.api.getSession()?.visibility.reason ||
          'No physical visibility window at this observer.',
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
      li.innerHTML = `<span class="tw-rank">#${index + 1}</span>
        <span class="tw-score" style="--tw-score:${(result.score * 100).toFixed(0)}%">${escapeHtml(
          formatClearPercent(result.score),
        )}%</span>
        <span class="tw-result-text"><strong>${result.latitudeDeg.toFixed(
          5,
        )}°, ${result.longitudeDeg.toFixed(5)}°</strong><br />${escapeHtml(
          reason,
        )}</span>`;
      list.appendChild(li);
    }
    if (summary.top.length === 0) {
      list.innerHTML =
        '<li class="tw-result-empty">No scored candidates. Check the DEM coverage.</li>';
    }
    this.ref('best-detail').textContent =
      'Tap a result to move the local 3D camera and map. The app-wide observer and the shared Phase 1 path are unchanged.';
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
    this.ref('best-detail').innerHTML = `<strong>Local viewpoint #${
      summary.top.findIndex((item) => item.index === index) + 1
    }</strong> at ${result.latitudeDeg.toFixed(5)}°, ${result.longitudeDeg.toFixed(
      5,
    )}° · ground ${fmtM(result.groundElevationM)} · score ${(
      result.score * 100
    ).toFixed(0)}% · min clearance ${result.minClearanceDeg.toFixed(
      1,
    )}°. ${escapeHtml(describeBestSpot(result, {
      timeZone: this.state?.timeZone ?? 'UTC',
      marginDeg: this.marginDeg,
    }))} <button class="tw-btn ghost" data-action="use-observer" data-index="${
      result.index
    }" type="button">Make this the observer</button>`;
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
    this.ref('best-summary').textContent = 'No current search result.';
    this.ref('best-warning').textContent = '';
    this.ref('best-status').textContent = message;
    this.ref('best-detail').textContent = '';
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

  private renderStaticText(): void {
    this.renderEyeNote();
    this.renderGroundNote();
    this.ref('best-list').innerHTML = '';
    this.ref('best-summary').textContent = 'No search yet.';
    this.ref('fov').textContent = '62°';
    this.ref('build-info').textContent =
      'Terrain workstream · cached DEM tiles: — · cached Overpass queries: —';
  }
}
