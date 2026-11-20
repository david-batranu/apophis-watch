import { jdTdbFromDate } from '../core/time';
import type { ArWorkstream } from '../ar/host';
import type { TerrainWorkstream } from '../terrain/host';
import type { SkyPosition } from '../ephemeris/types';
import type { AppModel, EphemerisSourceInfo } from '../state/appModel';
import type { SimulationSession } from '../state/session';
import type { UiState } from '../state/store';
import { solarSystemBodies, separationDeg, type BodyPosition } from '../sky/bodies';
import type { StarCatalogue } from '../sky/catalog';
import { comparisonAtDistance } from '../sky/sizeComparison';
import { SkyView, type SkyDebugSnapshot } from '../sky/skyRenderer';
import { SpaceView } from '../sky/spaceView';
import { initPwa, type PwaController } from '../pwa';
import {
  formatBytes,
  formatPreparedDate,
  storageInfo,
  type OfflineSnapshot,
} from '../offline/snapshot';
import { ElevationPlot } from './elevationPlot';
import { EventGuide } from './eventGuide';
import { formatLocal, formatLocalLocale, formatUtc, localHhMm } from './timeFormat';

type JumpButton = {
  kind:
    | 'topocentricCa'
    | 'geocentricCa'
    | 'rise'
    | 'set'
    | 'maxElevation'
    | 'visibilityStart'
    | 'visibilityEnd';
  label: string;
};

const JUMPS: JumpButton[] = [
  { kind: 'topocentricCa', label: 'Topocentric CA' },
  { kind: 'geocentricCa', label: 'Geocentric CA' },
  { kind: 'rise', label: 'Rise' },
  { kind: 'set', label: 'Set' },
  { kind: 'maxElevation', label: 'Max elevation' },
  { kind: 'visibilityStart', label: 'Visibility start' },
  { kind: 'visibilityEnd', label: 'Visibility end' },
];

const SPEEDS = [1, 5, 10, 30, 60, 300, 600];

function fmtDeg(value: number, digits = 2): string {
  return `${value.toFixed(digits)}°`;
}

