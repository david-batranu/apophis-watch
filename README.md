# Apophis Watch

A static, mobile-first simulator for the **13 April 2029** close approach of
(99942) Apophis. Phases 1–4 are implemented: ephemeris validation, sky/space
views, local terrain/buildings/best-spot search, and camera AR. Phase 5
(offline PWA packaging) is not part of this build.

## Run

```bash
npm install
npm run dev                 # Vite dev server (HTTP)
npm run dev:https           # HTTPS for phone camera/orientation testing
npm run build               # typecheck + production build
npm test                    # 153 Vitest tests
npm run test:e2e            # 12 merged Playwright smoke tests (needs Chromium)
npx playwright test -c tests/ar/playwright.ar.config.ts  # AR mock suite
npm run typecheck
npm run fetch:ephemeris     # refresh the committed JPL Horizons data
npm run fetch:stars         # rebuild HYG + ConstellationLines JSON
npm run report:phase1       # regenerate PHASE1-VALIDATION.md
```

Useful URL parameters (also convenient for testing and sharing):

```text
?lat=45.6427&lon=25.5887&elev=600&eye=0
&utc=2029-04-13T21:35:42Z
&view=sky|space|local|ar&refraction=0|1&night=1
&constellations=0|1&enlarged=1&minEl=10&debug=1
```

Without `lat`/`lon` the app requests browser geolocation. GPS altitude is
ignored. The shared sky/AR observer uses the preset/manual ground elevation or
0 m + eye height until the Local 3D tab resolves ground elevation from the DEM.

## Architecture

- `src/ephemeris/` — frozen Phase 1 maths: Horizons vectors, Hermite
  interpolation, WGS84/ENU, frames, topocentric az/el, H-G estimate, events,
  visibility. No view code.
- `src/state/store.ts` — the single typed UI store (UTC clock, playback,
  observer, view mode, toggles, night mode, window).
- `src/state/session.ts` — pure derived session: CA targets, visibility,
  altitude events, plot samples, trail samples.
- `src/state/appModel.ts` — browser orchestration: data/assets loading,
  geolocation, URL parameters, clamping, jump actions.
- `src/sky/` — stereographic projection, HYG catalogue loader,
  constellation lines, Sun/Moon/planets, canvas sky renderer, Three.js space
  view, size-comparison maths.
- `src/terrain/` — Leaflet picker, Terrarium DEM, Overpass buildings, horizon
  profile, Web-Worker best-spot scoring, local Three.js scene.
- `src/workers/` — best-spot scoring worker.
- `src/ar/` — camera AR, orientation/quaternion pipeline, WMM declination,
  calibration, rehearsal and fallbacks.
- `src/ui/` — panel shell, controls, readout, elevation/magnitude plot,
  debug overlay, time formatting.
- `src/core/` — vector and time-scale utilities.

`ObserverState`, `SkyPosition` and `EphemerisProvider` are frozen and guarded by
`tests/interfaces.test.ts`.

## Data and accuracy

- Ephemeris: NASA/JPL Horizons, **JPL#220**, retrieved 2026-11-19. H=19.09,
  G=0.24, equivalent radius 0.170 km. The committed file includes the exact
  query and timestamp. Geocentric CA 2029-04-13 **21:45:03.557 UTC**
  (JD TDB 2462240.407091935), 38,011.344 km from Earth's centre. Topocentric CA
  at Brasov is 21:35:42.000 UTC, 9.4 min earlier.
- Phase 1 topocentric az/el validation: **max 0.050 arcmin (3.01″)** against
  Horizons over 5 sites × 7 epochs. Hermite vs independent 30 s truth:
  **0.000448 km**. See `PHASE1-VALIDATION.md`.
- Stars: HYG Database v4.4, **CC BY-SA 4.0**, 1,615 stars with V < 5,
  ~183 KiB. HYG's RA column is hours and the generator converts to degrees;
  a test pins Sirius 101.287°, Capella 79.172°, Vega 279.234° and Polaris
  37.95°. HYG is partly Hipparcos-derived (ESA CC BY-NC 3.0 IGO); review
  before commercial use. The derived `stars.json` remains CC BY-SA 4.0.
- Constellation lines: Marc van der Sluys, ConstellationLines v1.4,
  **CC BY 4.0**, 90 polylines; 9/840 BSC HR vertices are absent from HYG and the
  lines are split there rather than bridged.
- Size-comparison physical sizes: NASA Moon Fact Sheet (3,474.8 km), NASA ISS
  (109 m array span), FIFA/IFAB pitch (105 m), official Eiffel Tower (330 m),
  Horizons Apophis (340 m). Angular sizes are calculated with
  `2 atan(radius/distance)`, not recalled.
