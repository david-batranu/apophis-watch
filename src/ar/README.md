# AR workstream (Phase 4)

Self-contained rear-camera AR overlay for Apophis Watch. The module owns the
DOM inside the host element, its canvas/WebGL-free renderer, camera and
orientation listeners. It reads the observer, simulation time, session,
ephemeris and star catalogue through `ArHostApi`; it never recomputes the
Apophis ephemeris.

## Integration

```ts
import { createArWorkstream } from './ar';

const ar = createArWorkstream(document.getElementById('ar-host')!, {
  getState: () => store.getState(),
  subscribe: (listener) => store.subscribe(listener),
  getSession: () => app.getSession(),
  getEphemeris: () => app.getEphemeris(),
  getCatalogue: () => app.getCatalogue(),
  setTimeUtcMs: (ms) => app.setUtc(ms),
  setPlaying: (playing) => app.setPlaying(playing),
  setStatus: (message) => app.setStatus(message),
});

ar.mount();
// ar.update(state) is optional: the module also subscribes through the host.
// ar.unmount() stops the camera, sensor listeners and animation loop.
```

The module imports only `src/ar/ar.css`, never the shared `styles.css`. It
respects `state.toggles.nightMode` with a red-on-black palette and red-tinted
camera feed. It needs the host to provide a non-zero-height element; the CSS
uses `min-height: 70vh` as a fallback.

## What is drawn

- Apophis at the host clock, plus a ±2 h path with 5-minute ticks and local
  `HH:mm` labels every 30 minutes.
- Sun, Moon and planets from astronomy-engine, and bright catalogue stars
  (no unnamed coordinate strings are labelled).
- Horizon line, 15° azimuth ticks and N/E/S/W.
- Alignment target highlight and a reticle.
- `?debug=1` overlay with raw alpha/beta/gamma, absolute flag, compass
  heading/accuracy, screen angle, WMM declination, heading offsets, FOV,
  quaternion and projected Apophis/selected-target pixels. Data attributes
  are exposed for Playwright.

## Orientation pipeline

1. `deviceorientationabsolute` / `deviceorientation` gives W3C Z-X'-Y''
   angles. The W3C matrix is `R = Rz(alpha) Rx(beta) Ry(gamma)`.
2. `screen.orientation.angle` (0/90/180/270) is applied as
   `R_screen = R_device * Rz(theta)`. `window.orientation` is the fallback
   (normalised from ±90 to 0..270). The change event forces a snap.
3. If `webkitCompassHeading` is available (iOS) it replaces the yaw from raw
   alpha, and `webkitCompassAccuracy < 0` is treated as unusable. Otherwise an
   absolute event is used as-is; a non-absolute event is clearly labelled
   "relative only" and needs one-tap or two-point calibration.
4. Magnetic to true north uses WMM2025 from `geomagnetism@0.2.0` at the
   observer and date. Positive declination is east. The installed package's
   window ends 2029-11-13; dates up to the official 2029-12-31 end are marked
   **extrapolated WMM** in the UI, and later dates disable the correction
   (WMM2030 is expected in December 2029). The 2029-04-13 flyby is well inside
   the supported window.
5. A light slerp (τ ≈ 90 ms) smooths the quaternion; jumps over 55° snap.
6. The manual/two-point heading offset is applied after declination, so it
   corrects both sensor and alignment errors without hiding the WMM step.

Assumption: absolute alpha and `webkitCompassHeading` report **magnetic**
north. iOS documents `webkitCompassHeading` as magnetic. If a future browser
reports true north there, the WMM correction would be applied twice (currently
about +6.7° at Brasov); this can only be confirmed on real hardware.

## Calibration

- Heading offset slider ±180° plus −1°, −0.1°, +0.1°, +1° nudges.
- One tap: choose Sun, Moon, a planet or a named bright star above the
  horizon, centre it, tap “Align on target”. The offset is set exactly.
- Two-point: mark target A, point at target B, tap again. The app averages the
  two implied offsets and reports half their disagreement as a residual. It
  does not pretend to remove a compass's nonlinear error.
