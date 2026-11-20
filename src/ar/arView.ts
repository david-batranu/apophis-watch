import type { ObserverLocation } from '../ephemeris/types';
import type { StarCatalogue } from '../sky/catalog';
import { toObserverLocation, type UiState } from '../state/store';
import type { SimulationSession } from '../state/session';
import {
  CALIBRATION_STORAGE_KEY,
  angularSeparationDeg,
  defaultCalibration,
  estimatePointingError,
  loadCalibration,
  nudgeHeadingOffset,
  recordAlignment,
  recordFovCalibration,
  recordTwoPointAlignment,
  saveCalibration,
  setHeadingOffset,
  setHorizontalFov,
  solveFovFromAngularSeparation,
  type CalibrationInput,
  type CalibrationState,
  type FovCalibration,
  type FovTap,
} from './calibration';
import { computeDeclination, type DeclinationResult } from './declination';
import type { ArHostApi, ArWorkstream } from './host';
import {
  cameraForward,
  cameraUp,
  headingFromQuat,
  pitchFromQuat,
  quatAddHeading,
  quatAimAtHeading,
  quatAngleBetween,
  quatFromDeviceOrientation,
  quatFromVirtualLook,
  quatSlerp,
  screenAngleFromSources,
  shortestAngleDeg,
  type Quat,
} from './math';
import {
  CARDINALS,
  createProjection,
  projectAzEl,
  sampleHorizon,
  type ArProjection,
  type ProjectedScreenPoint,
} from './projection';
import {
  buildArTrail,
  buildSkySnapshot,
  type ArSkySnapshot,
  type ArTimeMode,
  type ArTrailPoint,
  type SkyTarget,
} from './targets';

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable' | 'insecure';
type SensorState =
  | 'idle'
  | 'requesting'
  | 'compass'
  | 'absolute'
  | 'relative'
  | 'denied'
  | 'unavailable';

interface OrientationSample {
  alphaDeg: number;
  betaDeg: number;
  gammaDeg: number;
  absolute: boolean;
  compassHeadingDeg: number | null;
  compassAccuracyDeg: number | null;
  source: 'compass' | 'absolute' | 'relative';
  at: number;
}

