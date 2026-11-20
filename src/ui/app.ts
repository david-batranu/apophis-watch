import { jdTdbFromDate } from '../core/time';
import { t } from '../i18n';
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
  { kind: 'topocentricCa', label: t('jump.topocentricCa') },
  { kind: 'geocentricCa', label: t('jump.geocentricCa') },
  { kind: 'rise', label: t('jump.rise') },
  { kind: 'set', label: t('jump.set') },
  { kind: 'maxElevation', label: t('jump.maxElevation') },
  { kind: 'visibilityStart', label: t('jump.visibilityStart') },
  { kind: 'visibilityEnd', label: t('jump.visibilityEnd') },
];

const SPEEDS = [1, 5, 10, 30, 60, 300, 600];

const SIZE_OBJECT_LABELS = {
  moon: 'shell.sizeObjectMoon',
  apophis: 'shell.sizeObjectApophis',
  eiffel: 'shell.sizeObjectEiffel',
  football: 'shell.sizeObjectFootball',
  iss: 'shell.sizeObjectIss',
} as const;

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
  private aboutStorageText = t('shell.storageNotChecked');
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
          t('shell.pwaUpdateReady'),
        );
      },
      onOfflineReady: () => {
        this.showPwaBanner(
          'offline',
          t('shell.pwaOfflineReady'),
        );
      },
      onError: (error) => {
        this.setError(
          t('shell.pwaServiceWorkerError', { error: String(error) }),
        );
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
      status.textContent = t('shell.pwaChecking');
      void this.pwa?.check().then(() => {
        window.setTimeout(() => {
          status.textContent = this.pwa?.hasWaitingUpdate()
            ? t('shell.pwaNewBuildReady')
            : t('shell.pwaNoUpdate');
        }, 1_500);
      });
    });
  }

  private showPwaBanner(kind: 'update' | 'offline', text: string): void {
    this.pwaBannerKind = kind;
    this.ref('pwa-banner-text').textContent = text;
    this.ref('pwa-primary').textContent =
      kind === 'update' ? t('shell.pwaReload') : t('shell.pwaGotIt');
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
        <a class="skip-link" href="#main-content">${t('shell.skipToContent')}</a>
        <header class="topbar">
          <div class="brand">${t('shell.brandName')} <span>${t('shell.brandSubtitle')}</span></div>
          <div class="top-actions">
            <span class="chip" data-ref="location-chip">${t('shell.locationFallback')}</span>
            <button class="chip chip-button" data-ref="offline-chip" type="button" aria-label="${t('shell.offlineChipAria')}">${t('shell.offlineChecking')}</button>
            <button class="btn" data-ref="night-button" type="button" aria-pressed="false">${t('shell.nightModeButton')}</button>
          </div>
        </header>
        <div class="app-banner hidden" data-ref="pwa-banner" role="status" aria-live="polite">
          <span data-ref="pwa-banner-text"></span>
          <span class="app-banner-actions">
            <button class="btn small primary" data-ref="pwa-primary" type="button">${t('shell.pwaReload')}</button>
            <button class="btn small ghost" data-ref="pwa-dismiss" type="button">${t('shell.pwaLater')}</button>
          </span>
        </div>
        <main class="main" id="main-content" tabindex="-1">
          <div class="bar bar-between">
            <div class="tabs" role="tablist" aria-label="${t('shell.tabsAria')}">
              <button class="tab" id="tab-sky" role="tab" aria-controls="panel-sky" aria-selected="true" tabindex="0" data-view="sky" type="button">${t('shell.tabSky')}</button>
              <button class="tab" id="tab-space" role="tab" aria-controls="panel-space" aria-selected="false" tabindex="-1" data-view="space" type="button">${t('shell.tabSpace')}</button>
              <button class="tab" id="tab-local" role="tab" aria-controls="panel-local" aria-selected="false" tabindex="-1" data-view="local" type="button">${t('shell.tabLocal')}</button>
              <button class="tab" id="tab-ar" role="tab" aria-controls="panel-ar" aria-selected="false" tabindex="-1" data-view="ar" type="button">${t('shell.tabAr')}</button>
            </div>
            <div class="chip" data-ref="window-chip">${t('shell.dataWindowPlaceholder')}</div>
          </div>
          <div class="status-line error hidden" data-ref="error-line" role="alert"></div>
          <div class="status-line hidden" data-ref="aux-status" role="status" aria-live="polite"></div>
          <div class="status-line offline-line hidden" data-ref="offline-line" role="status"></div>
          <section class="grid-main">
            <div class="stage-card">
              <div class="sky-stage" id="panel-sky" role="tabpanel" aria-labelledby="tab-sky" data-ref="sky-panel" aria-label="${t('shell.skyAria')}">
                <canvas class="sky-canvas" data-ref="sky-canvas" tabindex="0" aria-label="${t('shell.skyCanvasAria')}"></canvas>
                <div class="stage-topline">
                  <span class="badge" data-ref="sky-refraction-badge">${t('shell.badgeRefracted')}</span>
                  <span class="badge" data-ref="sky-visibility-badge">—</span>
                </div>
                <div class="stage-hint">${t('shell.skyHint')}</div>
              </div>
              <div class="space-stage hidden" id="panel-space" role="tabpanel" aria-labelledby="tab-space" data-ref="space-panel">
                <div class="space-host" data-ref="space-host"></div>
                <div class="space-overlay">
                  <button class="btn small" data-camera="earth" type="button">${t('shell.spaceCameraEarth')}</button>
                  <button class="btn small" data-camera="flyby" type="button">${t('shell.spaceCameraFlyby')}</button>
                  <button class="btn small" data-camera="moon" type="button">${t('shell.spaceCameraMoon')}</button>
                  <button class="btn small" data-camera="top" type="button">${t('shell.spaceCameraTop')}</button>
                  <button class="btn small" data-ref="space-reset" type="button">${t('shell.spaceResetCameras')}</button>
                </div>
                <div class="space-legend">
                  ${t('shell.spaceLegendScale')}<br />
                  ${t('shell.spaceLegendTrueScale')}
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
                <h2>${t('shell.readoutTitle')}</h2>
                <div class="readout-grid">
                  ${this.metric('az', t('shell.metricAzimuth'), '—')}
                  ${this.metric('el', t('shell.metricElevation'), '—')}
                  ${this.metric('range', t('shell.metricRange'), '—')}
                  ${this.metric('rate', t('shell.metricRate'), '—')}
                  ${this.metric('mag', t('shell.metricMagnitude'), '—')}
                  ${this.metric('size', t('shell.metricSize'), '—')}
                  ${this.metric('moon', t('shell.metricMoonSeparation'), '—')}
                  ${this.metric('view', t('shell.metricVisibility'), '—')}
                </div>
                <div class="status-line" data-ref="readout-note">—</div>
                <div class="trail-strip" data-ref="trail-strip">—</div>
              </section>
              <section class="panel">
                <h2>${t('shell.timeTitle')}</h2>
                <div class="clock-block">
                  <div class="clock-utc" data-ref="utc-clock">—</div>
                  <div class="clock-local" data-ref="local-clock">—</div>
                </div>
                <div class="time-controls" style="margin-top: 10px">
                  <div class="bar">
                    <button class="btn primary" data-ref="play-button" type="button">${t('shell.play')}</button>
                    <label class="toggle">${t('shell.speed')}
                      <select class="field" data-ref="speed-select">${speedOptions}</select>
                    </label>
                  </div>
                  <div class="scrub">
                    <span class="scrub-label" data-ref="window-start">—</span>
                    <input type="range" min="0" max="10000" step="1" value="5000" data-ref="scrub" aria-label="${t('shell.scrubAria')}" />
                    <span class="scrub-label" data-ref="window-end">—</span>
                  </div>
                  <div class="jump-grid">${jumpButtons}</div>
                </div>
              </section>
            </aside>
          </section>
          <section class="analysis-grid">
            <section class="panel">
              <h2>${t('shell.plotTitle')}</h2>
              <div class="plot-wrap" data-ref="plot-host"></div>
              <div class="status-line">${t('shell.plotCaption')}</div>
            </section>
            <section class="panel">
              <h2>${t('shell.sizeTitle')}</h2>
              <div data-ref="size-panel"></div>
            </section>
          </section>
          <section class="controls-grid">
            <section class="panel">
              <h2>${t('shell.observerTitle')}</h2>
              <div class="field">
                <label for="preset-select">${t('shell.observerPreset')}</label>
                <select id="preset-select" data-ref="preset-select">
                  <option value="">${t('shell.observerCustom')}</option>
                </select>
              </div>
              <div class="field-grid" style="margin-top: 8px">
                <div class="field"><label for="lat">${t('shell.observerLat')}</label><input id="lat" data-ref="lat" inputmode="decimal" placeholder="45.6427" /></div>
                <div class="field"><label for="lon">${t('shell.observerLon')}</label><input id="lon" data-ref="lon" inputmode="decimal" placeholder="25.5887" /></div>
                <div class="field"><label for="elev">${t('shell.observerGroundElevation')}</label><input id="elev" data-ref="elev" inputmode="decimal" placeholder="${t('shell.observerGroundPlaceholder')}" /></div>
                <div class="field"><label for="eye">${t('shell.observerEyeHeight')}</label><input id="eye" data-ref="eye" inputmode="decimal" value="1.7" /></div>
              </div>
              <div class="bar" style="margin-top: 8px">
                <button class="btn" data-ref="apply-observer" type="button">${t('shell.observerApply')}</button>
                <button class="btn ghost" data-ref="use-location" type="button">${t('shell.observerUseLocation')}</button>
              </div>
              <p class="status-line" data-ref="location-status">—</p>
              <p class="status-line">${t('shell.observerNote')}</p>
            </section>
            <section class="panel">
              <h2>${t('shell.displayTitle')}</h2>
              <div class="toggle-grid">
                <label class="toggle"><input type="checkbox" data-ref="toggle-refraction" /> ${t('shell.displayRefraction')}</label>
                <label class="toggle"><input type="checkbox" data-ref="toggle-constellations" /> ${t('shell.displayConstellations')}</label>
                <label class="toggle"><input type="checkbox" data-ref="toggle-enlarged" /> ${t('shell.displayEnlarged')} <span class="badge warn">${t('shell.displayEnlargedBadge')}</span></label>
                <label class="toggle"><input type="checkbox" data-ref="toggle-night" /> ${t('shell.displayNightMode')}</label>
              </div>
              <div class="field" style="margin-top: 10px">
                <label for="min-good">${t('shell.displayMinGoodLabel')}<span data-ref="min-good-value">10°</span></label>
                <input id="min-good" type="range" min="0" max="60" step="1" value="10" data-ref="min-good" />
              </div>
              <p class="status-line">${t('shell.displayMinGoodNote')}</p>
            </section>
          </section>
          <div data-ref="event-guide"></div>
          <details class="about-panel" open>
            <summary>${t('shell.aboutSummary')}</summary>
            <div class="about-grid">
              <section>
                <h3>${t('shell.aboutBuildTitle')}</h3>
                <div class="about-block" data-ref="about-build">—</div>
                <div class="bar" style="margin-top: 8px">
                  <button class="btn small" data-ref="check-updates" type="button">${t('shell.checkUpdates')}</button>
                  <span class="status-line" data-ref="update-status"></span>
                </div>
              </section>
              <section>
                <h3>${t('shell.aboutOfflineTitle')}</h3>
                <div class="about-block" data-ref="about-offline">${t('shell.aboutNotPrepared')}</div>
                <div class="about-block" data-ref="about-storage">${t('shell.storageNotChecked')}</div>
              </section>
              <section>
                <h3>${t('shell.aboutAreasTitle')}</h3>
                <div class="about-block" data-ref="about-areas">${t('shell.checking')}</div>
              </section>
            </div>
            <div class="credits" data-ref="credits"></div>
          </details>
          <div class="footer-note">
            ${t('shell.footerNote')}
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
      ['', t('shell.observerCustom')],
      ...Object.entries({
        brasov: t('shell.presetBrasov'),
        'cape-town': t('shell.presetCapeTown'),
        tenerife: t('shell.presetTenerife'),
        longyearbyen: t('shell.presetLongyearbyen'),
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
      this.setError(t('shell.enterCoordinates'));
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
      this.ref('local-clock').textContent = t('shell.localClock', {
        label: local.label,
        zone: local.zone,
        iana: state.timeZone,
      });
    }
    this.ref('play-button').textContent = state.playing
      ? t('shell.pause')
      : t('shell.play');
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
      this.ref('window-chip').textContent = t('shell.dataWindowValue', {
        start: formatUtc(state.dataWindowStartMs).slice(0, 16),
        end: formatUtc(state.dataWindowEndMs).slice(0, 16),
      });
    }
    this.ref('night-button').textContent = state.toggles.nightMode
      ? t('shell.nightModeOn')
      : t('shell.nightModeOff');
    this.ref('night-button').setAttribute('aria-pressed', String(state.toggles.nightMode));
    (this.ref('toggle-night') as HTMLInputElement).checked = state.toggles.nightMode;
    (this.ref('toggle-refraction') as HTMLInputElement).checked = state.toggles.refraction;
    (this.ref('toggle-constellations') as HTMLInputElement).checked = state.toggles.constellations;
    (this.ref('toggle-enlarged') as HTMLInputElement).checked = state.toggles.enlargedMarker;
    this.ref('min-good-value').textContent = `${state.minGoodElevationDeg}°`;
    (this.ref('min-good') as HTMLInputElement).value = String(state.minGoodElevationDeg);
    this.ref('location-chip').textContent = state.observer
      ? `${state.observer.latitudeDeg.toFixed(2)}°, ${state.observer.longitudeDeg.toFixed(2)}°`
      : t('shell.locationFallback');
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
        ? t('shell.offlineAreaNotPrepared')
        : t('shell.offlineReady');
      chip.classList.toggle('warn', state.offline.mismatch);
      chip.classList.toggle('good', !state.offline.mismatch);
      line.textContent = state.offline.message ?? t('shell.offlineMode');
      line.classList.remove('hidden');
      line.classList.toggle('warn', state.offline.mismatch);
      line.classList.toggle('good', !state.offline.mismatch);
    } else {
      chip.textContent = state.offline.preparedAt
        ? t('shell.offlinePrepared')
        : t('shell.offlineNotPrepared');
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
      this.app.setStatus(
        t('shell.terrainLoadFailed', { error: String(error) }),
      );
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
      this.app.setStatus(t('shell.arLoadFailed', { error: String(error) }));
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
    this.ref('metric-el-sub').textContent = state.toggles.refraction
      ? t('shell.refractionSubRefracted')
      : t('shell.refractionSubAirless');
    this.ref('metric-range').textContent = fmtKm(sky.rangeKm);
    this.ref('metric-range-sub').textContent = t('shell.rangeSub', {
      ratio: (sky.rangeKm / 384_400).toFixed(3),
    });
    this.ref('metric-rate').textContent = t('shell.rateValue', {
      rate: sky.angularRateDegPerMin.toFixed(3),
    });
    this.ref('metric-mag').textContent = t('shell.magnitudeValue', {
      magnitude: sky.magnitude.toFixed(2),
    });
    this.ref('metric-size').textContent = `${sky.angularDiameterArcsec.toFixed(3)}″`;
    this.ref('metric-size-sub').textContent = t('shell.sizeSub');
    this.ref('metric-moon').textContent = moonSep === null ? '—' : fmtDeg(moonSep, 2);
    this.ref('metric-view').textContent = !above
      ? t('shell.viewBelow')
      : inWindow
        ? t('shell.viewInWindow')
        : t('shell.viewNotDark');
    this.ref('metric-view-sub').textContent = inWindow
      ? t('shell.viewSubPhase1')
      : t('shell.viewSubNotMet');
    this.ref('sky-refraction-badge').textContent = state.toggles.refraction
      ? t('shell.badgeDisplayRefracted')
      : t('shell.badgeAirless');
    this.ref('sky-visibility-badge').textContent = !above
      ? t('shell.badgeVisibilityBelow')
      : inWindow
        ? t('shell.badgeVisibilityVisible')
        : t('shell.badgeVisibilityNotDark');
    this.ref('sky-visibility-badge').className = `badge ${
      above && inWindow ? 'good' : above ? 'warn' : ''
    }`;
    this.ref('readout-note').textContent = state.toggles.refraction
      ? t('shell.readoutNoteRefracted')
      : t('shell.readoutNoteAirless');
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
          ? `<strong>${t('shell.trailTicksTitle')}</strong> ${ticks
              .map((s) => localHhMm(s.utcMs, state.timeZone))
              .join(' · ')}`
          : t('shell.trailTicksNone');
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
        <span class="badge good">${t('shell.sizeBadge', {
          arcsec: apophis.angularArcsec.toFixed(3),
        })}</span>
        <span class="chip">${t('shell.sizeAtRange', {
          range: fmtKm(sky.rangeKm),
        })}</span>
      </div>
      <table class="size-table">
        <thead><tr><th>${t('shell.sizeTableObject')}</th><th class="num">${t(
          'shell.sizeTableAngular',
        )}</th><th class="num">${t('shell.sizeTableVsApophis')}</th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const width = Math.max(0.5, Math.min(100, (r.angularArcsec / maxArc) * 100));
              return `<tr title="${esc(r.source)}">
                <td>${esc(
                  SIZE_OBJECT_LABELS[
                    r.id as keyof typeof SIZE_OBJECT_LABELS
                  ]
                    ? t(
                        SIZE_OBJECT_LABELS[
                          r.id as keyof typeof SIZE_OBJECT_LABELS
                        ],
                      )
                    : r.name,
                )}<div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(2)}%"></div></div></td>
                <td class="num">${fmtArcsec(r.angularArcsec)}</td>
                <td class="num">${r.relativeToApophis >= 1000 ? `${Math.round(r.relativeToApophis).toLocaleString('en-US')}×` : `${r.relativeToApophis.toFixed(2)}×`}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <p class="size-note">${t('shell.sizeNote', {
        arcsec: apophis.angularArcsec.toFixed(3),
      })}</p>
    `;
    this.ref('size-panel').innerHTML = html;
  }

  private updateDebug(sky: SkyPosition, state: UiState): void {
    if (!this.debug) return;
    // Debug-only overlay (`?debug=1`); technical labels stay untranslated.
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
      : t('shell.aboutDevelopment');
    this.ref('about-build').innerHTML = t('shell.aboutBuild', {
      version: esc(__APP_VERSION__),
      buildDate: esc(buildDate),
      provider: esc(sourceInfo?.provider ?? '—'),
      solution: esc(sourceInfo?.solution ?? '—'),
      retrieved: esc(sourceInfo?.retrievedAt ?? '—'),
      activeSource:
        sourceInfo?.activeSource === 'prepared'
          ? t('shell.aboutActivePrepared')
          : t('shell.aboutActiveBuiltIn'),
      queryLink: sourceInfo?.queryUrl
        ? t('shell.aboutQueryLink', { url: esc(sourceInfo.queryUrl) })
        : '',
    });

    if (!snapshot) {
      this.ref('about-offline').innerHTML = t('shell.aboutOfflineNone');
    } else {
      const b = snapshot.buildings;
      this.ref('about-offline').innerHTML = t('shell.aboutOfflinePresent', {
        prepared: esc(formatPreparedDate(snapshot.preparedAt, state?.timeZone)),
        bytes: esc(formatBytes(snapshot.totalBytes)),
        area: esc(snapshot.area.label),
        searchRadius: Math.round(
          snapshot.area.searchRadiusM,
        ).toLocaleString('ro-RO'),
        buildingRadius: Math.round(
          snapshot.area.buildingRadiusM,
        ).toLocaleString('ro-RO'),
        solution: esc(snapshot.ephemeris.solution),
        retrieved: esc(snapshot.ephemeris.retrievedAt),
        ephemerisBytes: esc(formatBytes(snapshot.ephemeris.bytes)),
        stars: snapshot.stars
          ? t('shell.aboutStarsValue', {
              source: esc(snapshot.stars.source),
              bytes: esc(formatBytes(snapshot.stars.bytes)),
            })
          : t('shell.aboutNotStored'),
        tileCount: snapshot.terrain.tileCount,
        zoom: snapshot.area.terrainZoom,
        terrainBytes: esc(formatBytes(snapshot.terrain.bytes)),
        attribution: esc(snapshot.terrain.attribution),
        buildings: b
          ? t('shell.aboutBuildingsValue', {
              count: b.count,
              defaultCount: b.defaultHeightCount,
              bytes: esc(formatBytes(b.bytes)),
              source: esc(b.source),
              sourceLabel: b.sourceLabel
                ? t('shell.aboutSourceLabel', {
                    label: esc(b.sourceLabel),
                  })
                : '',
              retrieved: esc(b.retrievedAt),
            })
          : t('shell.aboutBuildingsMissing'),
        baseMapNote: esc(snapshot.baseMap.note),
        warnings: snapshot.warnings.length
          ? t('shell.aboutWarnings', {
              warnings: snapshot.warnings.map(esc).join('<br />'),
            })
          : '',
        provider: esc(snapshot.ephemeris.provider),
      });
    }

    void storageInfo().then((info) => {
      if (!info.supported) {
        this.aboutStorageText = t('shell.aboutStorageUnsupported');
      } else {
        this.aboutStorageText = t('shell.aboutStorageSupported', {
          persistence: info.persisted
            ? t('shell.aboutPersistentGranted')
            : t('shell.aboutBestEffort'),
          used:
            info.usageBytes !== null
              ? formatBytes(info.usageBytes)
              : t('shell.aboutUsageUnknown'),
          quota:
            info.quotaBytes !== null
              ? formatBytes(info.quotaBytes)
              : t('shell.aboutQuotaUnknown'),
        });
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
          sourceEndpoint?: string;
          sourceQuery?: string;
          license?: string;
          buildingCount?: number;
        }>;
      };
      const areas = Array.isArray(manifest.areas) ? manifest.areas : [];
      if (areas.length === 0) {
        node.innerHTML = t('shell.aboutAreasNone');
        return;
      }
      node.innerHTML = `<ul class="about-list">${areas
        .map(
          (area) =>
            t('shell.aboutAreaItem', {
              name: esc(area.name ?? t('shell.aboutAreaFallback')),
              lat: Number(area.latitudeDeg ?? 0).toFixed(4),
              lon: Number(area.longitudeDeg ?? 0).toFixed(4),
              radius: Math.round(area.radiusM ?? 0),
              count: area.buildingCount ?? '?',
              retrieved: esc(area.retrievedAt ?? '—'),
              source: area.source
                ? t('shell.aboutAreaSource', { source: esc(area.source) })
                : '',
              endpoint: area.sourceEndpoint
                ? t('shell.aboutAreaEndpoint', {
                    endpoint: esc(area.sourceEndpoint),
                  })
                : '',
              query: area.sourceQuery
                ? t('shell.aboutAreaQuery', { query: esc(area.sourceQuery) })
                : '',
              license: area.license
                ? t('shell.aboutAreaLicense', { license: esc(area.license) })
                : '',
            }),
        )
        .join('')}</ul>`;
    } catch {
      node.innerHTML = t('shell.aboutAreasError');
    }
  }

  private renderCredits(): void {
    const catalogue = this.app.getCatalogue();
    const starCredit = catalogue
      ? t('shell.creditsStars', {
          source: esc(catalogue.metadata.source),
          license: esc(catalogue.metadata.license),
          attribution: esc(catalogue.metadata.attribution),
        })
      : t('shell.creditsStarsUnavailable');
    const constellationCredit = catalogue?.metadata.constellationSource
      ? t('shell.creditsConstellations', {
          source: esc(catalogue.metadata.constellationSource),
          license: esc(
            catalogue.metadata.constellationLicense ??
              t('shell.creditsSeeSource'),
          ),
        })
      : '';
    this.ref('credits').innerHTML = t('shell.creditsBlock', {
      starCredit,
      constellationCredit,
    });
  }
}