function fmtKm(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

function fmtArcsec(value: number): string {
  if (value >= 3600) return `${(value / 3600).toFixed(3)}°`;
  return `${value.toFixed(3)}″`;
}

function esc(value: string): string {
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

export class AppUi {
  private readonly skyView: SkyView;
  private readonly spaceView: SpaceView;
  private readonly plot: ElevationPlot;
  private readonly eventGuide: EventGuide;
  private readonly debug: boolean;
  private readonly refs: Record<string, HTMLElement> = {};
  private lastSession: SimulationSession | null = null;
  private lastSizeKey = '';
  private lastPlotKey = '';
  private lastStripKey = '';
  private lastStripHtml = '';
  private lastObserverKey = '';
  private ar: ArWorkstream | null = null;
  private arLoading = false;
  private terrain: TerrainWorkstream | null = null;
  private terrainLoading = false;
  private pwa: PwaController | null = null;
  private pwaBannerKind: 'update' | 'offline' | null = null;
  private lastAboutKey = '';
  private aboutStorageText = 'Storage status not checked yet.';
  private offlineSnapshot: OfflineSnapshot | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly app: AppModel,
    private readonly catalogue: StarCatalogue | null,
  ) {
    this.debug = new URLSearchParams(window.location.search).get('debug') === '1';
    this.root.innerHTML = this.template();
    this.cacheRefs();
    this.plot = new ElevationPlot(this.ref('plot-host'));
    this.skyView = new SkyView(this.ref('sky-panel'), this.ref('sky-canvas') as HTMLCanvasElement);
    this.spaceView = new SpaceView(this.ref('space-host'));
    this.eventGuide = new EventGuide(this.ref('event-guide'), app);
    this.bind();
    this.populatePresets();
    this.renderCredits();
    this.renderAbout();
    this.initPwa();
    this.app.onState((state) => this.onState(state));
  }

  private ref(id: string): HTMLElement {
    return this.refs[id];
  }

  private initPwa(): void {
    this.pwa = initPwa({
      onNeedRefresh: () => {
        this.showPwaBanner(
          'update',
          'A new version is ready. Reload when convenient; the prepared offline area is kept.',
        );
      },
      onOfflineReady: () => {
        this.showPwaBanner(
          'offline',
          'App shell cached for offline use. Open Local 3D and press “Prepare for offline” to store terrain and buildings.',
        );
      },
      onError: (error) => {
        this.setError(`Service worker: ${String(error)}`);
      },
    });
    this.ref('pwa-primary').addEventListener('click', () => {
      if (this.pwaBannerKind === 'update') {
        void this.pwa?.reload();
      } else {
        this.hidePwaBanner();
      }
    });
    this.ref('pwa-dismiss').addEventListener('click', () => this.hidePwaBanner());
    this.ref('check-updates').addEventListener('click', () => {
      const status = this.ref('update-status');
      status.textContent = 'Checking for a new build…';
      void this.pwa?.check().then(() => {
        window.setTimeout(() => {
          status.textContent = this.pwa?.hasWaitingUpdate()
            ? 'A new build is ready; use Reload in the banner.'
            : 'No update found (or the browser is offline).';
        }, 1_500);
      });
    });
  }

  private showPwaBanner(kind: 'update' | 'offline', text: string): void {
    this.pwaBannerKind = kind;
    this.ref('pwa-banner-text').textContent = text;
    this.ref('pwa-primary').textContent = kind === 'update' ? 'Reload' : 'Got it';
    this.ref('pwa-banner').classList.remove('hidden');
    this.ref('pwa-banner').classList.toggle('update', kind === 'update');
  }

  private hidePwaBanner(): void {
    this.pwaBannerKind = null;
    this.ref('pwa-banner').classList.add('hidden');
  }

  private cacheRefs(): void {
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-ref]')) {
      const id = node.dataset.ref!;
      this.refs[id] = node;
    }
  }

  private template(): string {
    const jumpButtons = JUMPS.map(
      (j) => `<button class="btn small" data-jump="${j.kind}">${j.label}</button>`,
    ).join('');
    const speedOptions = SPEEDS.map(
      (s) => `<option value="${s}">${s}×</option>`,
    ).join('');
    return `
      <div class="app-shell">
        <a class="skip-link" href="#main-content">Skip to main content</a>
        <header class="topbar">
          <div class="brand">APOPHIS WATCH <span>(99942) Apophis · 13 April 2029</span></div>
          <div class="top-actions">
            <span class="chip" data-ref="location-chip">Location</span>
            <button class="chip chip-button" data-ref="offline-chip" type="button" aria-label="Offline status and preparation">Offline: checking…</button>
            <button class="btn" data-ref="night-button" type="button" aria-pressed="false">Night mode</button>
          </div>
        </header>
        <div class="app-banner hidden" data-ref="pwa-banner" role="status" aria-live="polite">
          <span data-ref="pwa-banner-text"></span>
          <span class="app-banner-actions">
            <button class="btn small primary" data-ref="pwa-primary" type="button">Reload</button>
            <button class="btn small ghost" data-ref="pwa-dismiss" type="button">Later</button>
          </span>
        </div>
        <main class="main" id="main-content" tabindex="-1">
          <div class="bar bar-between">
            <div class="tabs" role="tablist" aria-label="View">
              <button class="tab" id="tab-sky" role="tab" aria-controls="panel-sky" aria-selected="true" tabindex="0" data-view="sky" type="button">Sky view</button>
              <button class="tab" id="tab-space" role="tab" aria-controls="panel-space" aria-selected="false" tabindex="-1" data-view="space" type="button">Space view</button>
              <button class="tab" id="tab-local" role="tab" aria-controls="panel-local" aria-selected="false" tabindex="-1" data-view="local" type="button">Local 3D</button>
              <button class="tab" id="tab-ar" role="tab" aria-controls="panel-ar" aria-selected="false" tabindex="-1" data-view="ar" type="button">AR</button>
            </div>
            <div class="chip" data-ref="window-chip">Data window: —</div>
          </div>
          <div class="status-line error hidden" data-ref="error-line" role="alert"></div>
          <div class="status-line hidden" data-ref="aux-status" role="status" aria-live="polite"></div>
          <div class="status-line offline-line hidden" data-ref="offline-line" role="status"></div>
          <section class="grid-main">
            <div class="stage-card">
              <div class="sky-stage" id="panel-sky" role="tabpanel" aria-labelledby="tab-sky" data-ref="sky-panel" aria-label="Stereographic sky dome">
                <canvas class="sky-canvas" data-ref="sky-canvas" tabindex="0" aria-label="Sky dome. Drag or use arrow keys to look; plus and minus zoom; zero resets."></canvas>
                <div class="stage-topline">
                  <span class="badge" data-ref="sky-refraction-badge">refracted</span>
                  <span class="badge" data-ref="sky-visibility-badge">—</span>
                </div>
                <div class="stage-hint">Drag to look · pinch/scroll to zoom · double-click reset</div>
              </div>
              <div class="space-stage hidden" id="panel-space" role="tabpanel" aria-labelledby="tab-space" data-ref="space-panel">
                <div class="space-host" data-ref="space-host"></div>
                <div class="space-overlay">
                  <button class="btn small" data-camera="earth" type="button">Earth</button>
                  <button class="btn small" data-camera="flyby" type="button">Flyby</button>
                  <button class="btn small" data-camera="moon" type="button">Moon orbit</button>
                  <button class="btn small" data-camera="top" type="button">Top-down</button>
                  <button class="btn small" data-ref="space-reset" type="button">Reset cameras</button>
                </div>
                <div class="space-legend">
                  1 scene unit = 1,000 km · Earth radius 6,378 km · GEO ring 42,164 km · Moon orbit 384,400 km<br />
                  Apophis is a true-scale point; its 340 m disc is invisible at this scale.
                </div>
              </div>
              <div class="terrain-view-stage hidden" id="panel-local" role="tabpanel" aria-labelledby="tab-local" data-ref="local-panel">
                <div data-ref="terrain-host"></div>
              </div>
              <div class="ar-view-stage hidden" id="panel-ar" role="tabpanel" aria-labelledby="tab-ar" data-ref="ar-panel">
                <div class="ar-host" data-ref="ar-host"></div>
              </div>
            </div>
            <aside class="aside-stack">
              <section class="panel">
                <h2>Live readout</h2>
                <div class="readout-grid">
                  ${this.metric('az', 'Azimuth', '—')}
                  ${this.metric('el', 'Elevation', '—')}
                  ${this.metric('range', 'Range', '—')}
                  ${this.metric('rate', 'Angular rate', '—')}
                  ${this.metric('mag', 'V magnitude', '—')}
                  ${this.metric('size', 'Angular size', '—')}
                  ${this.metric('moon', 'Moon separation', '—')}
                  ${this.metric('view', 'Visibility', '—')}
                </div>
                <div class="status-line" data-ref="readout-note">—</div>
                <div class="trail-strip" data-ref="trail-strip">—</div>
              </section>
              <section class="panel">
                <h2>Time</h2>
                <div class="clock-block">
                  <div class="clock-utc" data-ref="utc-clock">—</div>
                  <div class="clock-local" data-ref="local-clock">—</div>
                </div>
                <div class="time-controls" style="margin-top: 10px">
                  <div class="bar">
                    <button class="btn primary" data-ref="play-button" type="button">▶ Play</button>
                    <label class="toggle">Speed
                      <select class="field" data-ref="speed-select">${speedOptions}</select>
                    </label>
                  </div>
                  <div class="scrub">
                    <span class="scrub-label" data-ref="window-start">—</span>
                    <input type="range" min="0" max="10000" step="1" value="5000" data-ref="scrub" aria-label="Time scrub" />
                    <span class="scrub-label" data-ref="window-end">—</span>
                  </div>
                  <div class="jump-grid">${jumpButtons}</div>
                </div>
              </section>
            </aside>
          </section>
          <section class="analysis-grid">
            <section class="panel">
              <h2>Elevation &amp; magnitude vs time</h2>
              <div class="plot-wrap" data-ref="plot-host"></div>
              <div class="status-line">Elevation line is airless geometric elevation (the readout may be refracted) · magnitude line (lower is brighter) · shaded: Phase 1 visibility (Sun &lt; −6°) · dashed: good-viewing threshold.</div>
            </section>
            <section class="panel">
              <h2>Size honesty</h2>
              <div data-ref="size-panel"></div>
            </section>
          </section>
          <section class="controls-grid">
            <section class="panel">
              <h2>Observer</h2>
              <div class="field">
                <label for="preset-select">Preset</label>
                <select id="preset-select" data-ref="preset-select">
                  <option value="">Custom / browser location</option>
                </select>
              </div>
              <div class="field-grid" style="margin-top: 8px">
                <div class="field"><label for="lat">Latitude °</label><input id="lat" data-ref="lat" inputmode="decimal" placeholder="45.6427" /></div>
                <div class="field"><label for="lon">Longitude °</label><input id="lon" data-ref="lon" inputmode="decimal" placeholder="25.5887" /></div>
                <div class="field"><label for="elev">Ground elev. m (optional)</label><input id="elev" data-ref="elev" inputmode="decimal" placeholder="unknown" /></div>
                <div class="field"><label for="eye">Eye height m</label><input id="eye" data-ref="eye" inputmode="decimal" value="1.7" /></div>
              </div>
              <div class="bar" style="margin-top: 8px">
                <button class="btn" data-ref="apply-observer" type="button">Apply coordinates</button>
                <button class="btn ghost" data-ref="use-location" type="button">Use my location</button>
              </div>
              <p class="status-line" data-ref="location-status">—</p>
              <p class="status-line">Height is eye height above ground: <strong>no terrain/DEM yet</strong>; GPS altitude is ignored. Phase 3 adds the map picker and terrain.</p>
            </section>
            <section class="panel">
              <h2>Display</h2>
              <div class="toggle-grid">
                <label class="toggle"><input type="checkbox" data-ref="toggle-refraction" /> Refraction (display only)</label>
                <label class="toggle"><input type="checkbox" data-ref="toggle-constellations" /> Constellation lines</label>
                <label class="toggle"><input type="checkbox" data-ref="toggle-enlarged" /> Enlarged marker <span class="badge warn">not to scale</span></label>
                <label class="toggle"><input type="checkbox" data-ref="toggle-night" /> Night mode (red)</label>
              </div>
              <div class="field" style="margin-top: 10px">
                <label for="min-good">Good-viewing minimum elevation: <span data-ref="min-good-value">10°</span></label>
                <input id="min-good" type="range" min="0" max="60" step="1" value="10" data-ref="min-good" />
              </div>
              <p class="status-line">The Phase 1 visibility window (above horizon + Sun &lt; −6°) is unchanged; this threshold only highlights the easier part of the path.</p>
            </section>
          </section>
          <div data-ref="event-guide"></div>
          <details class="about-panel" open>
            <summary>About, data, offline storage &amp; licences</summary>
            <div class="about-grid">
              <section>
                <h3>Build &amp; data source</h3>
                <div class="about-block" data-ref="about-build">—</div>
                <div class="bar" style="margin-top: 8px">
                  <button class="btn small" data-ref="check-updates" type="button">Check for updates</button>
                  <span class="status-line" data-ref="update-status"></span>
                </div>
              </section>
              <section>
                <h3>Prepared offline area</h3>
                <div class="about-block" data-ref="about-offline">Not prepared.</div>
                <div class="about-block" data-ref="about-storage">Storage status not checked yet.</div>
              </section>
              <section>
                <h3>Bundled building areas</h3>
                <div class="about-block" data-ref="about-areas">Checking…</div>
              </section>
            </div>
            <div class="credits" data-ref="credits"></div>
          </details>
          <div class="footer-note">
            Everything is computed from the committed JPL Horizons state vectors and astronomy-engine.
            The view is a simulation for planning, not a live feed. Offline base maps are rendered
            from cached terrain tiles; OpenStreetMap raster tiles are never bulk-downloaded.
          </div>
        </main>
        ${this.debug ? '<div class="debug-overlay" data-ref="debug-overlay"></div>' : ''}
      </div>
    `;
  }

  private metric(id: string, label: string, value: string): string {
    return `<div class="metric"><span class="label">${label}</span><span class="value" data-ref="metric-${id}">${value}</span><span class="sub" data-ref="metric-${id}-sub"></span></div>`;
  }

  private populatePresets(): void {
    const select = this.ref('preset-select') as HTMLSelectElement;
    const options = [
      ['', 'Custom / browser location'],
      ...Object.entries({
        brasov: 'Brasov, Romania',
        'cape-town': 'Cape Town, South Africa',
        tenerife: 'Teide Observatory, Tenerife',
        longyearbyen: 'Longyearbyen, Svalbard',
      }),
    ];
    select.innerHTML = options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('');
  }

  private bind(): void {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (!target) return;
      if (target.dataset.jump) this.app.jumpTo(target.dataset.jump as never);
      if (
        target.dataset.view === 'sky' ||
        target.dataset.view === 'space' ||
        target.dataset.view === 'local' ||
        target.dataset.view === 'ar'
      ) {
        this.app.setViewMode(target.dataset.view);
      }
      if (target.dataset.camera) {
        this.spaceView.setCameraPreset(target.dataset.camera as never);
      }
      if (target === this.ref('space-reset')) {
        this.spaceView.setCameraPreset('flyby');
      }
      if (target === this.ref('offline-chip')) {
        this.app.setViewMode('local');
        window.setTimeout(() => {
          this.ref('terrain-host')
            .querySelector<HTMLElement>('[data-ref="offline-card"]')
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }, 150);
      }
    });

    const tablist = this.root.querySelector<HTMLElement>('[role="tablist"]');
    tablist?.addEventListener('keydown', (event) => {
      const tabs = [
        ...this.root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ];
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });

    const skyCanvas = this.ref('sky-canvas') as HTMLCanvasElement;
    skyCanvas.addEventListener('keydown', (event) => {
      const step = 24;
      if (event.key === 'ArrowLeft') this.skyView.panByPixels(step, 0);
      else if (event.key === 'ArrowRight') this.skyView.panByPixels(-step, 0);
      else if (event.key === 'ArrowUp') this.skyView.panByPixels(0, step);
      else if (event.key === 'ArrowDown') this.skyView.panByPixels(0, -step);
      else if (event.key === '+' || event.key === '=') this.skyView.zoomBy(1.2);
      else if (event.key === '-' || event.key === '_') this.skyView.zoomBy(1 / 1.2);
      else if (event.key === '0' || event.key === 'Home') this.skyView.resetView();
      else return;
      event.preventDefault();
    });

    this.ref('play-button').addEventListener('click', () => {
      const state = this.app.getState();
      this.app.setPlaying(!state.playing);
    });
    this.ref('night-button').addEventListener('click', () => {
      const state = this.app.getState();
      this.app.setToggle('nightMode', !state.toggles.nightMode);
    });
    this.ref('toggle-night').addEventListener('change', (event) => {
      this.app.setToggle('nightMode', (event.target as HTMLInputElement).checked);
    });
    this.ref('toggle-refraction').addEventListener('change', (event) => {
      this.app.setToggle('refraction', (event.target as HTMLInputElement).checked);
    });
    this.ref('toggle-constellations').addEventListener('change', (event) => {
      this.app.setToggle('constellations', (event.target as HTMLInputElement).checked);
    });
    this.ref('toggle-enlarged').addEventListener('change', (event) => {
      this.app.setToggle('enlargedMarker', (event.target as HTMLInputElement).checked);
    });
    this.ref('speed-select').addEventListener('change', (event) => {
      this.app.setSpeed(Number((event.target as HTMLSelectElement).value));
    });
    this.ref('scrub').addEventListener('input', (event) => {
      const state = this.app.getState();
      if (state.dataWindowStartMs === null || state.dataWindowEndMs === null) return;
      const fraction = Number((event.target as HTMLInputElement).value) / 10000;
      this.app.setUtc(
        state.dataWindowStartMs +
          fraction * (state.dataWindowEndMs - state.dataWindowStartMs),
      );
    });
    this.ref('preset-select').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value) this.app.setPreset(value);
    });
    this.ref('apply-observer').addEventListener('click', () => this.applyManual());
    this.ref('use-location').addEventListener('click', () => {
      this.app.useBrowserLocation();
    });
    this.ref('min-good').addEventListener('input', (event) => {
      this.app.setMinGoodElevation(Number((event.target as HTMLInputElement).value));
    });
  }

  private applyManual(): void {
    const latRaw = (this.ref('lat') as HTMLInputElement).value.trim();
    const lonRaw = (this.ref('lon') as HTMLInputElement).value.trim();
    if (latRaw === '' || lonRaw === '') {
      this.setError('Enter both latitude and longitude, or choose a preset.');
      return;
    }
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    const elevRaw = (this.ref('elev') as HTMLInputElement).value.trim();
    const eye = Number((this.ref('eye') as HTMLInputElement).value);
    const error = this.app.setManualObserver({
      latitudeDeg: lat,
      longitudeDeg: lon,
      groundElevationM: elevRaw === '' ? null : Number(elevRaw),
      eyeHeightM: Number.isFinite(eye) ? eye : 1.7,
    });
    this.setError(error);
  }

  private setError(message: string | null): void {
    const node = this.ref('error-line');
    node.textContent = message ?? '';
    node.classList.toggle('hidden', !message);
  }

  onState(state: UiState): void {
    document.body.classList.toggle('night', state.toggles.nightMode);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = state.toggles.nightMode ? '#000000' : '#070b14';
    if (state.utcMs !== null) {
      this.ref('utc-clock').textContent = formatUtc(state.utcMs);
      const local = formatLocal(state.utcMs, state.timeZone);
      this.ref('local-clock').textContent = `${local.label} ${local.zone} (${state.timeZone})`;
    }
    this.ref('play-button').textContent = state.playing ? '⏸ Pause' : '▶ Play';
    const speed = this.ref('speed-select') as HTMLSelectElement;
    if (Number(speed.value) !== state.speed) speed.value = String(state.speed);
    const scrub = this.ref('scrub') as HTMLInputElement;
    if (
      state.utcMs !== null &&
      state.dataWindowStartMs !== null &&
      state.dataWindowEndMs !== null
    ) {
      const fraction =
        (state.utcMs - state.dataWindowStartMs) /
        (state.dataWindowEndMs - state.dataWindowStartMs);
      scrub.value = String(Math.round(Math.max(0, Math.min(1, fraction)) * 10000));
      this.ref('window-start').textContent = formatUtc(state.dataWindowStartMs).slice(5, 16);
      this.ref('window-end').textContent = formatUtc(state.dataWindowEndMs).slice(5, 16);
      this.ref('window-chip').textContent = `${formatUtc(state.dataWindowStartMs).slice(0, 16)} → ${formatUtc(state.dataWindowEndMs).slice(0, 16)} UTC`;
    }
    this.ref('night-button').textContent = state.toggles.nightMode
      ? 'Night mode: on'
      : 'Night mode: off';
    this.ref('night-button').setAttribute('aria-pressed', String(state.toggles.nightMode));
    (this.ref('toggle-night') as HTMLInputElement).checked = state.toggles.nightMode;
    (this.ref('toggle-refraction') as HTMLInputElement).checked = state.toggles.refraction;
    (this.ref('toggle-constellations') as HTMLInputElement).checked = state.toggles.constellations;
    (this.ref('toggle-enlarged') as HTMLInputElement).checked = state.toggles.enlargedMarker;
    this.ref('min-good-value').textContent = `${state.minGoodElevationDeg}°`;
    (this.ref('min-good') as HTMLInputElement).value = String(state.minGoodElevationDeg);
    this.ref('location-chip').textContent = state.observer
      ? `${state.observer.latitudeDeg.toFixed(2)}°, ${state.observer.longitudeDeg.toFixed(2)}°`
      : 'Location';
    this.ref('location-chip').title = state.locationStatus;
    this.ref('location-status').textContent = state.locationStatus;
    if (state.observer) {
      const observerKey = [
        state.observer.latitudeDeg,
        state.observer.longitudeDeg,
        state.observer.groundElevationM,
        state.observer.eyeHeightM,
      ].join('|');
      if (observerKey !== this.lastObserverKey) {
        this.lastObserverKey = observerKey;
        const active = document.activeElement;
        const setIfIdle = (id: string, value: string) => {
          const input = this.ref(id) as HTMLInputElement;
          if (active !== input) input.value = value;
        };
        setIfIdle('lat', state.observer.latitudeDeg.toFixed(5));
        setIfIdle('lon', state.observer.longitudeDeg.toFixed(5));
        setIfIdle(
          'elev',
          state.observer.groundElevationM === null
            ? ''
            : String(state.observer.groundElevationM),
        );
        setIfIdle('eye', state.observer.eyeHeightM.toFixed(1));
      }
    }
    if (state.observer) {
      const preset = this.presetIdFor(state.observer);
      (this.ref('preset-select') as HTMLSelectElement).value = preset;
    }
    for (const view of ['sky', 'space', 'local', 'ar'] as const) {
      const active = state.viewMode === view;
      const tab = this.root.querySelector<HTMLElement>(`[data-view="${view}"]`);
      tab?.setAttribute('aria-selected', String(active));
      tab?.setAttribute('aria-pressed', String(active));
      if (tab) tab.tabIndex = active ? 0 : -1;
    }
    this.ref('sky-panel').classList.toggle('hidden', state.viewMode !== 'sky');
    this.ref('space-panel').classList.toggle('hidden', state.viewMode !== 'space');
    this.ref('local-panel').classList.toggle('hidden', state.viewMode !== 'local');
    this.ref('ar-panel').classList.toggle('hidden', state.viewMode !== 'ar');
    if (state.viewMode === 'local') {
      void this.ensureTerrain(state);
      this.terrain?.update(state);
      // Leaflet needs a nudge after the panel returns from display:none.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    if (state.viewMode === 'ar') {
      void this.ensureAr(state);
    } else if (this.ar) {
      this.ar.unmount();
      this.ar = null;
    }
    this.setError(state.error);
    const aux = this.ref('aux-status');
    aux.textContent = state.auxStatus ?? '';
    aux.classList.toggle('hidden', !state.auxStatus);
    const debugOverlay = this.refs['debug-overlay'];
    if (debugOverlay) {
      debugOverlay.classList.toggle('hidden', state.viewMode !== 'sky');
    }
    if (this.app.getSession() && this.app.getSession() !== this.lastSession) {
      this.lastSession = this.app.getSession();
      const session = this.lastSession!;
      this.plot.setData(session.plotSamples, session.windowStartMs, session.windowEndMs);
      this.lastPlotKey = '';
    }
    this.updateJumpDisabled(state);
    this.renderOffline(state);
    this.eventGuide.update(state);
    this.renderAbout(state);
  }

  private renderOffline(state: UiState): void {
    const chip = this.ref('offline-chip');
    const line = this.ref('offline-line');
    if (state.offline.active) {
      chip.textContent = state.offline.mismatch
        ? 'Offline: area not prepared'
        : 'Offline: ready';
      chip.classList.toggle('warn', state.offline.mismatch);
      chip.classList.toggle('good', !state.offline.mismatch);
      line.textContent = state.offline.message ?? 'Offline mode.';
      line.classList.remove('hidden');
      line.classList.toggle('warn', state.offline.mismatch);
      line.classList.toggle('good', !state.offline.mismatch);
    } else {
      chip.textContent = state.offline.preparedAt
        ? 'Offline: prepared'
        : 'Offline: not prepared';
      chip.classList.toggle('good', state.offline.preparedAt !== null);
      chip.classList.toggle('warn', state.offline.preparedAt === null);
      line.textContent = '';
      line.classList.add('hidden');
    }
  }

  private presetIdFor(observer: {
    latitudeDeg: number;
    longitudeDeg: number;
    groundElevationM: number | null;
  }): string {
    if (Math.abs(observer.latitudeDeg - 45.6427) < 1e-4 && Math.abs(observer.longitudeDeg - 25.5887) < 1e-4) return 'brasov';
    if (Math.abs(observer.latitudeDeg + 33.9249) < 1e-4 && Math.abs(observer.longitudeDeg - 18.4241) < 1e-4) return 'cape-town';
    if (Math.abs(observer.latitudeDeg - 28.3006) < 1e-4 && Math.abs(observer.longitudeDeg + 16.5106) < 1e-4) return 'tenerife';
    if (Math.abs(observer.latitudeDeg - 78.2232) < 1e-4 && Math.abs(observer.longitudeDeg - 15.6469) < 1e-4) return 'longyearbyen';
    return '';
  }

  private updateJumpDisabled(state: UiState): void {
    const session = this.app.getSession();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-jump]')) {
      const target = button.dataset.jump as never;
      button.disabled = !session || session.jumpTarget(target) === null;
    }
    if (state.utcMs === null) {
      (this.ref('play-button') as HTMLButtonElement).disabled = true;
    } else {
      (this.ref('play-button') as HTMLButtonElement).disabled = false;
    }
  }

  private async ensureTerrain(state: UiState): Promise<void> {
    if (this.terrain) {
      this.terrain.update(state);
      return;
    }
    if (this.terrainLoading) return;
    this.terrainLoading = true;
    try {
      const module = await import('../terrain');
      if (this.app.getState().viewMode !== 'local') return;
      const workstream = module.createTerrainWorkstream(this.ref('terrain-host'), {
        getState: () => this.app.getState(),
        subscribe: (listener) => this.app.onState(listener),
        getSession: () => this.app.getSession(),
        getEphemeris: () => this.app.getEphemeris(),
        getCatalogue: () => this.app.getCatalogue(),
        getOfflineSnapshot: () => this.app.getOfflineSnapshot(),
        setOfflineSnapshot: (snapshot) => this.app.setOfflineSnapshot(snapshot),
        setObserver: (lat, lon, groundElevationM) => {
          const error = this.app.setObserverFromExternal(lat, lon, groundElevationM);
          if (error) this.app.setStatus(error);
        },
        setGroundElevationM: (m) => this.app.setGroundElevationM(m),
        setTimeUtcMs: (ms) => this.app.setUtc(ms),
        setStatus: (message) => this.app.setStatus(message),
        setEyeHeightM: (m) => this.app.setEyeHeightM(m),
      });
      workstream.mount();
      workstream.update(this.app.getState());
      this.terrain = workstream;
    } catch (error) {
      this.app.setStatus(`Terrain failed to load: ${String(error)}`);
    } finally {
      this.terrainLoading = false;
    }
  }

  private async ensureAr(state: UiState): Promise<void> {
    if (this.ar) {
      this.ar.update(state);
      return;
    }
    if (this.arLoading) return;
    this.arLoading = true;
    try {
      const module = await import('../ar');
      if (this.app.getState().viewMode !== 'ar') return;
      const workstream = module.createArWorkstream(this.ref('ar-host'), {
        getState: () => this.app.getState(),
        subscribe: (listener) => this.app.onState(listener),
        getSession: () => this.app.getSession(),
        getEphemeris: () => this.app.getEphemeris(),
        getCatalogue: () => this.app.getCatalogue(),
        setTimeUtcMs: (ms) => this.app.setUtc(ms),
        setPlaying: (playing) => this.app.setPlaying(playing),
        setStatus: (message) => this.app.setStatus(message),
      });
      workstream.mount();
      workstream.update(this.app.getState());
      this.ar = workstream;
    } catch (error) {
      this.app.setStatus(`AR failed to load: ${String(error)}`);
    } finally {
      this.arLoading = false;
    }
  }

  renderViews(state: UiState, sky: SkyPosition, bodies: BodyPosition[]): void {
    const session = this.app.getSession();
    if (!session || state.utcMs === null) return;
    if (state.viewMode === 'sky') {
      this.skyView.render({
        state,
        session,
        sky,
        bodies,
        catalogue: this.catalogue,
      });
    } else if (state.viewMode === 'space') {
      this.spaceView.setInput(state, session, sky);
    }
  }

  updateFrame(state: UiState, sky: SkyPosition, bodies: BodyPosition[]): void {
    if (state.utcMs === null) return;
    const moon = bodies.find((b) => b.body === 'Moon');
    const moonSep = moon
      ? separationDeg(sky.azimuthDeg, sky.elevationDeg, moon.azimuthDeg, moon.elevationDeg)
      : null;
    const inWindow =
      this.app.getSession()?.isInVisibilityWindow(jdTdbFromDate(new Date(state.utcMs ?? 0))) ?? false;
    const above = sky.elevationDeg > 0;
    this.ref('metric-az').textContent = fmtDeg(sky.azimuthDeg, 3);
    this.ref('metric-el').textContent = fmtDeg(sky.elevationDeg, 3);
    this.ref('metric-el-sub').textContent = state.toggles.refraction ? 'refracted' : 'airless';
    this.ref('metric-range').textContent = fmtKm(sky.rangeKm);
    this.ref('metric-range-sub').textContent = `${(sky.rangeKm / 384_400).toFixed(3)} lunar distances`;
    this.ref('metric-rate').textContent = `${sky.angularRateDegPerMin.toFixed(3)}°/min`;
    this.ref('metric-mag').textContent = `${sky.magnitude.toFixed(2)} (est.)`;
    this.ref('metric-size').textContent = `${sky.angularDiameterArcsec.toFixed(3)}″`;
    this.ref('metric-size-sub').textContent = 'true angular size';
    this.ref('metric-moon').textContent = moonSep === null ? '—' : fmtDeg(moonSep, 2);
    this.ref('metric-view').textContent = !above
      ? 'Below horizon'
      : inWindow
        ? 'In visibility window'
        : 'Above horizon, not dark';
    this.ref('metric-view-sub').textContent = inWindow
      ? 'Phase 1 (Sun < −6°)'
      : 'Sun criterion not met';
    this.ref('sky-refraction-badge').textContent = state.toggles.refraction
      ? 'refracted (display)'
      : 'airless';
    this.ref('sky-visibility-badge').textContent = !above
      ? 'below horizon'
      : inWindow
        ? 'visible · Sun < −6°'
        : 'above horizon · not dark';
    this.ref('sky-visibility-badge').className = `badge ${
      above && inWindow ? 'good' : above ? 'warn' : ''
    }`;
    this.ref('readout-note').textContent = `${
      state.toggles.refraction ? 'Refracted azimuth/elevation' : 'Airless azimuth/elevation'
    } · range/rate/size are geometric · magnitude is an H-G estimate · marker glow encodes magnitude, not the 1.7″ physical disc.`;
    const session = this.app.getSession();
    if (session) {
      const stripKey = `${Math.floor(state.utcMs / 60_000)}|${state.toggles.refraction}|${state.timeZone}`;
      if (stripKey !== this.lastStripKey) {
        this.lastStripKey = stripKey;
        const trail = session.trail(state.utcMs, 3, state.toggles.refraction);
        const ticks = trail.filter(
          (s) =>
            s.elevationDeg >= 0 && new Date(s.utcMs).getUTCMinutes() % 5 === 0,
        );
        this.lastStripHtml = ticks.length
          ? `<strong>5-min trail ticks (local, thinned on dome):</strong> ${ticks
              .map((s) => localHhMm(s.utcMs, state.timeZone))
              .join(' · ')}`
          : '5-min trail ticks: none above the horizon in this ±3 h window.';
      }
      this.ref('trail-strip').innerHTML = this.lastStripHtml;
    }
    this.updateSizePanel(sky, state);
    this.updateDebug(sky, state);
  }

  updatePlot(state: UiState): void {
    if (state.utcMs === null) return;
    const key = `${state.toggles.nightMode}|${state.minGoodElevationDeg}|${Math.round(state.utcMs / 120000)}`;
    if (key === this.lastPlotKey) return;
    this.lastPlotKey = key;
    this.plot.render(state, state.utcMs);
  }

  private updateSizePanel(sky: SkyPosition, state: UiState): void {
    const key = `${Math.round(sky.rangeKm / 100)}|${sky.angularDiameterArcsec.toFixed(2)}`;
    if (key === this.lastSizeKey) return;
    this.lastSizeKey = key;
    const rows = comparisonAtDistance(sky.rangeKm);
    const apophis = rows.find((r) => r.id === 'apophis')!;
    const maxArc = Math.max(...rows.map((r) => r.angularArcsec));
    const html = `
      <div class="bar bar-between" style="margin-bottom: 6px">
        <span class="badge good">Apophis ${apophis.angularArcsec.toFixed(3)}″</span>
        <span class="chip">at ${fmtKm(sky.rangeKm)}</span>
      </div>
      <table class="size-table">
        <thead><tr><th>Object</th><th class="num">Angular</th><th class="num">vs Apophis</th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const width = Math.max(0.5, Math.min(100, (r.angularArcsec / maxArc) * 100));
              return `<tr title="${esc(r.source)}">
                <td>${esc(r.name)}<div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(2)}%"></div></div></td>
                <td class="num">${fmtArcsec(r.angularArcsec)}</td>
                <td class="num">${r.relativeToApophis >= 1000 ? `${Math.round(r.relativeToApophis).toLocaleString('en-US')}×` : `${r.relativeToApophis.toFixed(2)}×`}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <p class="size-note">Every angular figure is calculated as 2·atan(radius/distance) at the current Apophis range. The Moon is shown as if it were at that distance, not its real 384,400 km. Apophis’ real size is ${apophis.angularArcsec.toFixed(3)}″; the true-scale marker is a point, and the dashed marker is labelled “not to scale”.</p>
    `;
    this.ref('size-panel').innerHTML = html;
  }

  private updateDebug(sky: SkyPosition, state: UiState): void {
    if (!this.debug) return;
    const d: SkyDebugSnapshot = this.skyView.getDebugSnapshot();
    const local = state.utcMs === null ? '—' : formatLocal(state.utcMs, state.timeZone);
    const lines = [
      `<strong>?debug=1</strong>`,
      `UTC          ${state.utcMs === null ? '—' : new Date(state.utcMs).toISOString()}`,
      `LOCAL        ${local === '—' ? '—' : `${local.label} ${local.zone}`}`,
      `AZ / EL      ${sky.azimuthDeg.toFixed(6)}° / ${sky.elevationDeg.toFixed(6)}° (${state.toggles.refraction ? 'refracted' : 'airless'})`,
      `RANGE        ${sky.rangeKm.toFixed(3)} km`,
      `MAG          ${sky.magnitude.toFixed(6)} (estimate)`,
      `ANG SIZE     ${sky.angularDiameterArcsec.toFixed(6)}″`,
      `RATE         ${sky.angularRateDegPerMin.toFixed(6)}°/min`,
      `MARKER px    ${d.markerX === null || d.markerY === null ? 'hidden' : `${d.markerX.toFixed(2)}, ${d.markerY.toFixed(2)}`}`,
      `CANVAS       ${d.canvasWidth.toFixed(0)}×${d.canvasHeight.toFixed(0)} CSS px, horizon ${d.horizonRadiusPx.toFixed(2)} px`,
      `PROJECTION   center ${d.centerAzDeg.toFixed(3)}° / ${d.centerElDeg.toFixed(3)}°, zoom ${d.zoom.toFixed(3)}, FOV≈${d.fovDeg.toFixed(1)}°`,
      `TRAIL        ${d.trailTicks} ticks, ${d.trailLabels} labels, ${d.starCount} stars`,
      `TICK TIMES   ${d.trailLabelTimesUtc.slice(0, 3).join(', ')}${d.trailLabelTimesUtc.length > 3 ? ` … ${d.trailLabelTimesUtc.at(-1)}` : ''}`,
      `VIEWPORT     ${window.innerWidth}×${window.innerHeight}`,
    ];
    const overlay = this.refs['debug-overlay'];
    if (overlay) {
      overlay.innerHTML = lines.join('\n');
      overlay.dataset.markerX = d.markerX === null ? '' : String(d.markerX);
      overlay.dataset.markerY = d.markerY === null ? '' : String(d.markerY);
      overlay.dataset.trailLabelTimes = d.trailLabelTimesUtc.join(',');
      overlay.dataset.utc = state.utcMs === null ? '' : new Date(state.utcMs).toISOString();
      overlay.dataset.az = String(sky.azimuthDeg);
      overlay.dataset.el = String(sky.elevationDeg);
      overlay.dataset.centerAz = String(d.centerAzDeg);
      overlay.dataset.centerEl = String(d.centerElDeg);
      overlay.dataset.zoom = String(d.zoom);
      overlay.dataset.horizon = String(d.horizonRadiusPx);
      overlay.dataset.canvasW = String(d.canvasWidth);
      overlay.dataset.canvasH = String(d.canvasHeight);
    }
  }

  private renderAbout(state?: UiState): void {
    const source = this.app.getEphemerisSource();
    const snapshot = this.app.getOfflineSnapshot();
    this.offlineSnapshot = snapshot;
    const key = [
      source?.activeSource,
      source?.solution,
      source?.retrievedAt,
      snapshot?.preparedAt,
      state?.offline.active,
      state?.timeZone,
      state?.formatLocale,
    ].join('|');
    if (key === this.lastAboutKey) return;
    this.lastAboutKey = key;

    const sourceInfo: EphemerisSourceInfo | null = source;
    const buildDate = typeof __BUILD_TIME__ === 'string'
      ? formatPreparedDate(Date.parse(__BUILD_TIME__), state?.timeZone)
      : 'development';
    this.ref('about-build').innerHTML = `
      <p><strong>App</strong> v${esc(__APP_VERSION__)} · built ${esc(buildDate)}</p>
      <p><strong>Ephemeris</strong> ${esc(sourceInfo?.provider ?? '—')} · solution <strong>${esc(
        sourceInfo?.solution ?? '—',
      )}</strong> · retrieved <strong>${esc(sourceInfo?.retrievedAt ?? '—')}</strong></p>
      <p><strong>This session is using</strong> ${esc(
        sourceInfo?.activeSource === 'prepared'
          ? 'the prepared offline snapshot'
          : 'the built-in data file',
      )}.${sourceInfo?.queryUrl ? ` <a href="${esc(sourceInfo.queryUrl)}">Exact Horizons query</a>.` : ''}</p>
      <p><strong>Stars</strong> HYG Database v4.4 (CC BY-SA 4.0) · WMM2025 (NOAA/NCEI + BGS) · astronomy-engine (MIT).</p>
    `;

    if (!snapshot) {
      this.ref('about-offline').innerHTML =
        '<p>No offline area is prepared. Open <strong>Local 3D</strong> and press <strong>Prepare for offline</strong>.</p>';
    } else {
      const b = snapshot.buildings;
      this.ref('about-offline').innerHTML = `
        <p><strong>Prepared</strong> ${esc(
          formatPreparedDate(snapshot.preparedAt, state?.timeZone),
        )} · ${esc(formatBytes(snapshot.totalBytes))}</p>
        <p><strong>Area</strong> ${esc(snapshot.area.label)} · search radius ${Math.round(
          snapshot.area.searchRadiusM,
        ).toLocaleString('ro-RO')} m · buildings within ${Math.round(
          snapshot.area.buildingRadiusM,
        ).toLocaleString('ro-RO')} m</p>
        <p><strong>Ephemeris</strong> solution ${esc(
          snapshot.ephemeris.solution,
        )} · retrieved ${esc(snapshot.ephemeris.retrievedAt)} · ${esc(
          formatBytes(snapshot.ephemeris.bytes),
        )}</p>
        <p><strong>Stars</strong> ${snapshot.stars ? `${esc(snapshot.stars.source)} · ${esc(formatBytes(snapshot.stars.bytes))}` : 'not stored'}</p>
        <p><strong>Terrain</strong> ${snapshot.terrain.tileCount} DEM tiles (z${snapshot.area.terrainZoom}) · ${esc(
          formatBytes(snapshot.terrain.bytes),
        )} · ${esc(snapshot.terrain.attribution)}</p>
        <p><strong>Buildings</strong> ${b ? `${b.count} OSM ways · ${b.defaultHeightCount} default height · ${esc(
          formatBytes(b.bytes),
        )} · ${esc(b.source)}${b.sourceLabel ? ` (${esc(b.sourceLabel)})` : ''} · retrieved ${esc(b.retrievedAt)}` : 'not stored (best-spot scores marked incomplete)'}</p>
        <p><strong>Base map</strong> ${esc(snapshot.baseMap.note)}</p>
        ${snapshot.warnings.length ? `<p class="status-line warn">${snapshot.warnings.map(esc).join('<br />')}</p>` : ''}
        <p><strong>Data source</strong> ${esc(snapshot.ephemeris.provider)} · solution ${esc(
          snapshot.ephemeris.solution,
        )}.</p>
      `;
    }

    void storageInfo().then((info) => {
      if (!info.supported) {
        this.aboutStorageText =
          'Storage API is unavailable in this browser; offline data cannot be inspected.';
      } else {
        const parts = [
          info.persisted ? 'persistent storage granted' : 'best-effort storage (may be evicted)',
          info.usageBytes !== null ? `used ${formatBytes(info.usageBytes)}` : 'usage unknown',
          info.quotaBytes !== null ? `quota ${formatBytes(info.quotaBytes)}` : 'quota unknown',
        ];
        this.aboutStorageText = `${parts.join(' · ')}. On iOS, Add to Home Screen and open the app at least once a week to avoid the 7-day eviction rule.`;
      }
      this.ref('about-storage').textContent = this.aboutStorageText;
    });
    this.ref('about-storage').textContent = this.aboutStorageText;

    void this.loadBundledAreasForAbout();
  }

  private async loadBundledAreasForAbout(): Promise<void> {
    const node = this.ref('about-areas');
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}data/areas/index.json`,
        { cache: 'no-cache' },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = (await response.json()) as {
        areas?: Array<{
          name?: string;
          latitudeDeg?: number;
          longitudeDeg?: number;
          radiusM?: number;
          retrievedAt?: string;
          source?: string;
          buildingCount?: number;
        }>;
      };
      const areas = Array.isArray(manifest.areas) ? manifest.areas : [];
      if (areas.length === 0) {
        node.innerHTML =
          '<p>No bundled building areas. Use <code>npm run fetch:buildings</code> at build time, or import a GeoJSON/Overpass file in Local 3D.</p>';
        return;
      }
      node.innerHTML = `<ul class="about-list">${areas
        .map(
          (area) =>
            `<li><strong>${esc(area.name ?? 'Area')}</strong> · ${Number(
              area.latitudeDeg ?? 0,
            ).toFixed(4)}°, ${Number(area.longitudeDeg ?? 0).toFixed(4)}° · r=${Math.round(
              area.radiusM ?? 0,
            )} m · ${area.buildingCount ?? '?'} buildings · retrieved ${esc(
              area.retrievedAt ?? '—',
            )}${area.source ? ` · ${esc(area.source)}` : ''}</li>`,
        )
        .join('')}</ul>`;
    } catch {
      node.innerHTML =
        '<p>No bundled building manifest is available (offline or not built). Live Overpass and manual import remain available.</p>';
    }
  }

  private renderCredits(): void {
    const catalogue = this.app.getCatalogue();
    const starCredit = catalogue
      ? `<br /><strong>Stars:</strong> ${esc(catalogue.metadata.source)} · ${esc(catalogue.metadata.license)} · ${esc(catalogue.metadata.attribution)}`
      : '<br /><strong>Stars:</strong> catalogue unavailable; sky still works without it.';
    const constellationCredit = catalogue?.metadata.constellationSource
      ? `<br /><strong>Constellation lines:</strong> ${esc(catalogue.metadata.constellationSource)} · ${esc(catalogue.metadata.constellationLicense ?? 'see source')}`
      : '';
    this.ref('credits').innerHTML = `
      <strong>Ephemeris:</strong> NASA/JPL Horizons, solution JPL#220, retrieved 2026-11-19. H=19.09, G=0.24, radius 0.170 km.
      <br /><strong>Astronomy engine:</strong> astronomy-engine (MIT) for Sun/Moon/planets, sidereal time and precession/nutation.
      ${starCredit}${constellationCredit}
      <br /><strong>Star data licence:</strong> HYG Database v4.4, David Nash / Astronomy Nexus, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; the derived <code>stars.json</code> remains CC BY-SA 4.0. HYG is partly Hipparcos-derived; ESA’s Hipparcos data is CC BY-NC 3.0 IGO — review before any commercial use.
      <br /><strong>Line data licence:</strong> Marc van der Sluys, ConstellationLines v1.4, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · <a href="https://doi.org/10.5281/zenodo.23210182">DOI 10.5281/zenodo.23210182</a>.
      <br /><strong>Full notices:</strong> <a href="./data/README.md">star catalogue</a>, <a href="./data/TERRAIN.md">terrain/buildings</a> and THIRD_PARTY_NOTICES.md.
      <br /><strong>AR compass:</strong> WMM2025 from NOAA/NCEI and BGS, via geomagnetism (Apache-2.0). Extrapolated/unsupported dates are labelled in AR.
      <br /><strong>Terrain:</strong> Terrain Tiles by Mapzen / AWS Open Data (includes Copernicus EU-DEM, USGS 3DEP/SRTM/GMTED2010, NOAA ETOPO1 and other national sources; see <a href="./data/TERRAIN.md">terrain attribution</a>).
      <br /><strong>Buildings &amp; map:</strong> © OpenStreetMap contributors, ODbL; Overpass API; Leaflet (BSD-2-Clause). Light pollution, weather and trees are not modelled.
      <br /><strong>Size figures:</strong> Moon 3,474.8 km (NASA Moon Fact Sheet); ISS 109 m array span (NASA); football pitch 105 m (FIFA/IFAB); Eiffel Tower 330 m (official Eiffel Tower figures); Apophis 340 m (Horizons 2 × 0.170 km).
      <br /><strong>Accuracy:</strong> Phase 1 topocentric az/el max error 0.050 arcmin (3.01″) against Horizons; see PHASE1-VALIDATION.md. This view is a planning simulation, not a live feed.
      <br /><strong>Refraction:</strong> Bennett display-only correction; the validation path is airless.
    `;
  }
}
