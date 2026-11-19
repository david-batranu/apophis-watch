# Apophis Watch — implementation plan

## Product

Single-page, installable PWA that simulates the 2029-04-13 close approach of
(99942) Apophis from any point on Earth, finds unobstructed viewing spots, and
offers a camera AR view for rehearsing the event. Static hosting only, no
backend, no accounts, no analytics.

## Stack and dependency budget

| Dependency | Why | Alternative rejected |
|---|---|---|
| Vite + TypeScript | fast static build, native TS, small output | plain esbuild lacks dev server/PWA integration |
| astronomy-engine | Sun/Moon/planets, sidereal time, precession–nutation, rise/set; pure TS, zero runtime deps | implementing IAU nutation ourselves is unjustified risk |
| three.js | space view, local terrain/buildings, AR overlay | raw WebGL costs weeks and is error-prone |
| leaflet | OSM location picker and result map | custom tile map recreates attribution/gesture handling |
| vite-plugin-pwa (Workbox) | installable PWA + offline cache | hand-written SW is easy to get wrong on updates |
| @vitejs/plugin-basic-ssl | HTTPS on LAN for phone sensor/camera testing | self-signed cert scripts are fiddly |
| geomagnetism (WMM) | magnetic → true north for AR | no built-in browser WMM; declination must not be guessed |
| idb-keyval | small Promise wrapper over IndexedDB for tile/building cache | raw IndexedDB boilerplate |
| vitest | unit tests in the same TS/Vite pipeline | Jest needs separate transform config |
| playwright (dev only) | headless UI/AR fallback smoke tests | manual-only testing is not repeatable |

No UI framework: Phase 2–4 UI is a handful of panels, so vanilla TS with small
DOM helpers keeps the bundle smaller than Preact + its tooling. This is a
deliberate choice, not an omission.

**UI state:** one small typed store module (`src/ui/store.ts`) owns location,
time, playback, view mode, calibration and terrain state. Panels subscribe to
it; no panel keeps private duplicate state. Ephemeris/sky/terrain/AR modules
remain pure and take explicit inputs.

## Module layout

```
scripts/fetch-ephemeris.ts     build-time Horizons fetch + committed data
public/data/                   ephemeris, validation truth, star catalogue
src/ephemeris/                 Hermite interpolation, WGS84/ENU, topocentric
src/sky/                       sky dome, star catalogue, space view, magnitudes
src/terrain/                   DEM, OSM buildings, horizon profile, best-spot
src/ar/                        camera, device orientation, calibration
src/ui/                        app shell, controls, panels, i18n strings
src/workers/                   best-spot worker
tests/                         maths + data validation
```

Frozen shared interfaces after Phase 2: `ObserverState`, `SkyPosition`,
`EphemerisProvider`.

## Time scales (normative)

| Quantity | Scale / frame | Where used |
|---|---|---|
| JPL Horizons state vectors | **TDB** Julian Date, ICRF axes | committed ephemeris, Hermite interpolation |
| UI clock, event labels | **UTC** | all user-facing times, AR rehearsal |
| Physics time argument | **TT** | TDB conversion, astronomy-engine solar-system bodies |
| Earth rotation | **UT1**, approximated by UTC | GAST / observer frame |
| Horizons observer truth | **UTC** | validation only |

- UTC → TT uses the leap-second table: `TT = UTC + 37 s + 32.184 s = UTC + 69.184 s`
  for the 2029 window (last leap second 2017-01-01; none announced through
  2026). astronomy-engine's `AstroTime.tt` is **not** used for this: it is
  TT−UT1 from its own ΔT prediction (~77 s in 2029), which caused a measured
  7.9 s error before correction. A regression test pins the 69.184 s value.
- TT → TDB uses the leading Fairhead–Bretagnon terms; residual <2 ms
  (<15 m of Apophis motion), far below the 1 km interpolation budget.
- UT1−UTC is not knowable years ahead. The leap-second system bounds
  `|UT1−UTC| < 0.9 s`, which rotates the observer frame by at most
  `0.9 × 15.041 = 13.54″` (0.226′), and displaces an equatorial observer by
  at most 0.42 km. At the 34,800 km flyby range that displacement moves the
  apparent direction by <2.5″. This is recorded as a known bounded residual,
  not corrected. Polar motion (<0.5″) is likewise omitted.
- Closest-approach displays show **UTC and TDB JD** together. Geocentric and
  per-observer topocentric closest approaches are both computed; the UI
  "jump to closest approach" uses the topocentric one.