interface DeviceOrientationLike extends Event {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

interface FovTapMark extends FovTap {
  targetId: string;
  targetName: string;
  azimuthDeg: number;
  elevationDeg: number;
  atMs: number;
}

interface Palette {
  horizon: string;
  horizonGlow: string;
  cardinal: string;
  star: string;
  starLabel: string;
  planet: string;
  sun: string;
  moon: string;
  apophis: string;
  trail: string;
  tick: string;
  label: string;
  labelBg: string;
  muted: string;
  warning: string;
  reticle: string;
  debug: string;
}

const DAY_PALETTE: Palette = {
  horizon: '#8fb8e0',
  horizonGlow: 'rgba(143,184,224,0.25)',
  cardinal: '#dbe6f6',
  star: '#e8f0ff',
  starLabel: '#c9d6e8',
  planet: '#e8c9a0',
  sun: '#ffd166',
  moon: '#eef2f7',
  apophis: '#ff5a5f',
  trail: 'rgba(255,90,95,0.9)',
  tick: '#ffb3b5',
  label: '#dbe6f6',
  labelBg: 'rgba(4,8,14,0.62)',
  muted: '#8b9bb0',
  warning: '#ffb347',
  reticle: 'rgba(219,230,246,0.75)',
  debug: '#9fe3ff',
};

const NIGHT_PALETTE: Palette = {
  horizon: '#ff4b3e',
  horizonGlow: 'rgba(255,75,62,0.22)',
  cardinal: '#ff8a7a',
  star: '#ff6b5e',
  starLabel: '#c84a40',
  planet: '#ff5a4a',
  sun: '#ff2a1a',
  moon: '#ffb0a0',
  apophis: '#ff0000',
  trail: 'rgba(255,59,48,0.92)',
  tick: '#ff7a6e',
  label: '#ff8a7a',
  labelBg: 'rgba(0,0,0,0.75)',
  muted: '#a33a30',
  warning: '#ff7a00',
  reticle: 'rgba(255,138,122,0.8)',
  debug: '#ff8a7a',
};

const STAR_LABEL_MAG = 1.1;

function fmtDeg(value: number, digits = 1): string {
  return `${value.toFixed(digits)}°`;
}

function fmtKm(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
}

function escapeHtml(value: string): string {
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

function datetimeUtcValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

function observerKey(observer: ObserverLocation | null): string {
  if (!observer) return 'none';
  return `${observer.latitudeDeg.toFixed(5)}|${observer.longitudeDeg.toFixed(5)}|${(
    observer.elevationM ?? 0
  ).toFixed(1)}`;
}

/**
 * The AR workstream. It builds its own DOM inside the supplied root, owns the
 * camera and orientation listeners, and only reads state/session/catalogue
 * through the host API. It never recomputes the Apophis ephemeris.
 */
export class ArView implements ArWorkstream {
  private readonly root: HTMLElement;
  private readonly api: ArHostApi;
  private state: Readonly<UiState>;
  private calibration: CalibrationState;
  private mounted = false;
  private unsubscribe: (() => void) | null = null;
  private rafId: number | null = null;
  private lastFrame = 0;
  private lastDebugUpdate = 0;
  private lastReadingUpdate = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D | null;
  private video!: HTMLVideoElement;
  private debugEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private readingEl!: HTMLElement;
  private alignSelect!: HTMLSelectElement;
  private alignButton!: HTMLButtonElement;
  private twoPointButton!: HTMLButtonElement;
  private offsetInput!: HTMLInputElement;
  private offsetValue!: HTMLElement;
  private fovInput!: HTMLInputElement;
  private fovValue!: HTMLElement;
  private fovTargetASelect!: HTMLSelectElement;
  private fovTargetBSelect!: HTMLSelectElement;
  private fovTapAButton!: HTMLButtonElement;
  private fovTapBButton!: HTMLButtonElement;
  private fovStatusEl!: HTMLElement;
  private tapCapture!: HTMLElement;
  private tapPrompt!: HTMLElement;
  private errorEl!: HTMLElement;
  private timeInput!: HTMLInputElement;
  private modeButtons: HTMLButtonElement[] = [];
  private statusCamera!: HTMLElement;
  private statusSensor!: HTMLElement;
  private statusTime!: HTMLElement;
  private statusAccuracy!: HTMLElement;
  private touchToggle!: HTMLInputElement;
  private enableSensorsButton!: HTMLButtonElement;
  private enableSensorsTopButton!: HTMLButtonElement;
  private retryCameraButton!: HTMLButtonElement;

  private cameraState: CameraState = 'idle';
  private cameraMessage = 'Camera not started.';
  private stream: MediaStream | null = null;
  private sensorState: SensorState = 'idle';
  private sensorMessage = 'Sensors not started.';
  private sensorUiSignature = '';
  private latestSample: OrientationSample | null = null;
  private lastAbsoluteAt = 0;
  private permissionRequested = false;
  private sensorPermissionDenied = false;
  private sensorDenialMessage: string | null = null;
  private sensorWatchdog: number | null = null;
  private touchMode = false;
  private virtualHeadingDeg = 0;
  private virtualPitchDeg = 12;
  private pointerId: number | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private clickHandler: ((event: MouseEvent) => void) | null = null;

  private screenAngleDeg = 0;
  private projection: ArProjection = createProjection(1, 1, 60);
  private displayQuat: Quat | null = null;
  private snapNextFrame = true;
  private measuredHeadingDeg: number | null = null;
  private displayHeadingDeg: number | null = null;
  private displayPitchDeg: number | null = null;
  private declination: DeclinationResult | null = null;
  private declinationKey = '';
  private lastDeclinationSignature = '';
  private timeMode: ArTimeMode = 'rehearsal';
  private snapshot: ArSkySnapshot | null = null;
  private snapshotKey = '';
  private lastSnapshotAt = 0;
  private trailCache: { key: string; points: ArTrailPoint[] } = { key: '', points: [] };
  private lastTrailAt = 0;
  private lastAlignSignature = '__unset__';
  private twoPointFirst: CalibrationInput | null = null;
  private fovTapArmed: 'A' | 'B' | null = null;
  private fovArmedTarget: SkyTarget | null = null;
  private fovTapA: FovTapMark | null = null;
  private fovTapB: FovTapMark | null = null;
  private selectedAlignId = '';
  private lastApophisPoint: ProjectedScreenPoint | null = null;
  private selectedPoint: ProjectedScreenPoint | null = null;
  private lastStatus = '';
  private localMessage = '';
  private localMessageTimer: number | null = null;

  constructor(root: HTMLElement, api: ArHostApi) {
    this.root = root;
    this.api = api;
    this.state = api.getState();
    this.calibration = loadCalibration();
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.cameraState = 'idle';
    this.cameraMessage = 'Camera not started.';
    this.touchMode = false;
    this.displayQuat = null;
    this.snapNextFrame = true;
    this.lastFrame = 0;
    this.lastSnapshotAt = 0;
    this.lastTrailAt = 0;
    this.twoPointFirst = null;
    this.fovTapArmed = null;
    this.resetFovTaps();
    this.lastAlignSignature = '__unset__';
    this.snapshotKey = '';
    this.trailCache = { key: '', points: [] };
    this.root.classList.add('ar-root');
    this.root.innerHTML = this.template();
    this.bindRefs();
    this.bindEvents();
    this.updateScreenAngle();
    this.applyState();
    this.renderCalibrationUi();
    this.setCameraState('idle', 'Requesting rear camera…');
    this.startCamera();
    this.startOrientationListeners();
    this.maybeShowPermissionUi();
    this.unsubscribe = this.api.subscribe((state) => this.update(state));
    window.setTimeout(() => this.checkSensorWatchdog(), 2600);
    this.rafId = requestAnimationFrame(this.frame);
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.clickHandler) {
      this.root.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
    this.stopCamera();
    this.stopOrientationListeners();
    if (this.sensorWatchdog !== null) window.clearTimeout(this.sensorWatchdog);
    if (this.localMessageTimer !== null) window.clearTimeout(this.localMessageTimer);
    if (typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.removeEventListener('change', this.screenOrientationHandler);
    }
    window.removeEventListener('orientationchange', this.screenOrientationHandler);
    window.removeEventListener('resize', this.screenOrientationHandler);

    // Do not let local-only modes leak into the next mount. The next mount
    // starts cleanly with sensors; the watchdog re-enables touch fallback if
    // the sensors are still unavailable.
    this.touchMode = false;
    if (this.touchToggle) this.touchToggle.checked = false;
    this.root.classList.remove('ar-touch');
    this.cameraState = 'idle';
    this.cameraMessage = 'Camera not started.';
    this.sensorUiSignature = '';
    this.displayQuat = null;
    this.snapNextFrame = true;
    this.lastFrame = 0;
    this.lastSnapshotAt = 0;
    this.lastTrailAt = 0;
    this.twoPointFirst = null;
    this.resetFovTaps();
    this.fovTapArmed = null;
    this.localMessage = '';
    this.snapshotKey = '';
    this.trailCache = { key: '', points: [] };
    this.lastAlignSignature = '__unset__';
    this.lastDeclinationSignature = '';

    this.root.innerHTML = '';
    this.root.classList.remove('ar-root', 'ar-night');
    this.api.setStatus(null);
  }

  update(state: Readonly<UiState>): void {
    this.state = state;
    if (!this.mounted) return;
    this.applyState();
  }

  /** Test/diagnostic hook: current alignment targets in horizontal coordinates. */
  getAlignTargets(): { id: string; name: string; azimuthDeg: number; elevationDeg: number }[] {
    return (this.snapshot?.alignTargets ?? []).map((target) => ({
      id: target.id,
      name: target.name,
      azimuthDeg: target.azimuthDeg,
      elevationDeg: target.elevationDeg,
    }));
  }

  /** Test/diagnostic hook: project a current AR target to screen pixels. */
  projectTarget(
    id: string,
  ): { x: number; y: number; inFront: boolean; visible: boolean } | null {
    const target =
      this.snapshot?.targets.find((t) => t.id === id) ??
      this.snapshot?.stars.find((t) => t.id === id);
    if (!target || !this.displayQuat) return null;
    const point = projectAzEl(
      target.azimuthDeg,
      target.elevationDeg,
      this.displayQuat,
      this.projection,
      0,
    );
    return { x: point.x, y: point.y, inFront: point.inFront, visible: point.visible };
  }

  private template(): string {
    return `
      <div class="ar-stage">
        <video class="ar-video" data-role="video" playsinline muted autoplay></video>
        <canvas class="ar-canvas" data-role="canvas" aria-label="Augmented reality sky overlay"></canvas>
        <div class="ar-vignette"></div>
        <div class="ar-top">
          <span class="ar-chip" data-role="status-camera">Camera</span>
          <span class="ar-chip" data-role="status-sensor">Sensors</span>
          <span class="ar-chip" data-role="status-accuracy">±—°</span>
          <span class="ar-chip" data-role="status-time">2029 rehearsal</span>
          <button class="ar-chip ar-chip-btn" data-role="enable-sensors-top" type="button">Enable compass</button>
          <button class="ar-chip ar-chip-btn" data-role="fullscreen" type="button">Full screen</button>
        </div>
        <div class="ar-reticle" aria-hidden="true"></div>
        <div class="ar-reading" data-role="reading">Waiting for the host clock…</div>
        <div class="ar-messages" data-role="messages"></div>
        <div class="ar-debug" data-role="debug" hidden></div>
        <div class="ar-tap-capture" data-role="tap-capture" hidden>
          <div class="ar-tap-prompt">
            <span data-role="tap-prompt">Tap a target in the image</span>
            <button type="button" data-role="tap-cancel">Cancel</button>
          </div>
        </div>
        <div class="ar-bottom">
          <details class="ar-panel">
            <summary>Calibration</summary>
            <div class="ar-grid">
              <label class="ar-field">
                <span>Heading offset <output data-role="offset-value">+0.0°</output></span>
                <input type="range" data-role="offset" min="-180" max="180" step="0.5" value="0" />
              </label>
              <div class="ar-row ar-nudges">
                <button type="button" data-nudge="-1">−1°</button>
                <button type="button" data-nudge="-0.1">−0.1°</button>
                <button type="button" data-nudge="0.1">+0.1°</button>
                <button type="button" data-nudge="1">+1°</button>
              </div>
              <label class="ar-field">
                <span>Horizontal FOV <output data-role="fov-value">60.0°</output></span>
                <input type="range" data-role="fov" min="30" max="100" step="0.5" value="60" />
              </label>
              <div class="ar-row">
                <select data-role="fov-target-a" aria-label="FOV target A"></select>
                <button type="button" data-role="fov-tap-a">Tap A</button>
              </div>
              <div class="ar-row">
                <select data-role="fov-target-b" aria-label="FOV target B"></select>
                <button type="button" data-role="fov-tap-b">Tap B</button>
              </div>
              <p class="ar-note" data-role="fov-status">FOV from two taps: choose two objects at least 5° apart, then tap each in the camera image.</p>
              <div class="ar-row">
                <select data-role="align-select" aria-label="Calibration target"></select>
                <button class="ar-primary" type="button" data-role="align">Align on target</button>
              </div>
              <div class="ar-row">
                <button type="button" data-role="two-point">Two-point heading: mark A</button>
                <button type="button" data-role="reset-cal">Reset</button>
              </div>
              <p class="ar-note" data-role="error-estimate">±—° estimated pointing error.</p>
              <p class="ar-note">One tap centres the overlay on a known object. Two-point heading averages two heading marks and reports their disagreement. FOV from two taps is separate: it solves the lens FOV from the pixel spacing of two known objects and does not claim to fix heading.</p>
            </div>
          </details>
          <details class="ar-panel">
            <summary>Rehearsal &amp; fallback</summary>
            <div class="ar-grid">
              <div class="ar-row ar-mode-row">
                <button type="button" data-mode="rehearsal" aria-pressed="true">2029 rehearsal</button>
                <button type="button" data-mode="tonight" aria-pressed="false">Tonight practice</button>
              </div>
              <label class="ar-field">
                <span>Rehearsal time (UTC)</span>
                <input type="datetime-local" step="1" data-role="time-input" />
              </label>
              <div class="ar-row">
                <button class="ar-primary" type="button" data-role="time-go">Go</button>
                <button type="button" data-jump="topocentricCa">Closest approach</button>
                <button type="button" data-jump="visibilityStart">Visible start</button>
                <button type="button" data-jump="rise">Rise</button>
              </div>
              <label class="ar-toggle">
                <input type="checkbox" data-role="touch-toggle" />
                Touch-drag virtual AR (no sensors)
              </label>
              <div class="ar-row">
                <button class="ar-primary" type="button" data-role="enable-sensors">Enable compass / motion</button>
                <button type="button" data-role="retry-camera">Retry camera</button>
              </div>
              <p class="ar-note" data-role="sensor-note">Absolute compass is requested only from a user gesture on iOS. Android Chrome may grant it automatically.</p>
              <p class="ar-note">Tonight practice uses the real clock for Sun, Moon, planets and stars. Apophis is hidden there because the committed ephemeris covers only 13–14 April 2029 (UTC ±24 h).</p>
            </div>
          </details>
        </div>
      </div>
    `;
  }

  private ref<T extends HTMLElement = HTMLElement>(role: string): T {
    const node = this.root.querySelector<T>(`[data-role="${role}"]`);
    if (!node) throw new Error(`AR control missing: ${role}`);
    return node;
  }

  private bindRefs(): void {
    this.canvas = this.ref<HTMLCanvasElement>('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.video = this.ref<HTMLVideoElement>('video');
    this.debugEl = this.ref('debug');
    this.messagesEl = this.ref('messages');
    this.readingEl = this.ref('reading');
    this.alignSelect = this.ref<HTMLSelectElement>('align-select');
    this.alignButton = this.ref<HTMLButtonElement>('align');
    this.twoPointButton = this.ref<HTMLButtonElement>('two-point');
    this.offsetInput = this.ref<HTMLInputElement>('offset');
    this.offsetValue = this.ref('offset-value');
    this.fovInput = this.ref<HTMLInputElement>('fov');
    this.fovValue = this.ref('fov-value');
    this.fovTargetASelect = this.ref<HTMLSelectElement>('fov-target-a');
    this.fovTargetBSelect = this.ref<HTMLSelectElement>('fov-target-b');
    this.fovTapAButton = this.ref<HTMLButtonElement>('fov-tap-a');
    this.fovTapBButton = this.ref<HTMLButtonElement>('fov-tap-b');
    this.fovStatusEl = this.ref('fov-status');
    this.tapCapture = this.ref('tap-capture');
    this.tapPrompt = this.ref('tap-prompt');
    this.errorEl = this.ref('error-estimate');
    this.timeInput = this.ref<HTMLInputElement>('time-input');
    this.statusCamera = this.ref('status-camera');
    this.statusSensor = this.ref('status-sensor');
    this.statusTime = this.ref('status-time');
    this.statusAccuracy = this.ref('status-accuracy');
    this.touchToggle = this.ref<HTMLInputElement>('touch-toggle');
    this.enableSensorsButton = this.ref<HTMLButtonElement>('enable-sensors');
    this.enableSensorsTopButton = this.ref<HTMLButtonElement>('enable-sensors-top');
    this.retryCameraButton = this.ref<HTMLButtonElement>('retry-camera');
    this.modeButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-mode]'));
    this.debugEl.hidden = !this.debugEnabled();
  }

  private bindEvents(): void {
    this.clickHandler = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('button');
      if (!target) return;
      if (target.dataset.nudge) {
        this.changeOffset(Number(target.dataset.nudge));
        return;
      }
      if (target.dataset.jump) {
        this.jumpTo(target.dataset.jump as 'topocentricCa' | 'visibilityStart' | 'rise');
        return;
      }
      if (target.dataset.mode) {
        this.setTimeMode(target.dataset.mode as ArTimeMode);
        return;
      }
      switch (target.dataset.role) {
        case 'align':
          this.alignOnSelectedTarget();
          break;
        case 'two-point':
          this.markTwoPoint();
          break;
        case 'fov-tap-a':
          this.armFovTap('A');
          break;
        case 'fov-tap-b':
          this.armFovTap('B');
          break;
        case 'tap-cancel':
          this.cancelFovTap();
          break;
        case 'reset-cal':
          this.resetCalibration();
          break;
        case 'time-go':
          this.applyTimeInput();
          break;
        case 'enable-sensors':
          void this.requestSensorsFromGesture();
          break;
        case 'enable-sensors-top':
          void this.requestSensorsFromGesture();
          break;
        case 'retry-camera':
          void this.startCamera();
          break;
        case 'fullscreen':
          void this.requestFullscreen();
          break;
      }
    };
    this.root.addEventListener('click', this.clickHandler);

    this.offsetInput.addEventListener('input', () => {
      this.calibration = setHeadingOffset(this.calibration, Number(this.offsetInput.value));
      this.persistCalibration();
      this.renderCalibrationUi();
    });
    this.fovInput.addEventListener('input', () => {
      this.calibration = setHorizontalFov(this.calibration, Number(this.fovInput.value));
      this.resetFovTaps();
      this.persistCalibration();
      this.renderCalibrationUi();
    });
    this.fovTargetASelect.addEventListener('change', () => {
      this.fovTapA = null;
      this.updateFovStatus();
    });
    this.fovTargetBSelect.addEventListener('change', () => {
      this.fovTapB = null;
      this.updateFovStatus();
    });
    this.tapCapture.addEventListener('click', this.onTapCaptureClick);
    this.touchToggle.addEventListener('change', () => {
      this.touchMode = this.touchToggle.checked;
      this.root.classList.toggle('ar-touch', this.touchMode);
      this.snapNextFrame = true;
      if (this.touchMode && this.latestSample) {
        const q = this.quatForSample(this.latestSample);
        this.virtualHeadingDeg = headingFromQuat(q);
        this.virtualPitchDeg = pitchFromQuat(q);
      }
      this.updateSensorStatus();
    });
    this.alignSelect.addEventListener('change', () => {
      this.selectedAlignId = this.alignSelect.value;
    });

    const pointerDown = (event: PointerEvent): void => {
      if (!this.touchMode) return;
      this.pointerId = event.pointerId;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const pointerMove = (event: PointerEvent): void => {
      if (!this.touchMode || this.pointerId !== event.pointerId || !this.lastPointer) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      const perPixel = this.projection.horizontalFovDeg / Math.max(1, this.projection.width);
      this.virtualHeadingDeg = (this.virtualHeadingDeg - dx * perPixel + 360) % 360;
      this.virtualPitchDeg = Math.max(
        -85,
        Math.min(85, this.virtualPitchDeg + dy * perPixel),
      );
      event.preventDefault();
    };
    const pointerUp = (event: PointerEvent): void => {
      if (this.pointerId === event.pointerId) {
        this.pointerId = null;
        this.lastPointer = null;
      }
    };
    this.canvas.addEventListener('pointerdown', pointerDown);
    this.canvas.addEventListener('pointermove', pointerMove);
    this.canvas.addEventListener('pointerup', pointerUp);
    this.canvas.addEventListener('pointercancel', pointerUp);

    this.screenOrientationHandler = () => {
      this.updateScreenAngle();
      this.snapNextFrame = true;
    };
    if (typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.addEventListener('change', this.screenOrientationHandler);
    }
    window.addEventListener('orientationchange', this.screenOrientationHandler);
    window.addEventListener('resize', this.screenOrientationHandler);
  }

  private screenOrientationHandler: () => void = () => undefined;

  private applyState(): void {
    const state = this.state;
    this.root.classList.toggle('ar-night', state.toggles.nightMode);
    if (state.utcMs !== null && document.activeElement !== this.timeInput) {
      const value = datetimeUtcValue(state.utcMs);
      if (this.timeInput.value !== value) this.timeInput.value = value;
    }
    for (const button of this.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.timeMode));
    }
    this.statusTime.textContent =
      this.timeMode === 'tonight' ? 'Tonight · real clock' : '2029 rehearsal · host clock';
    this.updateSensorStatus();
    this.updateCameraStatus();
    this.declinationForCurrentTime();
    this.renderMessages();
  }