- Horizontal FOV slider 30–100°, default 60° (screen width, not the camera
  sensor's landscape spec). Tune it until the horizon and star spacing look
  right; phone preview crops differ.
- Everything is stored under `apophis-ar-calibration-v1` in `localStorage`.
- The pointing-error readout uses the device-reported `webkitCompassAccuracy`
  when present, otherwise an explicit “5–15° typical” assumption. A 2026
  iPhone field test saw ±14–16°. This is a finder, not a measuring instrument.

## Time modes

- **2029 rehearsal** uses the host clock/session. Enter any UTC instant inside
  the committed ±24 h window or use Closest approach / Visible start / Rise.
- **Tonight practice** uses the real clock for Sun, Moon, planets and stars.
  Apophis is hidden because the committed ephemeris covers only 13–14 April
  2029 UTC. This mode exists to practice aim and calibration on real objects.

## HTTPS LAN testing (shared config request)

The current shared `vite.config.ts` is HTTP-only. Do **not** edit it from this
worktree. The orchestrator should add `@vitejs/plugin-basic-ssl` (already in
`devDependencies`) as follows:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: './',
  plugins: [
    basicSsl({
      name: 'apophis-watch',
      // Add the LAN hostname/IP if the generated certificate needs it.
      domains: ['localhost'],
    }),
  ],
  build: { target: 'es2022' },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
```

`basicSsl()` enables HTTPS for the dev and preview servers; leave
`server.https` unset unless you supply a custom certificate. The existing
`dev` script already passes `--host` through `server.host`, so no new script is
strictly required. If a named script is preferred:

```json
"dev:https": "vite --host 0.0.0.0 --port 5173"
```

Then open `https://<LAN-IP>:5173/` on the phone and accept the certificate
warning. **iOS caveat:** the plugin generates an untrusted self-signed
certificate. Some iOS versions refuse camera/motion access on an untrusted
certificate even after the warning. For reliable iPhone testing, use a
trusted local certificate (for example one created by `mkcert` and installed
on the phone) via `server.https` instead. This is a real-device deployment
issue; the code only requires a secure context.

## Phone checklist

1. Start the HTTPS dev server and open it on the phone on the same Wi-Fi.
2. Accept the certificate, then tap **Enable compass** (iOS requires a user
   gesture; Android Chrome 151 exposes `requestPermission` but defaults it to
   allow, so the app still calls it inside the tap).
3. Allow **Motion & Orientation** and **Camera**. If camera is denied the
   overlay continues on black; if sensors are denied, turn on **Touch-drag
   virtual AR**.
4. Stand outside, face south/west, and compare the horizon, N/E/S/W and a
   bright star with reality.
5. Tap a known object and **Align on target**. Then mark two objects with the
   two-point flow and read the residual and estimated pointing error.
6. Rotate portrait ↔ landscape. The horizon must stay level; report the
   device model and screen angle in `?debug=1` if it does not.
7. Try **Tonight practice** on the Sun/Moon/a planet, then switch back to a
   2029 rehearsal instant.
8. Test denied camera, denied motion, no-HTTPS, and airplane-mode behaviour.

## Tests

```bash
npx vitest run tests/ar          # 43 pure maths/calibration/declination tests
npx tsc --noEmit
npx playwright test -c tests/ar/playwright.ar.config.ts
```

The Playwright harness (`tests/ar/harness.html`) loads the real committed
ephemeris/catalogue, mounts the module with a mock host, uses Chromium's fake
camera and mocked `deviceorientationabsolute` / `deviceorientation` events.
It covers:

- the Apophis marker moving when mocked heading changes;
- all four screen orientations (unit tests) and a landscape screen-angle
  screenshot;
- FOV scaling;
- one-tap and two-point calibration and localStorage persistence;
- night mode and touch-drag fallback;
- camera denial with a black-background overlay;
- iOS-style `webkitCompassHeading` and negative `webkitCompassAccuracy`.

Screenshots are committed under `tests/ar/screenshots/`.

## What only a real phone can confirm

- Actual compass accuracy, drift, magnetic interference and figure-eight
  calibration; the 5–15° (2026 iPhone ±14–16°) range is a field expectation,
  not a guarantee.
- Whether iOS grants motion access in the exact Safari version, and whether
  `requestPermission(true)` requests the magnetometer on that build.
- Whether the device reports magnetic or true north in absolute orientation.
- Camera preview FOV, crop, aspect and rotation; the FOV slider is manual
  precisely because browsers/devices differ.
- The real screen-orientation transition timing and `window.orientation` sign
  on older iOS versions.
- Sensor event rate, thermal throttling, battery use and real-phone frame
  rate; headless Chromium is not a phone.
- Overlay registration against buildings/terrain (there is no occlusion or
  SLAM in this phase).
- Any camera/sensor permission behaviour on an untrusted HTTPS certificate.