## Phase 1 design

- Fetch geocentric ICRF state vectors (`CENTER=500@399`, `REF_PLANE=FRAME`,
  `VEC_TABLE=2`, km/km/s) at 60 s spacing over CA ±24 h; store JD(TDB),
  position, velocity, plus query metadata and retrieval time.
- Compute **geocentric** CA by minimising geocentric range, and a separate
  **topocentric** CA for the selected observer by minimising apparent range.
  Validate the topocentric CA against a dense independent Horizons observer
  table at one site; report the two times and their difference.
- Fetch independent 30 s-offset truth vectors from Horizons; compare cubic
  Hermite (position + velocity) against them to prove <1 km interpolation
  error. 60 s is chosen from this measured error, not assumed.
- Observer: WGS84 geodetic → ECEF; ICRF→true-of-date via precession/nutation
  and GAST (astronomy-engine); subtract observer from the light-time-corrected
  Apophis position; add Earth's centre displacement during light time;
  apply annual+diurnal aberration; rotate to ENU. Azimuth measured clockwise
  from north, elevation geometric (airless by default).
- Observer **ground elevation will come from the DEM plus the eye-height
  setting**; GPS altitude is a cross-check only because phone altitude is
  unreliable. Phase 1 accepts an explicit elevation input.
- Validation truth: Horizons OBSERVER table (`QUANTITIES=4,9,13,20`,
  airless apparent) at Brasov, Cape Town, Tenerife, Longyearbyen (no
  astronomical darkness, so never visible) and Honolulu (below the horizon at
  CA), at seven epochs including CA. Target max error <1 arcmin; anything
  larger is investigated, not hidden.
- Brightness: IAU H–G model with H=19.09, G=0.24 from Horizons, labelled
  estimate. Angular diameter from Horizons RAD=0.170 km.
- Events: CA by minimizing interpolated geocentric range with Brent
  refinement; surface distance = geocentric distance − WGS84/local Earth
  radius; visibility window = altitude >0 and Sun altitude <−6°, computed
  from astronomy-engine Sun/Moon.
- Atmosphere: optional Bennett refraction for display, never enabled in the
  validation path.

## Phase 2–5 outline

2. UTC/local clock controls, sky dome with bright stars + trail ticks, true
   scale space view, honest 2″ marker plus clearly labelled enlargement.
3. AWS Terrarium DEM + Overpass buildings in a local ENU scene, eye/rooftop
   views, obstructed-path scoring in a Web Worker, top-10 + heatmap,
   attribution and polite caching. Compute the Apophis sky path **once per
   search area** and score each candidate against its own horizon profile.
   Over a 5 km baseline the parallax difference is
   `5 km / 38,000 km ≈ 1.32×10⁻⁴ rad ≈ 27″` (54″ between opposite edges of a
   10 km-wide search area), so it changes edge-of-ridge timing by seconds,
   not the ranking. This avoids recomputing the ephemeris thousands of times.
4. Rear camera + DeviceOrientation (absolute/compass), WMM declination,
   one-tap calibration on the Sun, Moon, bright planets **or a short list of
   bright stars** (Sun/Moon may not be up at the event), plus manual heading
   offset, FOV tuning, localStorage persistence, touch-drag fallback, 2029
   rehearsal. The installed `geomagnetism` package ships WMM2025, valid
   2024-11-13 → 2029-11-13, which covers 2029-04-13. Outside that range it
   throws by default; we will catch it, use the latest model only with a
   visible "extrapolated WMM" warning, or hide the declination correction.
5. Pre-cache area, instancing/LOD, accessibility, i18n-ready strings,
   static HTTPS deployment docs.

## Risks / open questions

- Horizons solution changes: data is committed with retrieval date; a refresh
  script re-runs validation, never silently mutates numbers.
- 2029 time scales: Horizons output is TDB; app converts UTC→TT using leap
  seconds, then TT→TDB (<2 ms → <15 m, far below the 1 km interpolation
  budget). astronomy-engine's ΔT prediction is explicitly not used for
  UTC→TT. Validation truth is fetched with explicit UTC.
- Overpass availability/rate limits, AWS terrain tile policy, iOS sensor
  permission changes: researcher subagent must confirm before Phase 3/4.
- Bright-star catalogue licence/provenance must be confirmed before bundling.
- Light pollution is out of scope unless a bundleable open dataset is found.
