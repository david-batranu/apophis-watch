/**
 * Event-day plan and checklist.
 *
 * All times/directions come from the current SimulationSession, not from
 * hardcoded event-day numbers. The checklist is user state in localStorage.
 */

import { t } from '../i18n';
import type { AppModel } from '../state/appModel';
import type { UiState } from '../state/store';
import { formatLocalLocale, formatUtc } from './timeFormat';

const CHECKLIST_KEY = 'apophis-event-checklist-v1';

interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
}

const CHECKLIST: ChecklistItem[] = [
  {
    id: 'charge',
    label: t('event.checklistItems.charge.label'),
    detail: t('event.checklistItems.charge.detail'),
  },
  {
    id: 'update',
    label: t('event.checklistItems.update.label'),
    detail: t('event.checklistItems.update.detail'),
  },
  {
    id: 'install',
    label: t('event.checklistItems.install.label'),
    detail: t('event.checklistItems.install.detail'),
  },
  {
    id: 'prepare',
    label: t('event.checklistItems.prepare.label'),
    detail: t('event.checklistItems.prepare.detail'),
  },
  {
    id: 'calibrate',
    label: t('event.checklistItems.calibrate.label'),
    detail: t('event.checklistItems.calibrate.detail'),
  },
  {
    id: 'early',
    label: t('event.checklistItems.early.label'),
    detail: t('event.checklistItems.early.detail'),
  },
  {
    id: 'direction',
    label: t('event.checklistItems.direction.label'),
    detail: t('event.checklistItems.direction.detail'),
  },
  {
    id: 'expectation',
    label: t('event.checklistItems.expectation.label'),
    detail: t('event.checklistItems.expectation.detail'),
  },
];

function checklistState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveChecklist(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(state));
  } catch {
    // Checklist persistence is optional.
  }
}