- Full notices: `public/data/README.md` and `THIRD_PARTY_NOTICES.md`.

## Phase 2 measured checks

- Frame time in the sky view, headless Chromium at **4× CPU throttle**, 600×
  playback: mean **16.5–17.1 ms across runs** (final 16.88 ms), p95
  **16.7–16.8 ms**, with an occasional **33.4 ms** hitch, over 150 frames.
- Jump targets at Brasov (600 m, eye 0): topocentric CA `21:35:42.000Z`,
  geocentric CA `21:45:03.557Z`, rise `17:15:43.765Z`, max elevation
  `20:45:04.939Z`, set `22:44:06.557Z`, visibility start `17:32:35.247Z`,
  visibility end `22:44:06.557Z`.
- Europe/Bucharest DST: `2029-04-13 21:45:03 UTC` displays as
  `2029-04-14 00:45:03 EEST`.
- Playwright screenshots: `test-results/phase2/sky-2045.png`,
  `sky-topoca.png`, `sky-near-setting.png`, plus debug-panel versions, night
  sky/space and space presets.

## Local 3D and best spot (Phase 3)

Open `?view=local` or the **Local 3D** tab. It shows a Leaflet OSM picker, an
AWS Terrarium DEM (z14, 6.7 m/px at Brasov; 81 tiles for the default search),
Overpass buildings, a 1° horizon profile, a Web-Worker best-spot grid, and a
Three.js eye-height scene with live occlusion.

At Brasov the Phase 1 visible pass covers **az 124.3° → 320.1°**, elevation
**0 → 42.29°**; the topocentric CA is 21:35:42 UTC. The 5 km parallax is
**27.13″** at geocentric CA and **29.81″** at topocentric CA, far below the 1°
horizon bin. A real 1 km Brasov building query returned 2,828 ways and 97%
using the 8 m default height, so building heights are clearly incomplete. A
2,821-candidate best-spot run took **4.4 s** in the worker on desktop.

Terrain: **Terrain Tiles by Mapzen / AWS Open Data**; buildings and map:
**© OpenStreetMap contributors, ODbL** via Overpass/Leaflet. Light pollution,
weather and trees are not modelled. See `src/terrain/README.md`.

## AR mode (Phase 4)

Open `?view=ar` or the **AR** tab. The camera and motion sensors require a
secure context. `npm run dev:https` starts Vite with a generated certificate;
on a phone open `https://<LAN-IP>:5173/`, accept the warning, then tap
**Enable compass / motion**. iOS sometimes refuses camera/motion on an
untrusted certificate; for reliable iPhone testing use a locally trusted cert
(e.g. `mkcert`) and configure `server.https` in `vite.config.ts`.

The AR module reads the shared observer/time/session/catalogue, renders the
Apophis trail and bright objects, and never recomputes the ephemeris. It
supports absolute orientation, iOS `webkitCompassHeading`, screen rotation,
WMM declination, manual/two-point calibration, a virtual touch fallback, and a
**Tonight practice** mode using the real Sun/Moon/planets. The full real-phone
checklist and HTTPS caveats are in `src/ar/README.md`.

WMM2025 is bundled via `geomagnetism` (Apache-2.0); it covers the 2029 flyby.
The package window ends 2029-11-13, after which the module explicitly marks
extrapolated/unsupported declination rather than silently trusting it.

## Known limitations

- UT1−UTC for 2029 is unknown; the leap-second bound gives ≤13.54″ frame
  rotation and ≤0.42 km observer displacement. Polar motion and solar light
  deflection are not modelled. See `PHASE1-VALIDATION.md`.
- HYG/Hipparcos provenance is non-commercial for ESA data; the app is suitable
  for personal/non-commercial use with the stated attribution. Resolve this
  before a commercial launch.
- The dome trail labels are thinned when they would overlap; the complete
  5-minute tick list is in the “5-min trail ticks” strip under the readout.
- The Moon is near new during the flyby (~0.2% illuminated), so its phase icon
  is a very thin crescent.
- Frame timing was measured in headless Chromium with 4× CPU throttling, not on
  a real mid-range phone.
- OSM building heights are incomplete (97% default in the Brasov sample);
  footprints may be missing. The horizon is limited by the DEM patch; distant
  ridges beyond it are not modelled. Light pollution/weather/trees are not
  modelled.
- The AR compass is a finder, not a measuring instrument: typical 5–15°
  accuracy (2026 iPhone field report ±14–16°). Camera FOV, absolute heading
  sign, screen-rotation timing and permission behaviour can only be confirmed
  on real hardware.
- Pinch gestures are implemented but only wheel/drag/reset are automated.
- Phase 5 (offline pre-cache, PWA install, deployment docs) is not started.