  private debugEnabled(): boolean {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      return false;
    }
  }

  private updateScreenAngle(): void {
    this.screenAngleDeg = this.readScreenAngle();
  }

  private readScreenAngle(): number {
    let orientationAngle: number | null = null;
    try {
      const orientation = screen?.orientation;
      if (orientation && Number.isFinite(orientation.angle)) {
        orientationAngle = orientation.angle;
      }
    } catch {
      // fall through to the legacy property
    }
    const legacy = (window as Window & { orientation?: number }).orientation ?? null;
    return screenAngleFromSources(orientationAngle, legacy);
  }

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------

  private async startCamera(): Promise<void> {
    if (this.cameraState === 'starting' || this.cameraState === 'live') return;
    if (!window.isSecureContext) {
      this.setCameraState(
        'insecure',
        'Camera needs HTTPS (or localhost). The AR overlay will run on black.',
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setCameraState('unavailable', 'This browser has no camera API. AR overlay runs on black.');
      return;
    }
    this.setCameraState('starting', 'Requesting rear camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (!this.mounted) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stopCameraStream();
      this.stream = stream;
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch {
        // Autoplay can be blocked; the muted+playsinline attributes normally suffice.
      }
      this.setCameraState('live', 'Rear camera live.');
    } catch (error) {
      if (!this.mounted) return;
      const name = error instanceof DOMException ? error.name : '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      this.setCameraState(
        denied ? 'denied' : 'unavailable',
        denied
          ? 'Camera permission denied. The AR overlay is shown on black; sensors still drive it. Use Touch-drag in Rehearsal & fallback if sensors are unavailable.'
          : `Camera unavailable (${name || 'error'}). The AR overlay is shown on black; sensors still drive it. Use Touch-drag in Rehearsal & fallback if sensors are unavailable.`,
      );
    }
  }

  private stopCameraStream(): void {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }

  private stopCamera(): void {
    this.stopCameraStream();
    if (this.video) this.video.srcObject = null;
  }

  private setCameraState(state: CameraState, message: string): void {
    this.cameraState = state;
    this.cameraMessage = message;
    if (this.mounted) {
      this.updateCameraStatus();
      this.renderMessages();
    }
    this.pushHostStatus();
  }

  private updateCameraStatus(): void {
    if (!this.statusCamera) return;
    const labels: Record<CameraState, string> = {
      idle: 'Camera idle',
      starting: 'Camera starting…',
      live: 'Camera live',
      denied: 'Camera denied',
      unavailable: 'No camera',
      insecure: 'HTTPS needed',
    };
    this.statusCamera.textContent = labels[this.cameraState];
    this.statusCamera.dataset.state = this.cameraState;
    this.statusCamera.classList.toggle('ar-good', this.cameraState === 'live');
    this.statusCamera.classList.toggle(
      'ar-bad',
      this.cameraState === 'denied' ||
        this.cameraState === 'unavailable' ||
        this.cameraState === 'insecure',
    );
  }

  // ---------------------------------------------------------------------
  // Orientation
  // ---------------------------------------------------------------------

  private startOrientationListeners(): void {
    if (this.orientationListening) return;
    this.orientationListening = true;
    window.addEventListener('deviceorientationabsolute', this.onDeviceOrientationAbsolute as EventListener, true);
    window.addEventListener('deviceorientation', this.onDeviceOrientation as EventListener, true);
  }

  private orientationListening = false;

  private stopOrientationListeners(): void {
    if (!this.orientationListening) return;
    this.orientationListening = false;
    window.removeEventListener('deviceorientationabsolute', this.onDeviceOrientationAbsolute as EventListener, true);
    window.removeEventListener('deviceorientation', this.onDeviceOrientation as EventListener, true);
  }

  private onDeviceOrientationAbsolute = (event: Event): void => {
    this.consumeOrientation(event as DeviceOrientationLike, true);
  };

  private onDeviceOrientation = (event: Event): void => {
    this.consumeOrientation(event as DeviceOrientationLike, false);
  };

  private consumeOrientation(event: DeviceOrientationLike, absoluteEvent: boolean): void {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    if (![event.alpha, event.beta, event.gamma].every((v) => Number.isFinite(v))) return;
    const now = performance.now();
    const compassRaw = event.webkitCompassHeading;
    const accuracyRaw = event.webkitCompassAccuracy;
    const accuracy =
      typeof accuracyRaw === 'number' && Number.isFinite(accuracyRaw) ? accuracyRaw : null;
    const compassValid =
      typeof compassRaw === 'number' &&
      Number.isFinite(compassRaw) &&
      compassRaw >= 0 &&
      (accuracy === null || accuracy >= 0);
    const absolute = absoluteEvent || event.absolute === true || compassValid;
    if (!absolute && now - this.lastAbsoluteAt < 1200) return;
    if (absolute) this.lastAbsoluteAt = now;

    const sample: OrientationSample = {
      alphaDeg: ((event.alpha % 360) + 360) % 360,
      betaDeg: event.beta,
      gammaDeg: event.gamma,
      absolute,
      compassHeadingDeg: compassValid ? ((compassRaw as number) % 360 + 360) % 360 : null,
      compassAccuracyDeg: accuracy,
      source: compassValid ? 'compass' : absolute ? 'absolute' : 'relative',
      at: now,
    };
    // A real sensor sample means the denial is no longer current. Clear the
    // sticky denial cause and let the sensor path take over.
    if (this.sensorPermissionDenied) {
      this.sensorPermissionDenied = false;
      this.sensorDenialMessage = null;
      this.permissionRequested = true;
      if (this.touchMode) {
        this.touchMode = false;
        this.touchToggle.checked = false;
        this.root.classList.remove('ar-touch');
      }
    }
    this.latestSample = sample;
    this.updateSensorState();
  }

  private updateSensorState(): void {
    const previousState = this.sensorState;
    const previousMessage = this.sensorMessage;
    if (!this.latestSample) {
      if (this.sensorState === 'idle' || this.sensorState === 'requesting') {
        this.sensorMessage = 'Waiting for motion sensors…';
      }
    } else if (this.touchMode) {
      if (this.sensorState !== 'denied' && this.sensorState !== 'unavailable') {
        this.sensorMessage =
          'Touch-drag virtual AR. Sensor data is ignored while touch look is on.';
      }
    } else {
      const sample = this.latestSample;
      if (sample.compassAccuracyDeg !== null && sample.compassAccuracyDeg < 0) {
        this.sensorState = sample.absolute ? 'absolute' : 'relative';
        this.sensorMessage =
          'Compass accuracy is reported as unusable (negative). Absolute tilt may still work; align manually or use touch-drag.';
      } else if (sample.source === 'compass') {
        this.sensorState = 'compass';
        this.sensorMessage =
          sample.compassAccuracyDeg === null || sample.compassAccuracyDeg === 0
            ? 'Compass heading (accuracy not reported; 5–15° is typical).'
            : `Compass heading, device reports ±${sample.compassAccuracyDeg.toFixed(1)}°.`;
      } else if (sample.source === 'absolute') {
        this.sensorState = 'absolute';
        this.sensorMessage =
          'Absolute orientation (magnetic north assumed). Declination is applied from WMM2025.';
      } else {
        this.sensorState = 'relative';
        this.sensorMessage =
          'Relative orientation only: alpha has an arbitrary zero. Align on a known object to set north, or use touch-drag.';
      }
    }
    const accuracyBucket =
      this.latestSample?.compassAccuracyDeg === null ||
      this.latestSample?.compassAccuracyDeg === undefined
        ? 'na'
        : this.latestSample.compassAccuracyDeg.toFixed(1);
    const signature = [
      this.touchMode,
      this.sensorState,
      this.sensorMessage,
      accuracyBucket,
      previousState === this.sensorState ? '' : previousState,
      previousMessage === this.sensorMessage ? '' : 'msg',
    ].join('|');
    if (signature === this.sensorUiSignature) return;
    this.sensorUiSignature = signature;
    if (this.mounted) {
      this.updateSensorStatus();
      this.renderMessages();
      this.renderCalibrationUi();
      this.pushHostStatus();
    }
  }

  private updateSensorStatus(): void {
    if (!this.statusSensor) return;
    const labels: Record<SensorState, string> = {
      idle: 'Sensors idle',
      requesting: 'Sensors…',
      compass: 'Compass',
      absolute: 'Absolute',
      relative: 'Relative only',
      denied: 'Sensors denied',
      unavailable: 'No sensors',
    };
    this.statusSensor.textContent = this.touchMode
      ? this.sensorState === 'denied'
        ? 'Sensors denied · touch'
        : this.sensorState === 'unavailable'
          ? 'No sensors · touch'
          : 'Touch look'
      : labels[this.sensorState];
    this.statusSensor.dataset.state =
      this.touchMode && this.sensorState !== 'denied' && this.sensorState !== 'unavailable'
        ? 'touch'
        : this.sensorState;
    this.statusSensor.classList.toggle(
      'ar-good',
      !this.touchMode && (this.sensorState === 'compass' || this.sensorState === 'absolute'),
    );
    this.statusSensor.classList.toggle(
      'ar-bad',
      this.sensorState === 'denied' ||
        this.sensorState === 'unavailable' ||
        this.sensorState === 'relative',
    );
    if (this.enableSensorsTopButton) {
      this.enableSensorsTopButton.hidden =
        !this.touchMode && (this.sensorState === 'compass' || this.sensorState === 'absolute');
    }
  }

  private maybeShowPermissionUi(): void {
    const ctor = (
      window as Window & {
        DeviceOrientationEvent?: { requestPermission?: (opts?: unknown) => Promise<string> };
      }
    ).DeviceOrientationEvent;
    if (typeof ctor?.requestPermission !== 'function') {
      this.requestSensorsFromGesture(true);
      return;
    }
    if (this.sensorPermissionDenied) {
      this.sensorState = 'denied';
      this.sensorMessage =
        this.sensorDenialMessage ??
        'Sensor permission denied. Use touch-drag virtual AR, or allow Motion & Orientation in settings and reload.';
      this.touchMode = true;
      this.touchToggle.checked = true;
      this.root.classList.add('ar-touch');
      this.updateSensorState();
      this.updateSensorStatus();
      this.renderMessages();
      return;
    }
    this.sensorState = 'idle';
    this.sensorMessage =
      'iOS requires a tap to allow compass/motion. Tap “Enable compass / motion”.';
    this.updateSensorStatus();
    this.renderMessages();
  }

  private async requestSensorsFromGesture(fromMount = false): Promise<void> {
    if (this.permissionRequested && !this.sensorPermissionDenied) {
      this.startOrientationListeners();
      return;
    }
    if (this.sensorPermissionDenied) {
      // Explicit retry: clear the sticky denial and put the user back on the
      // sensor path. If permission is denied again, the cause is restored.
      this.sensorPermissionDenied = false;
      this.sensorDenialMessage = null;
      this.permissionRequested = false;
      this.touchMode = false;
      this.touchToggle.checked = false;
      this.root.classList.remove('ar-touch');
    }
    this.permissionRequested = true;
    this.sensorState = 'requesting';
    this.sensorMessage = 'Requesting motion sensor permission…';
    this.updateSensorStatus();
    this.renderMessages();
    const ctor = (
      window as Window & {
        DeviceOrientationEvent?: {
          requestPermission?: (opts?: unknown) => Promise<string>;
        };
      }
    ).DeviceOrientationEvent;
    const request = ctor?.requestPermission;
    if (typeof request !== 'function') {
      this.startOrientationListeners();
      this.sensorMessage = 'Motion sensor permission is not required on this browser.';
      this.updateSensorStatus();
      this.renderMessages();
      return;
    }
    try {
      // Safari accepts no argument; newer builds may request the magnetometer
      // with `true`. Try that first and fall back for compatibility.
      let result: string;
      try {
        result = await request.call(ctor, true);
      } catch {
        result = await request.call(ctor);
      }
      if (result === 'granted') {
        this.sensorPermissionDenied = false;
        this.sensorDenialMessage = null;
        this.startOrientationListeners();
        this.sensorMessage =
          'Sensor permission granted. Move the phone in a figure-eight if the compass drifts.';
        window.setTimeout(() => this.checkSensorWatchdog(), 2200);
      } else {
        this.sensorState = 'denied';
        this.sensorMessage =
          'Sensor permission denied. Use touch-drag virtual AR, or allow Motion & Orientation in Safari settings and reload.';
        this.sensorPermissionDenied = true;
        this.sensorDenialMessage = this.sensorMessage;
        this.touchMode = true;
        this.touchToggle.checked = true;
        this.root.classList.add('ar-touch');
      }
    } catch (error) {
      this.sensorState = 'denied';
      this.sensorMessage = `Sensor permission failed: ${
        error instanceof Error ? error.message : String(error)
      }. Use touch-drag virtual AR.`;
      this.sensorPermissionDenied = true;
      this.sensorDenialMessage = this.sensorMessage;
      this.touchMode = true;
      this.touchToggle.checked = true;
      this.root.classList.add('ar-touch');
    }
    if (!this.mounted) return;
    this.updateSensorState();
    this.updateSensorStatus();
    this.renderMessages();
    if (fromMount) this.checkSensorWatchdog();
  }

  private checkSensorWatchdog(): void {
    if (!this.mounted) return;
    if (this.latestSample) return;
    if (this.sensorPermissionDenied || this.sensorState === 'denied') {
      // Preserve the denial reason instead of replacing it with the generic
      // "no sensor data" text.
      this.sensorState = 'denied';
      if (this.sensorDenialMessage) this.sensorMessage = this.sensorDenialMessage;
      this.touchMode = true;
      this.touchToggle.checked = true;
      this.root.classList.add('ar-touch');
      this.updateSensorState();
      this.updateSensorStatus();
      this.renderMessages();
      return;
    }
    if (this.sensorState === 'requesting') {
      this.sensorWatchdog = window.setTimeout(() => this.checkSensorWatchdog(), 2000);
      return;
    }
    const ctor = (
      window as Window & {
        DeviceOrientationEvent?: { requestPermission?: (opts?: unknown) => Promise<string> };
      }
    ).DeviceOrientationEvent;
    if (typeof ctor?.requestPermission === 'function' && !this.permissionRequested) {
      // iOS: do not switch to touch mode before the user has had a chance to
      // grant motion access from a gesture.
      this.sensorState = 'idle';
      this.sensorMessage =
        'Tap “Enable compass / motion” to allow iOS motion access, or use touch-drag virtual AR.';
      this.updateSensorStatus();
      this.renderMessages();
      return;
    }
    this.sensorState = 'unavailable';
    this.sensorMessage =
      'No motion sensor data arrived. Touch-drag virtual AR is enabled; the overlay still shows the sky at the host time.';
    this.touchMode = true;
    this.touchToggle.checked = true;
    this.root.classList.add('ar-touch');
    this.updateSensorState();
    this.updateSensorStatus();
    this.renderMessages();
  }

  private quatForSample(sample: OrientationSample): Quat {
    let q = quatFromDeviceOrientation(
      sample.alphaDeg,
      sample.betaDeg,
      sample.gammaDeg,
      this.screenAngleDeg,
    );
    const declination = this.declinationForCurrentTime();
    const decl = declination?.declinationDeg ?? 0;
    if (sample.compassHeadingDeg !== null) {
      q = quatAimAtHeading(q, sample.compassHeadingDeg + decl);
    } else if (sample.absolute) {
      q = quatAddHeading(q, decl);
    }
    return q;
  }

  private measuredQuat(): Quat | null {
    if (this.touchMode) {
      return quatFromVirtualLook(this.virtualHeadingDeg, this.virtualPitchDeg);
    }
    const sample = this.latestSample;
    if (!sample) return null;
    return this.quatForSample(sample);
  }

  private resolveViewQuat(dtSeconds: number): Quat | null {
    const measured = this.measuredQuat();
    if (!measured) {
      this.displayQuat = null;
      this.measuredHeadingDeg = null;
      this.displayHeadingDeg = null;
      this.displayPitchDeg = null;
      return null;
    }
    this.measuredHeadingDeg = headingFromQuat(measured);
    const target = quatAddHeading(measured, this.calibration.headingOffsetDeg);
    if (!this.displayQuat || this.snapNextFrame) {
      this.displayQuat = target;
    } else {
      const angle = quatAngleBetween(this.displayQuat, target);
      if (angle > 55) {
        this.displayQuat = target;
      } else {
        const factor = 1 - Math.exp(-Math.max(0.001, dtSeconds) / 0.09);
        this.displayQuat = quatSlerp(this.displayQuat, target, factor);
      }
    }
    this.snapNextFrame = false;
    this.displayHeadingDeg = headingFromQuat(this.displayQuat);
    this.displayPitchDeg = pitchFromQuat(this.displayQuat);
    return this.displayQuat;
  }

  // ---------------------------------------------------------------------
  // Declination & targets
  // ---------------------------------------------------------------------

  private currentObserver(): ObserverLocation | null {
    const session = this.api.getSession();
    if (session) return session.observer;
    if (!this.state.observer) return null;
    return toObserverLocation(this.state.observer);
  }

  private currentUtcMs(): number | null {
    if (this.timeMode === 'tonight') return Date.now();
    return this.state.utcMs;
  }

  private declinationForCurrentTime(): DeclinationResult | null {
    const observer = this.currentObserver();
    const ms = this.currentUtcMs();
    if (!observer || ms === null) {
      this.declination = null;
      return null;
    }
    // Recompute on a 10-minute bucket, not a UTC day: the WMM package
    // window starts/ends at 03:00 UTC mid-day (2024-11-13 / 2029-11-13), so
    // a day-granular key leaves the status/warning stale across the boundary.
    const bucket = Math.floor(ms / 600_000);
    const key = `${observerKey(observer)}|${bucket}`;
    if (key !== this.declinationKey) {
      this.declinationKey = key;
      this.declination = computeDeclination(observer, new Date(ms));
    }
    return this.declination;
  }

  private getSnapshot(): ArSkySnapshot | null {
    const ms = this.currentUtcMs();
    const observer = this.currentObserver();
    if (ms === null || !observer) return null;
    const session = this.api.getSession();
    const catalogue = this.api.getCatalogue();
    const mode = this.timeMode;
    const refraction = this.state.toggles.refraction;
    const roundedMs = mode === 'tonight' ? Math.floor(ms / 1000) * 1000 : ms;
    const key = [
      mode,
      Math.floor(roundedMs / 2000),
      observerKey(observer),
      refraction ? 'r' : 'a',
      this.state.timeZone,
      session ? 's' : 'n',
      catalogue ? 'c' : 'n',
    ].join('|');
    if (this.snapshot && key === this.snapshotKey) return this.snapshot;
    const nowReal = performance.now();
    // During playback the simulated clock can advance 600× faster than real
    // time. Do not rebuild a thousand-star catalogue every animation frame.
    if (
      this.snapshot &&
      this.state.playing &&
      nowReal - this.lastSnapshotAt < 250
    ) {
      return this.snapshot;
    }
    this.declinationForCurrentTime();
    const declSignature = [
      this.declination?.status ?? 'none',
      this.declination?.declinationDeg?.toFixed(3) ?? 'na',
      this.declination?.warning ?? '',
    ].join('|');
    if (declSignature !== this.lastDeclinationSignature) {
      this.lastDeclinationSignature = declSignature;
      if (this.mounted) this.renderMessages();
    }
    const inSessionWindow = Boolean(
      session &&
        roundedMs >= session.windowStartMs &&
        roundedMs <= session.windowEndMs,
    );

    const trailKey = [
      mode,
      Math.floor(roundedMs / 30_000),
      observerKey(observer),
      refraction ? 'r' : 'a',
    ].join('|');
    if (trailKey !== this.trailCache.key) {
      const canRebuildTrail =
        !this.state.playing || nowReal - this.lastTrailAt > 750;
      if (canRebuildTrail) {
        this.trailCache = {
          key: trailKey,
          points:
            mode === 'rehearsal' && inSessionWindow
              ? buildArTrail(session, roundedMs, refraction, this.state.timeZone, 2)
              : [],
        };
        this.lastTrailAt = nowReal;
      }
    }
    this.snapshotKey = key;
    this.lastSnapshotAt = nowReal;
    this.snapshot = buildSkySnapshot({
      session,
      catalogue,
      observer,
      utcMs: roundedMs,
      mode,
      refraction,
      timeZone: this.state.timeZone,
      trail: this.trailCache.points,
    });
    this.refreshAlignTargets();
    return this.snapshot;
  }

  // ---------------------------------------------------------------------
  // Calibration UI
  // ---------------------------------------------------------------------

  private renderCalibrationUi(): void {
    if (!this.offsetInput) return;
    this.offsetInput.value = String(
      Math.max(-180, Math.min(180, this.calibration.headingOffsetDeg)),
    );
    this.offsetValue.textContent = `${this.calibration.headingOffsetDeg >= 0 ? '+' : ''}${this.calibration.headingOffsetDeg.toFixed(1)}°`;
    this.fovInput.value = String(this.calibration.horizontalFovDeg);
    this.fovValue.textContent = `${this.calibration.horizontalFovDeg.toFixed(1)}°`;
    const estimate = estimatePointingError(
      this.calibration,
      this.latestSample?.compassAccuracyDeg ?? null,
    );
    this.errorEl.textContent = `${estimate.label}. ${estimate.detail}`;
    this.statusAccuracy.textContent =
      this.latestSample?.source === 'compass'
        ? `±${estimate.totalDeg.toFixed(estimate.totalDeg < 10 ? 1 : 0)}° est.`
        : this.touchMode
          ? 'Touch alignment'
          : `±${estimate.totalDeg.toFixed(estimate.totalDeg < 10 ? 1 : 0)}° est.`;
    this.statusAccuracy.title = estimate.detail;
    this.twoPointButton.textContent = this.twoPointFirst
      ? 'Two-point heading: mark B & apply'
      : 'Two-point heading: mark A';
    this.updateFovStatus();
  }

  private refreshAlignTargets(): void {
    if (!this.snapshot) return;
    const targets = this.snapshot.alignTargets;
    const signature = targets.map((t) => `${t.id}:${t.name}`).join('|');
    if (signature === this.lastAlignSignature) return;
    this.lastAlignSignature = signature;
    const previous = this.selectedAlignId;
    if (!targets.some((t) => t.id === previous)) {
      this.selectedAlignId = targets[0]?.id ?? '';
    }
    this.alignSelect.innerHTML = this.targetOptions(targets, this.selectedAlignId);
    this.alignSelect.disabled = targets.length === 0;
    this.alignButton.disabled = targets.length === 0;

    const currentA = this.fovTargetASelect.value;
    const currentB = this.fovTargetBSelect.value;
    const defaultA = targets[0]?.id ?? '';
    const defaultB = targets[1]?.id ?? defaultA;
    const fovA = targets.some((t) => t.id === currentA) ? currentA : defaultA;
    const fovB =
      targets.some((t) => t.id === currentB) && currentB !== fovA
        ? currentB
        : defaultB !== fovA
          ? defaultB
          : targets[0]?.id ?? '';
    this.fovTargetASelect.innerHTML = this.targetOptions(targets, fovA);
    this.fovTargetBSelect.innerHTML = this.targetOptions(targets, fovB);
    this.fovTargetASelect.disabled = targets.length === 0;
    this.fovTargetBSelect.disabled = targets.length < 2;
    this.fovTapAButton.disabled = targets.length === 0;
    this.fovTapBButton.disabled = targets.length < 2;
    this.updateFovStatus();
  }

  private targetOptions(targets: SkyTarget[], selectedId: string): string {
    return targets.length
      ? targets
          .map(
            (t) =>
              `<option value="${escapeHtml(t.id)}"${t.id === selectedId ? ' selected' : ''}>${escapeHtml(t.name)} · ${t.elevationDeg.toFixed(0)}°</option>`,
          )
          .join('')
      : '<option value="">No named target above the horizon</option>';
  }

  private selectedTarget(): SkyTarget | null {
    if (!this.snapshot) return null;
    return this.snapshot.alignTargets.find((t) => t.id === this.selectedAlignId) ?? null;
  }

  private selectedFovTarget(slot: 'A' | 'B'): SkyTarget | null {
    if (!this.snapshot) return null;
    const id = slot === 'A' ? this.fovTargetASelect.value : this.fovTargetBSelect.value;
    return this.snapshot.alignTargets.find((t) => t.id === id) ?? null;
  }

  private armFovTap(slot: 'A' | 'B'): void {
    const target = this.selectedFovTarget(slot);
    if (!target) {
      this.setLocalMessage('Choose a named target above the horizon first.');
      return;
    }
    if (!this.displayQuat) {
      this.setLocalMessage('No orientation yet. Enable the compass or use touch look first.');
      return;
    }
    const projected = projectAzEl(
      target.azimuthDeg,
      target.elevationDeg,
      this.displayQuat,
      this.projection,
      0,
    );
    if (!projected.inFront || !projected.visible) {
      this.setLocalMessage(
        projected.inFront
          ? `${target.name} is outside the current camera view. Point the phone towards it before tapping.`
          : `${target.name} is behind the camera. Point the phone towards it before tapping.`,
      );
      return;
    }
    this.fovTapArmed = slot;
    this.fovArmedTarget = target;
    for (const detail of this.root.querySelectorAll<HTMLDetailsElement>('details')) {
      detail.open = false;
    }
    this.tapPrompt.textContent = `Tap ${target.name} in the camera image`;
    this.tapCapture.hidden = false;
    this.updateFovStatus();
  }

  private cancelFovTap(): void {
    this.fovTapArmed = null;
    this.fovArmedTarget = null;
    if (this.tapCapture) this.tapCapture.hidden = true;
    this.updateFovStatus();
  }

  private onTapCaptureClick = (event: MouseEvent): void => {
    const element = event.target as HTMLElement;
    if (element.closest('[data-role="tap-cancel"]')) {
      event.preventDefault();
      event.stopPropagation();
      this.cancelFovTap();
      return;
    }
    if (!this.fovTapArmed || !this.fovArmedTarget) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      this.setLocalMessage('Tap inside the camera image.');
      return;
    }
    const mark: FovTapMark = {
      x,
      y,
      targetId: this.fovArmedTarget.id,
      targetName: this.fovArmedTarget.name,
      azimuthDeg: this.fovArmedTarget.azimuthDeg,
      elevationDeg: this.fovArmedTarget.elevationDeg,
      atMs: this.currentUtcMs() ?? Date.now(),
    };
    if (this.fovTapArmed === 'A') this.fovTapA = mark;
    else this.fovTapB = mark;
    this.fovTapArmed = null;
    this.fovArmedTarget = null;
    this.tapCapture.hidden = true;
    event.preventDefault();
    event.stopPropagation();
    if (this.fovTapA && this.fovTapB) this.computeFovFromTaps();
    else this.updateFovStatus();
  };

  private resetFovTaps(): void {
    this.fovTapA = null;
    this.fovTapB = null;
    this.fovTapArmed = null;
    this.fovArmedTarget = null;
    if (this.tapCapture) this.tapCapture.hidden = true;
  }

  private updateFovStatus(): void {
    if (!this.fovStatusEl) return;
    if (this.fovTapArmed && this.fovArmedTarget) {
      this.fovStatusEl.textContent = `Tap ${this.fovArmedTarget.name} in the image (${this.fovTapArmed}).`;
      this.fovTapAButton.textContent = this.fovTapArmed === 'A' ? 'Tap A on image…' : 'Tap A';
      this.fovTapBButton.textContent = this.fovTapArmed === 'B' ? 'Tap B on image…' : 'Tap B';
      return;
    }
    this.fovTapAButton.textContent = this.fovTapA ? 'Tap A again' : 'Tap A';
    this.fovTapBButton.textContent = this.fovTapB ? 'Tap B again' : 'Tap B';
    if (this.calibration.twoPointFov) {
      const f = this.calibration.twoPointFov;
      this.fovStatusEl.textContent = `Solved FOV ${f.horizontalFovDeg.toFixed(1)}° from ${f.targetAName}–${f.targetBName} (${f.separationDeg.toFixed(1)}° apart), tap residual ${f.residualPx.toFixed(1)} px / ${f.residualDeg.toFixed(1)}°.`;
    } else if (this.fovTapA && !this.fovTapB) {
      this.fovStatusEl.textContent = `${this.fovTapA.targetName} marked. Choose target B and tap it in the image.`;
    } else if (!this.fovTapA && this.fovTapB) {
      this.fovStatusEl.textContent = `${this.fovTapB.targetName} marked. Choose target A and tap it in the image.`;
    } else {
      this.fovStatusEl.textContent =
        'FOV from two taps: choose two objects at least 5° apart, then tap each in the camera image.';
    }
  }

  private computeFovFromTaps(): void {
    const a = this.fovTapA;
    const b = this.fovTapB;
    if (!a || !b) return;
    if (a.targetId === b.targetId) {
      this.setLocalMessage('Choose two different targets for FOV calibration.');
      this.resetFovTaps();
      this.updateFovStatus();
      return;
    }
    const separationDeg = angularSeparationDeg(
      a.azimuthDeg,
      a.elevationDeg,
      b.azimuthDeg,
      b.elevationDeg,
    );
    const solution = solveFovFromAngularSeparation(
      this.projection.width,
      this.projection.height,
      a,
      b,
      separationDeg,
    );
    if (!solution.ok) {
      this.setLocalMessage(`FOV calibration failed: ${solution.error}`);
      this.resetFovTaps();
      this.updateFovStatus();
      return;
    }

    let residualPx = 0;
    let residualDeg = 0;
    if (this.displayQuat) {
      const solvedProjection = createProjection(
        this.projection.width,
        this.projection.height,
        solution.horizontalFovDeg,
      );
      const pa = projectAzEl(a.azimuthDeg, a.elevationDeg, this.displayQuat, solvedProjection, 1e6);
      const pb = projectAzEl(b.azimuthDeg, b.elevationDeg, this.displayQuat, solvedProjection, 1e6);
      if (pa.inFront && pb.inFront) {
        residualPx = Math.sqrt(
          ((pa.x - a.x) ** 2 +
            (pa.y - a.y) ** 2 +
            (pb.x - b.x) ** 2 +
            (pb.y - b.y) ** 2) /
            2,
        );
        residualDeg = Math.atan(residualPx / solution.focalPx) * (180 / Math.PI);
      }
    }

    const result: FovCalibration = {
      horizontalFovDeg: solution.horizontalFovDeg,
      separationDeg,
      residualPx,
      residualDeg,
      targetAId: a.targetId,
      targetAName: a.targetName,
      targetBId: b.targetId,
      targetBName: b.targetName,
      atMs: Math.max(a.atMs, b.atMs),
    };
    this.calibration = recordFovCalibration(this.calibration, result);
    this.resetFovTaps();
    this.persistCalibration();
    this.renderCalibrationUi();
    this.updateFovStatus();
    this.setLocalMessage(
      `FOV calibrated to ${result.horizontalFovDeg.toFixed(1)}° from ${result.targetAName}–${result.targetBName}; tap residual ${result.residualPx.toFixed(1)} px (${result.residualDeg.toFixed(1)}°).`,
    );
  }

  private alignOnSelectedTarget(): void {
    const target = this.selectedTarget();
    if (!target) {
      this.setLocalMessage('No calibration target above the horizon right now.');
      return;
    }
    const measured = this.measuredHeadingDeg;
    if (measured === null) {
      this.setLocalMessage('No orientation yet. Enable the compass or switch to touch look.');
      return;
    }
    this.calibration = recordAlignment(this.calibration, {
      targetId: target.id,
      targetName: target.name,
      targetAzDeg: target.azimuthDeg,
      measuredHeadingDeg: measured,
      atMs: this.currentUtcMs() ?? Date.now(),
    });
    this.twoPointFirst = null;
    this.persistCalibration();
    this.renderCalibrationUi();
    this.setLocalMessage(
      `Aligned on ${target.name}: heading offset ${this.calibration.headingOffsetDeg >= 0 ? '+' : ''}${this.calibration.headingOffsetDeg.toFixed(1)}°.`,
    );
  }

  private markTwoPoint(): void {
    const target = this.selectedTarget();
    const measured = this.measuredHeadingDeg;
    if (!target || measured === null) {
      this.setLocalMessage('Choose a target above the horizon and get an orientation first.');
      return;
    }
    const input: CalibrationInput = {
      targetId: target.id,
      targetName: target.name,
      targetAzDeg: target.azimuthDeg,
      measuredHeadingDeg: measured,
      atMs: this.currentUtcMs() ?? Date.now(),
    };
    if (!this.twoPointFirst) {
      this.twoPointFirst = input;
      this.renderCalibrationUi();
      this.setLocalMessage(
        `Two-point: ${target.name} marked. Now point at a second known object, choose it, and tap again.`,
      );
      return;
    }
    if (this.twoPointFirst.targetId === input.targetId) {
      this.setLocalMessage('Choose a different second target for two-point calibration.');
      return;
    }
    this.calibration = recordTwoPointAlignment(this.calibration, this.twoPointFirst, input);
    this.twoPointFirst = null;
    this.persistCalibration();
    this.renderCalibrationUi();
    const residual = this.calibration.twoPointResidualDeg ?? 0;
    this.setLocalMessage(
      `Two-point heading calibration applied: offset ${this.calibration.headingOffsetDeg.toFixed(1)}°, disagreement ±${residual.toFixed(1)}°.`,
    );
  }

  private resetCalibration(): void {
    this.calibration = defaultCalibration();
    this.twoPointFirst = null;
    this.resetFovTaps();
    try {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    } catch {
      // ignore blocked storage
    }
    this.renderCalibrationUi();
    this.setLocalMessage('Calibration reset: offset 0°, FOV 60°.');
  }

  private changeOffset(delta: number): void {
    this.calibration = nudgeHeadingOffset(this.calibration, delta);
    this.persistCalibration();
    this.renderCalibrationUi();
  }

  private persistCalibration(): void {
    const ok = saveCalibration(this.calibration);
    if (!ok) this.setLocalMessage('Calibration could not be saved (storage blocked).');
  }

  // ---------------------------------------------------------------------
  // Time & status
  // ---------------------------------------------------------------------

  private setTimeMode(mode: ArTimeMode): void {
    if (mode === this.timeMode) return;
    this.timeMode = mode;
    this.twoPointFirst = null;
    this.resetFovTaps();
    this.snapshotKey = '';
    this.trailCache.key = '';
    for (const button of this.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    this.statusTime.textContent =
      mode === 'tonight' ? 'Tonight · real clock' : '2029 rehearsal · host clock';
    if (mode === 'rehearsal' && this.state.utcMs !== null) {
      this.timeInput.value = datetimeUtcValue(this.state.utcMs);
    }
    this.renderMessages();
  }

  private applyTimeInput(): void {
    const raw = this.timeInput.value.trim();
    if (!raw) {
      this.setLocalMessage('Enter a UTC date and time first.');
      return;
    }
    const ms = Date.parse(`${raw}Z`);
    if (!Number.isFinite(ms)) {
      this.setLocalMessage('Invalid UTC date/time.');
      return;
    }
    this.timeMode = 'rehearsal';
    this.twoPointFirst = null;
    this.resetFovTaps();
    for (const button of this.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === 'rehearsal'));
    }
    this.statusTime.textContent = '2029 rehearsal · host clock';
    this.api.setTimeUtcMs(ms);
    this.snapshotKey = '';
    this.trailCache.key = '';
  }

  private jumpTo(kind: 'topocentricCa' | 'visibilityStart' | 'rise'): void {
    const session = this.api.getSession();
    if (!session) {
      this.setLocalMessage('No simulation session yet.');
      return;
    }
    const ms = session.jumpTarget(kind);
    if (ms === null) {
      this.setLocalMessage(`No ${kind} available for this observer.`);
      return;
    }
    this.timeMode = 'rehearsal';
    this.twoPointFirst = null;
    this.resetFovTaps();
    for (const button of this.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === 'rehearsal'));
    }
    this.statusTime.textContent = '2029 rehearsal · host clock';
    this.api.setTimeUtcMs(ms);
    this.snapshotKey = '';
    this.trailCache.key = '';
  }

  private async requestFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await this.root.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      this.setLocalMessage('Fullscreen is unavailable in this browser.');
    }
  }

  private setLocalMessage(message: string): void {
    this.localMessage = message;
    if (this.localMessageTimer !== null) window.clearTimeout(this.localMessageTimer);
    this.localMessageTimer = window.setTimeout(() => {
      this.localMessage = '';
      this.localMessageTimer = null;
      this.renderMessages();
    }, 10_000);
    this.renderMessages();
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    const messages: { text: string; tone: 'warn' | 'bad' | 'info' }[] = [];
    if (!window.isSecureContext) {
      messages.push({
        text: 'Camera and motion sensors need HTTPS. Use localhost or a trusted LAN certificate.',
        tone: 'bad',
      });
    }
    if (this.cameraState === 'denied' || this.cameraState === 'unavailable' || this.cameraState === 'insecure') {
      messages.push({ text: this.cameraMessage, tone: 'warn' });
    }
    if (this.sensorState === 'denied' || this.sensorState === 'unavailable') {
      messages.push({ text: this.sensorMessage, tone: 'warn' });
    } else if (this.sensorState === 'relative' && !this.touchMode) {
      messages.push({ text: this.sensorMessage, tone: 'warn' });
    }
    if (this.declination?.warning) {
      messages.push({ text: this.declination.warning, tone: 'warn' });
    }
    if (!this.currentObserver()) {
      messages.push({ text: 'Waiting for the host to supply an observer location.', tone: 'info' });
    }
    if (this.state.utcMs === null && this.timeMode === 'rehearsal') {
      messages.push({ text: 'Waiting for the host clock.', tone: 'info' });
    }
    if (this.localMessage) messages.push({ text: this.localMessage, tone: 'info' });
    this.messagesEl.innerHTML = messages
      .map((m) => `<div class="ar-message ar-${m.tone}">${escapeHtml(m.text)}</div>`)
      .join('');
  }

  private pushHostStatus(): void {
    if (!this.mounted) return;
    const status =
      this.cameraState === 'live'
        ? `${this.sensorMessage}`
        : `${this.cameraMessage} ${this.sensorMessage}`;
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    this.api.setStatus(status);
  }

  // ---------------------------------------------------------------------
  // Frame rendering
  // ---------------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.mounted) return;
    const dt = this.lastFrame === 0 ? 0.016 : Math.min(0.2, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.resizeCanvas();
    const orientation = this.resolveViewQuat(dt);
    const snapshot = this.getSnapshot();
    if (orientation && snapshot) {
      this.drawScene(orientation, snapshot);
    } else {
      this.drawWaiting();
    }
    if (now - this.lastReadingUpdate > 120) {
      this.lastReadingUpdate = now;
      this.updateReading(snapshot);
    }
    if (this.debugEnabled() && now - this.lastDebugUpdate > 100) {
      this.lastDebugUpdate = now;
      this.updateDebug(snapshot, orientation);
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  private resizeCanvas(): void {
    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const cssWidth = `${width}px`;
    const cssHeight = `${height}px`;
    if (this.canvas.style.width !== cssWidth) this.canvas.style.width = cssWidth;
    if (this.canvas.style.height !== cssHeight) this.canvas.style.height = cssHeight;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.projection = createProjection(width, height, this.calibration.horizontalFovDeg);
  }

  private palette(): Palette {
    return this.state.toggles.nightMode ? NIGHT_PALETTE : DAY_PALETTE;
  }

  private drawWaiting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = this.projection;
    ctx.clearRect(0, 0, width, height);
    const pal = this.palette();
    ctx.fillStyle = pal.muted;
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.currentObserver() ? 'Waiting for orientation…' : 'Waiting for observer location…',
      width / 2,
      height / 2 + 32,
    );
    ctx.textAlign = 'left';
  }

  private drawScene(orientation: Quat, snapshot: ArSkySnapshot): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pal = this.palette();
    const { width, height } = this.projection;
    ctx.clearRect(0, 0, width, height);

    this.drawHorizon(orientation, pal);
    this.drawTrail(snapshot.trail, orientation, pal);
    this.drawStars(snapshot.stars, orientation, pal);
    this.drawTargets(snapshot, orientation, pal);
    this.lastApophisPoint = snapshot.apophis
      ? projectAzEl(
          snapshot.apophis.azimuthDeg,
          snapshot.apophis.elevationDeg,
          orientation,
          this.projection,
          20,
        )
      : null;
    this.selectedPoint = this.selectedTarget()
      ? projectAzEl(
          this.selectedTarget()!.azimuthDeg,
          this.selectedTarget()!.elevationDeg,
          orientation,
          this.projection,
          20,
        )
      : null;
    this.drawReticle(orientation, pal);
  }

  private drawHorizon(orientation: Quat, pal: Palette): void {
    const ctx = this.ctx!;
    const samples = sampleHorizon(orientation, this.projection, 2);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.horizon;
    ctx.shadowColor = pal.horizonGlow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    let drawing = false;
    for (const sample of samples) {
      const point = sample.point;
      if (!point.inFront) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        ctx.moveTo(point.x, point.y);
        drawing = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 15° azimuth ticks along the horizon.
    ctx.lineWidth = 1;
    for (let az = 0; az < 360; az += 15) {
      const point = projectAzEl(az, 0, orientation, this.projection, 16);
      if (!point.visible) continue;
      const cardinal = az % 90 === 0;
      ctx.globalAlpha = cardinal ? 0.9 : 0.35;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - (cardinal ? 7 : 4));
      ctx.lineTo(point.x, point.y + (cardinal ? 2 : 1));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const cardinal of CARDINALS) {
      const point = projectAzEl(cardinal.azimuthDeg, 0, orientation, this.projection, 30);
      if (!point.visible || point.y < 0 || point.y > this.projection.height + 20) continue;
      this.drawLabel(cardinal.label, point.x, point.y - 16, pal.cardinal, pal, 'center', 13, true);
    }
    ctx.restore();
  }

  private drawTrail(
    trail: ArTrailPoint[],
    orientation: Quat,
    pal: Palette,
  ): void {
    if (trail.length === 0) return;
    const ctx = this.ctx!;
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = pal.trail;
    ctx.shadowColor = pal.trail;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    let drawing = false;
    for (const point of trail) {
      if (!point.aboveHorizon) {
        drawing = false;
        continue;
      }
      const p = projectAzEl(point.azimuthDeg, point.elevationDeg, orientation, this.projection, 80);
      if (!p.inFront) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        ctx.moveTo(p.x, p.y);
        drawing = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (const point of trail) {
      if (!point.aboveHorizon || !point.tick) continue;
      const p = projectAzEl(point.azimuthDeg, point.elevationDeg, orientation, this.projection, 60);
      if (!p.visible) continue;
      ctx.strokeStyle = pal.tick;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
      if (point.label) {
        this.drawLabel(point.label, p.x, p.y + 14, pal.tick, pal, 'center', 10.5, true);
      }
    }
    ctx.restore();
  }

  private drawStars(stars: SkyTarget[], orientation: Quat, pal: Palette): void {
    const ctx = this.ctx!;
    ctx.save();
    let labelled = 0;
    for (const star of stars) {
      if (star.elevationDeg < 0) continue;
      const p = projectAzEl(star.azimuthDeg, star.elevationDeg, orientation, this.projection, 8);
      if (!p.visible) continue;
      const radius = Math.max(1, star.radiusPx * 0.7);
      ctx.globalAlpha = Math.max(0.35, Math.min(1, 1 - (star.magnitude ?? 3) / 5));
      ctx.fillStyle = pal.star;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (
        star.name &&
        star.magnitude !== null &&
        star.magnitude <= STAR_LABEL_MAG &&
        labelled < 12 &&
        p.x > 12 &&
        p.x < this.projection.width - 12
      ) {
        labelled++;
        this.drawLabel(star.name, p.x + 6, p.y - 5, pal.starLabel, pal, 'left', 10, false);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawTargets(snapshot: ArSkySnapshot, orientation: Quat, pal: Palette): void {
    const ctx = this.ctx!;
    const selectedId = this.selectedAlignId;
    for (const target of snapshot.targets) {
      if (target.elevationDeg < -1) continue;
      const p = projectAzEl(target.azimuthDeg, target.elevationDeg, orientation, this.projection, 40);
      if (!p.visible) continue;
      const colour =
        target.kind === 'sun'
          ? pal.sun
          : target.kind === 'moon'
            ? pal.moon
            : target.kind === 'apophis'
              ? pal.apophis
              : pal.planet;
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = target.kind === 'apophis' ? 2 : 1.6;
      if (target.kind === 'apophis') {
        ctx.shadowColor = colour;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 16, p.y);
        ctx.lineTo(p.x - 4, p.y);
        ctx.moveTo(p.x + 4, p.y);
        ctx.lineTo(p.x + 16, p.y);
        ctx.moveTo(p.x, p.y - 16);
        ctx.lineTo(p.x, p.y - 4);
        ctx.moveTo(p.x, p.y + 4);
        ctx.lineTo(p.x, p.y + 16);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        this.drawLabel(
          `Apophis · ${fmtDeg(target.elevationDeg)}`,
          p.x + 18,
          p.y - 12,
          pal.apophis,
          pal,
          'left',
          12,
          true,
        );
      } else if (target.kind === 'sun') {
        ctx.shadowColor = colour;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12);
          ctx.lineTo(p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18);
          ctx.stroke();
        }
        this.drawLabel('Sun', p.x + 18, p.y - 10, pal.sun, pal, 'left', 11.5, true);
      } else if (target.kind === 'moon') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.fillStyle = 'rgba(4,8,14,0.55)';
        ctx.beginPath();
        ctx.arc(p.x + 3, p.y - 2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        this.drawLabel('Moon', p.x + 18, p.y - 10, pal.moon, pal, 'left', 11.5, true);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(3, target.radiusPx * 0.8), 0, Math.PI * 2);
        ctx.fill();
        if (target.name === 'Saturn') {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 13, 4, -0.35, 0, Math.PI * 2);
          ctx.stroke();
        }
        this.drawLabel(target.name, p.x + 12, p.y - 8, pal.planet, pal, 'left', 10.5, false);
      }
      if (target.id === selectedId) {
        ctx.strokeStyle = pal.warning;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  private drawReticle(orientation: Quat, pal: Palette): void {
    const ctx = this.ctx!;
    const cx = this.projection.width / 2;
    const cy = this.projection.height / 2;
    ctx.save();
    ctx.strokeStyle = pal.reticle;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.moveTo(cx - 18, cy);
    ctx.lineTo(cx - 11, cy);
    ctx.moveTo(cx + 11, cy);
    ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx, cy - 11);
    ctx.moveTo(cx, cy + 11);
    ctx.lineTo(cx, cy + 18);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Roll indicator: a short line from the reticle towards screen-up.
    const roll = Math.atan2(cameraUp(orientation).x, cameraUp(orientation).z);
    if (Math.abs(roll) > (0.6 * Math.PI) / 180) {
      ctx.strokeStyle = pal.warning;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(-roll) * 26, cy - Math.cos(roll) * 26);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLabel(
    text: string,
    x: number,
    y: number,
    colour: string,
    pal: Palette,
    align: CanvasTextAlign = 'left',
    size = 11,
    strong = false,
  ): void {
    const ctx = this.ctx!;
    ctx.save();
    ctx.font = `${strong ? 700 : 500} ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const pad = 3;
    let left = x;
    if (align === 'center') left = x - metrics.width / 2;
    if (align === 'right') left = x - metrics.width;
    ctx.fillStyle = pal.labelBg;
    ctx.fillRect(left - pad, y - size / 2 - 2, metrics.width + pad * 2, size + 4);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private updateReading(snapshot: ArSkySnapshot | null): void {
    if (!this.readingEl) return;
    if (!snapshot) {
      this.readingEl.textContent = 'Waiting for observer and clock…';
      return;
    }
    const heading = this.displayHeadingDeg;
    const pitch = this.displayPitchDeg;
    const cameraText =
      heading === null || pitch === null
        ? 'Camera —'
        : `Camera ${fmtDeg(heading)} / ${pitch >= 0 ? '+' : ''}${fmtDeg(pitch)}`;
    if (this.timeMode === 'tonight') {
      this.readingEl.textContent = `Tonight practice · ${cameraText} · Apophis hidden (2029 ephemeris only)`;
      return;
    }
    if (!snapshot.apophis) {
      this.readingEl.textContent = `${cameraText} · no Apophis data`;
      return;
    }
    const a = snapshot.apophis;
    const above = a.elevationDeg > 0;
    this.readingEl.textContent = `${cameraText} · Apophis ${fmtDeg(a.azimuthDeg)} / ${above ? '+' : ''}${fmtDeg(a.elevationDeg)} · ${fmtKm(a.rangeKm)} · ${above ? '' : 'below horizon'}${this.declination?.status === 'extrapolated' ? ' · extrapolated WMM' : ''}`;
    this.readingEl.classList.toggle('ar-below', !above);
  }

  private updateDebug(
    snapshot: ArSkySnapshot | null,
    orientation: Quat | null,
  ): void {
    if (!this.debugEl) return;
    this.debugEl.hidden = false;
    const sample = this.latestSample;
    const finalHeading = this.displayHeadingDeg;
    const finalPitch = this.displayPitchDeg;
    const decl = this.declination;
    const apophisPoint =
      this.lastApophisPoint ??
      (snapshot?.apophis
        ? projectAzEl(
            snapshot.apophis.azimuthDeg,
            snapshot.apophis.elevationDeg,
            orientation ?? quatFromVirtualLook(0, 0),
            this.projection,
            20,
          )
        : null);
    const selected = this.selectedTarget();
    const selectedPoint = selected
      ? projectAzEl(
          selected.azimuthDeg,
          selected.elevationDeg,
          orientation ?? quatFromVirtualLook(0, 0),
          this.projection,
          20,
        )
      : null;
    const lines = [
      'AR DEBUG',
      `mode        ${this.timeMode} · UTC ${snapshot ? new Date(snapshot.utcMs).toISOString() : '—'}`,
      `raw         α ${sample ? sample.alphaDeg.toFixed(3) : '—'} · β ${sample ? sample.betaDeg.toFixed(3) : '—'} · γ ${sample ? sample.gammaDeg.toFixed(3) : '—'} · absolute ${sample ? sample.absolute : '—'}`,
      `compass     ${sample?.compassHeadingDeg !== null && sample ? `${sample.compassHeadingDeg.toFixed(2)}°` : '—'} · accuracy ${sample?.compassAccuracyDeg !== null && sample ? `${sample.compassAccuracyDeg.toFixed(1)}°` : '—'} · source ${sample?.source ?? '—'}`,
      `screen      ${this.screenAngleDeg}° · touch ${this.touchMode} · camera ${this.cameraState}`,
      `declination ${decl?.declinationDeg !== null && decl ? `${decl.declinationDeg.toFixed(3)}° (${decl.status})` : 'unavailable'}`,
      `heading     true ${finalHeading === null ? '—' : finalHeading.toFixed(3)}° · measured ${this.measuredHeadingDeg === null ? '—' : this.measuredHeadingDeg.toFixed(3)}° · offset ${this.calibration.headingOffsetDeg.toFixed(2)}°`,
      `pitch       ${finalPitch === null ? '—' : finalPitch.toFixed(3)}° · quat ${orientation ? `w ${orientation.w.toFixed(3)} x ${orientation.x.toFixed(3)} y ${orientation.y.toFixed(3)} z ${orientation.z.toFixed(3)}` : '—'}`,
      `fov         ${this.calibration.horizontalFovDeg.toFixed(1)}° · viewport ${this.projection.width.toFixed(0)}×${this.projection.height.toFixed(0)} · focal ${this.projection.focalPx.toFixed(1)} px`,
      `apophis px  ${apophisPoint && apophisPoint.inFront ? `${apophisPoint.x.toFixed(1)}, ${apophisPoint.y.toFixed(1)} ${apophisPoint.visible ? 'visible' : 'offscreen'}` : 'behind/none'}`,
      `target px   ${selected ? `${selected.name}: ${selectedPoint && selectedPoint.inFront ? `${selectedPoint.x.toFixed(1)}, ${selectedPoint.y.toFixed(1)}` : 'behind'}` : '—'}`,
      `trail       ${snapshot?.trail.length ?? 0} points · stars ${snapshot?.stars.length ?? 0}`,
      `error est.  ±${estimatePointingError(this.calibration, sample?.compassAccuracyDeg ?? null).totalDeg.toFixed(1)}°`,
    ];
    this.debugEl.textContent = lines.join('\n');
    this.debugEl.dataset.alpha = sample ? String(sample.alphaDeg) : '';
    this.debugEl.dataset.beta = sample ? String(sample.betaDeg) : '';
    this.debugEl.dataset.gamma = sample ? String(sample.gammaDeg) : '';
    this.debugEl.dataset.absolute = sample ? String(sample.absolute) : '';
    this.debugEl.dataset.compassHeading = sample?.compassHeadingDeg === null || !sample ? '' : String(sample.compassHeadingDeg);
    this.debugEl.dataset.compassAccuracy = sample?.compassAccuracyDeg === null || !sample ? '' : String(sample.compassAccuracyDeg);
    this.debugEl.dataset.screenAngle = String(this.screenAngleDeg);
    this.debugEl.dataset.headingMag = sample?.compassHeadingDeg === null || !sample ? '' : String(sample.compassHeadingDeg);
    this.debugEl.dataset.headingTrue = finalHeading === null ? '' : String(finalHeading);
    this.debugEl.dataset.pitch = finalPitch === null ? '' : String(finalPitch);
    this.debugEl.dataset.offset = String(this.calibration.headingOffsetDeg);
    this.debugEl.dataset.fov = String(this.calibration.horizontalFovDeg);
    this.debugEl.dataset.declination = decl?.declinationDeg === null || !decl ? '' : String(decl.declinationDeg);
    this.debugEl.dataset.declinationStatus = decl?.status ?? '';
    this.debugEl.dataset.cameraState = this.cameraState;
    this.debugEl.dataset.sensorState = this.sensorState;
    this.debugEl.dataset.timeMode = this.timeMode;
    this.debugEl.dataset.utc = snapshot ? new Date(snapshot.utcMs).toISOString() : '';
    this.debugEl.dataset.apophisX =
      apophisPoint && apophisPoint.inFront && Number.isFinite(apophisPoint.x)
        ? String(apophisPoint.x)
        : '';
    this.debugEl.dataset.apophisY =
      apophisPoint && apophisPoint.inFront && Number.isFinite(apophisPoint.y)
        ? String(apophisPoint.y)
        : '';
    this.debugEl.dataset.apophisVisible = String(Boolean(apophisPoint?.visible));
    this.debugEl.dataset.selectedId = selected?.id ?? '';
    this.debugEl.dataset.selectedX =
      selectedPoint && selectedPoint.inFront && Number.isFinite(selectedPoint.x)
        ? String(selectedPoint.x)
        : '';
    this.debugEl.dataset.selectedY =
      selectedPoint && selectedPoint.inFront && Number.isFinite(selectedPoint.y)
        ? String(selectedPoint.y)
        : '';
    this.debugEl.dataset.cameraForward = orientation
      ? `${cameraForward(orientation).x.toFixed(4)},${cameraForward(orientation).y.toFixed(4)},${cameraForward(orientation).z.toFixed(4)}`
      : '';
  }
}