function compass16(azimuthDeg: number): string {
  const names = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const index = Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16;
  return names[index];
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
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

export class EventGuide {
  private readonly root: HTMLElement;
  private readonly app: AppModel;
  private readonly planEl: HTMLElement;
  private readonly checklistEl: HTMLElement;
  private lastKey = '';
  private checks = checklistState();

  constructor(root: HTMLElement, app: AppModel) {
    this.root = root;
    this.app = app;
    this.root.innerHTML = `
      <section class="panel event-day">
        <div class="event-head">
          <div>
            <h2>${t('event.title')}</h2>
            <p class="status-line">${t('event.subtitle')}</p>
          </div>
          <span class="badge good">${t('event.badge')}</span>
        </div>
        <div class="event-grid">
          <div>
            <h3>${t('event.yourPlan')}</h3>
            <div class="event-plan" data-ref="event-plan">${t('event.waitingSession')}</div>
          </div>
          <div>
            <h3>${t('event.checklist')}</h3>
            <ul class="event-checklist" data-ref="event-checklist"></ul>
          </div>
        </div>
        <p class="status-line">${t('event.footer')}</p>
      </section>
    `;
    this.planEl = this.root.querySelector<HTMLElement>('[data-ref="event-plan"]')!;
    this.checklistEl = this.root.querySelector<HTMLElement>('[data-ref="event-checklist"]')!;
    this.renderChecklist();
    this.checklistEl.addEventListener('change', (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>(
        'input[type="checkbox"][data-check]',
      );
      if (!input) return;
      this.checks[input.dataset.check!] = input.checked;
      saveChecklist(this.checks);
    });
  }

  update(state: UiState): void {
    const session = this.app.getSession();
    if (!session || !state.observer) {
      this.planEl.textContent = t('event.waitingObserver');
      return;
    }
    const key = [
      state.observer.latitudeDeg.toFixed(5),
      state.observer.longitudeDeg.toFixed(5),
      state.observer.groundElevationM,
      state.observer.eyeHeightM,
      session.topocentricCa.utc.getTime(),
      state.timeZone,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const caMs = session.topocentricCa.utc.getTime();
    const ca = session.skyAt(caMs, false);
    const localCa = formatLocalLocale(caMs, state.timeZone);
    const maxMs = session.visibility.maxElevationUtc?.getTime() ?? null;
    const maxLocal = maxMs === null ? null : formatLocalLocale(maxMs, state.timeZone);
    const interval = session.visibleIntervalForJump();
    const startMs = interval?.startUtc.getTime() ?? null;
    const endMs = interval?.endUtc.getTime() ?? null;
    const startLocal = startMs === null ? null : formatLocalLocale(startMs, state.timeZone);
    const endLocal = endMs === null ? null : formatLocalLocale(endMs, state.timeZone);
    const trail = session.trail(caMs, 12, false);
    const visible = trail.filter((sample) => sample.elevationDeg > 0);
    const minAz = visible.length
      ? Math.min(...visible.map((sample) => sample.azimuthDeg))
      : null;
    const maxAz = visible.length
      ? Math.max(...visible.map((sample) => sample.azimuthDeg))
      : null;

    if (session.visibility.intervals.length === 0) {
      this.planEl.innerHTML = `<p class="status-line error">${esc(
        session.visibility.reason || t('event.noWindowFallback'),
      )}</p><p class="status-line">${t('event.chooseAnother')}</p>`;
      return;
    }

    const spotNote = t('event.spotNote');
    const direction =
      minAz !== null && maxAz !== null
        ? `${minAz.toFixed(1)}° (${compass16(minAz)}) → ${maxAz.toFixed(1)}° (${compass16(maxAz)})`
        : '—';

    const elevationMin = visible.length
      ? Math.min(...visible.map((sample) => sample.elevationDeg))
      : 0;
    const elevationMax = visible.length
      ? Math.max(...visible.map((sample) => sample.elevationDeg))
      : 0;

    this.planEl.innerHTML = t('event.plan', {
      location: t('event.locationLine', {
        lat: state.observer.latitudeDeg.toFixed(5),
        lon: state.observer.longitudeDeg.toFixed(5),
        ground:
          state.observer.groundElevationM === null
            ? t('event.groundUnknown')
            : `${state.observer.groundElevationM.toFixed(1)} m`,
        eye: state.observer.eyeHeightM.toFixed(1),
      }),
      caUtc: formatUtc(caMs),
      caLocal: localCa,
      range: Math.round(ca.rangeKm).toLocaleString('ro-RO'),
      azimuth: ca.azimuthDeg.toFixed(1),
      compass: compass16(ca.azimuthDeg),
      elevation: ca.elevationDeg.toFixed(1),
      window: t('event.visibleWindow', {
        start: startMs === null ? '—' : `${formatUtc(startMs)} (${startLocal})`,
        end: endMs === null ? '—' : `${formatUtc(endMs)} (${endLocal})`,
      }),
      highest:
        maxMs === null
          ? '—'
          : t('event.highest', {
              time: formatUtc(maxMs),
              local: maxLocal ?? '',
              elevation: session.visibility.maxElevationDeg.toFixed(1),
            }),
      direction: t('event.pathDirection', {
        direction,
        min: elevationMin.toFixed(1),
        max: elevationMax.toFixed(1),
      }),
      what: t('event.whatYouSee', {
        magnitude: ca.magnitude.toFixed(1),
        size: ca.angularDiameterArcsec.toFixed(2),
      }),
      spot: spotNote,
    });
  }

  private renderChecklist(): void {
    this.checklistEl.innerHTML = CHECKLIST.map((item) => {
      const checked = this.checks[item.id] === true;
      return `<li>
        <label class="event-check">
          <input type="checkbox" data-check="${item.id}" ${checked ? 'checked' : ''} />
          <span><strong>${esc(item.label)}</strong><br /><span class="status-line">${esc(
            item.detail,
          )}</span></span>
        </label>
      </li>`;
    }).join('');
  }
}
