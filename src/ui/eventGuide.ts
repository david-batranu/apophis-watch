/**
 * Event-day plan and checklist.
 *
 * All times/directions come from the current SimulationSession, not from
 * hardcoded event-day numbers. The checklist is user state in localStorage.
 */

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
    label: 'Charge the phone and bring a power bank',
    detail: 'Cold batteries drain faster; AR and GPS are power-hungry.',
  },
  {
    id: 'update',
    label: 'Update the app and open it once while online',
    detail: 'A new build is offered as a reload prompt; do not update in the field.',
  },
  {
    id: 'install',
    label: 'Install the PWA / Add to Home Screen',
    detail: 'On iOS this is what keeps offline data from being evicted after 7 days without a tap.',
  },
  {
    id: 'prepare',
    label: 'Prepare the offline area for the chosen spot',
    detail: 'Local 3D → Prepare for offline. Wait for “Offline area ready”.',
  },
  {
    id: 'calibrate',
    label: 'Calibrate AR on the Moon or a bright planet',
    detail: 'Do this before it gets dark, while the object is easy to identify.',
  },
  {
    id: 'early',
    label: 'Go outside at least 30–45 minutes early',
    detail: 'Let your eyes adapt and confirm the horizon is clear.',
  },
  {
    id: 'direction',
    label: 'Check the predicted direction and time below',
    detail: 'Use the compass rose and the Local 3D horizon to find the sector.',
  },
  {
    id: 'expectation',
    label: 'Expect a fast-moving point of light, not a disc',
    detail: 'At flyby the angular size is only a few arcseconds; the trail is the giveaway.',
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
            <h2>Event day</h2>
            <p class="status-line">A short plan generated from the current observer, ephemeris and visibility window.</p>
          </div>
          <span class="badge good">13 April 2029</span>
        </div>
        <div class="event-grid">
          <div>
            <h3>Your plan</h3>
            <div class="event-plan" data-ref="event-plan">Waiting for the simulation session.</div>
          </div>
          <div>
            <h3>Checklist</h3>
            <ul class="event-checklist" data-ref="event-checklist"></ul>
          </div>
        </div>
        <p class="status-line">The object is a point of light. The app’s marker is enlarged only when you turn on “Enlarged marker”; the true angular size is shown in the readout.</p>
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
      this.planEl.textContent = 'Waiting for the ephemeris and observer.';
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
        session.visibility.reason ||
          'No physical Phase 1 visibility window at this location.',
      )}</p><p class="status-line">Choose another observer or check the Sun/Moon geometry.</p>`;
      return;
    }

    const spotNote =
      'Run the best-spot search in Local 3D, tap a result and press “Make this the observer” to make this plan spot-specific.';
    const direction =
      minAz !== null && maxAz !== null
        ? `${minAz.toFixed(1)}° (${compass16(minAz)}) → ${maxAz.toFixed(1)}° (${compass16(maxAz)})`
        : '—';

    this.planEl.innerHTML = `
      <dl class="event-plan-list">
        <dt>Location</dt>
        <dd>${state.observer.latitudeDeg.toFixed(5)}°, ${state.observer.longitudeDeg.toFixed(5)}° · ground ${
          state.observer.groundElevationM === null
            ? 'unknown'
            : `${state.observer.groundElevationM.toFixed(1)} m`
        } · eye ${state.observer.eyeHeightM.toFixed(1)} m</dd>
        <dt>Closest approach</dt>
        <dd><strong>${formatUtc(caMs)}</strong> · ${localCa} · range ${Math.round(
          ca.rangeKm,
        ).toLocaleString('ro-RO')} km</dd>
        <dt>Look at closest approach</dt>
        <dd><strong>${ca.azimuthDeg.toFixed(1)}° (${compass16(
          ca.azimuthDeg,
        )})</strong>, elevation <strong>${ca.elevationDeg.toFixed(1)}°</strong></dd>
        <dt>Visible window</dt>
        <dd>${startMs === null ? '—' : `${formatUtc(startMs)} (${startLocal})`} → ${
          endMs === null ? '—' : `${formatUtc(endMs)} (${endLocal})`
        }</dd>
        <dt>Highest</dt>
        <dd>${
          maxMs === null
            ? '—'
            : `${formatUtc(maxMs)} (${maxLocal}) at ${session.visibility.maxElevationDeg.toFixed(
                1,
              )}°`
        }</dd>
        <dt>Path direction</dt>
        <dd>${direction} · elevation ${Math.min(
          ...visible.map((sample) => sample.elevationDeg),
        ).toFixed(1)}° → ${Math.max(
          ...visible.map((sample) => sample.elevationDeg),
        ).toFixed(1)}°</dd>
        <dt>What you will see</dt>
        <dd>A fast-moving point of light (V ≈ ${ca.magnitude.toFixed(
          1,
        )}, true size ${ca.angularDiameterArcsec.toFixed(
          2,
        )}″). It will not look like a disc or a movie asteroid. The trail and motion are the signature.</dd>
        <dt>Spot</dt>
        <dd>${spotNote}</dd>
      </dl>
    `;
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
