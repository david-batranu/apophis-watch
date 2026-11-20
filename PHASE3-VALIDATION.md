# Phase 3 validation — Terrain, buildings and best spot

Workstream commit `c2ccc1e` on `phase3-terrain`; merged into main.
Independent read-only verifier: **PASS** after the roof-winding, `building=no`
and observer-ground consistency fixes (final fix `c2ccc1e`). Live Overpass
building data could not be independently fetched in the verification
environment (HTTP 406/504), so real-building horizons remain unverified;
terrain-only and synthetic building cases pass.

## Commands

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | **114/114 workstream tests** (22 files); merged suite **162** |
| `npm run build` | clean; terrain/AR code-split chunks |

## DEM

- Source: `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png`
  (AWS Open Data / Mapzen). 256×256 RGB, max z15, CORS `*`, encoding
  `(R*256+G+B/256)-32768`.
- Brasov: **z14, 6.68 m/px**, 81 tiles, 15.4×15.4 km, ground **591.83 m**.
- Cape Town: z14, 7.92 m/px, 56 tiles, ground **15.41 m** (Mercator) /
  **14.49 m** (scene ENU anchor).
- Local ENU mesh; Earth curvature sagitta; IndexedDB cache. The scene, horizon
  chart, 3D horizon and occlusion use the ENU anchor; the shared astronomy
  observer uses the Mercator sample. At Cape Town these differ by 0.92 m; the UI
  shows both when >0.1 m. The previous 3.56° az-270 inconsistency is fixed.

## Horizon verification

Independent hand calculations (verifier):

| Synthetic case | Hand calculation | Module | Delta |
|---|---:|---:|---:|
| Flat, curvature, eye 1.7 m | −0.041856° (tangent 4654.18 m) | −0.041856° | <1e−6° |
| 2 m wall at 10 m | 1.735660° | 1.735660° | <1e−6° |
| 50 m ridge, crest 500 m | 5.515425° | 5.5566° | +0.041° |

The ridge error is nearest-cell/ray-step discretisation. At the default z14
grid, far-field horizons (Brasov and Cape Town, cardinal/8-azimuth checks)
matched independent bilinear/exact-sagitta marches to max **0.127°**. A merged
verifier deliberately used z13 grids (25/20 tiles, 7 km) and found near-field
obstructions at 14–200 m with max **2.33°** / p95 **0.97°**, because
nearest-cell sampling attributes an adjacent 13–16 m pixel to the first sample;
far-field agreement remained ≤0.05°. This is now documented as a near-field
limitation of the 1°-bin planning profile. Synthetic ridge test Δ 0.0015°.

## Best spot

- Path built once per search area; no per-candidate ephemeris rebuild.
- 625 path samples, 317 candidates (1 km, 100 m): two runs gave identical
  top-10 IDs/scores and identical results for all candidates; ordering score →
  min clearance → index.
- Top-1: 45.63730°, 25.59896°, score **0.9968 (623/625)**, min clearance
  **1.8652°**.
- 2,821 candidates with 2,828 cached OSM buildings: **4.4 s** in the worker
  (desktop); flat synthetic 2,007×2,007: 3.4 s.
- 5 km parallax: **27.132″** at 38,011.34 km; **29.814″** at 34,591.44 km.
  Far below the 1° horizon bin.
- Brasov physical visible path: **az 124.25° → 320.05°** (195.80° span),
  elevation **0 → 42.29°**, max at ~20:45:05 UTC.

## Buildings

- Overpass/OSM, one debounced query per settled view, IndexedDB cache, 429
  cooldown, no blind retry, ODbL attribution.
- Height priority `building:height → height → levels×3 → 8 m`; default-height
  buildings marked amber and share shown.
- Worker's real 1 km Brasov sample: **2,828 ways, 2,750 (97%) using the 8 m
  default** — building heights are unreliable. The verifier could not reproduce
  live Overpass (HTTP 406/504); the app shows a user-visible error and does not
  retry. This remains **unverified against live buildings**.
- Overture was rejected for live use: 181 GB PMTiles marked inspection-only and
  GeoParquet not spatially partitioned; Overpass/OSM is the right source for a
  small static PWA.

## UI / night / attribution

- Leaflet OSM picker with attribution; manual lat/lon; DEM ground; 1.7 m eye
  height, floor N and rooftop modes. GPS altitude is only a cross-check.
- 3D eye-height scene with extruded buildings, horizon and Apophis trail;
  live time scrubbing; light pollution explicitly not modelled.
- Night map is darkened and red-tinted with red attribution links; local scene
  and horizon chart use the red palette.
- Credits: Mapzen/AWS Terrain Tiles (full source list), © OpenStreetMap
  contributors/ODbL, Overpass, Leaflet BSD-2. `public/data/TERRAIN.md`.

## Frame time

Headless Chromium, 4× CPU throttle, 390×844, 180 steady-state rAF intervals:

| View | Mean | p95 | Max |
|---|---:|---:|---:|
| Sky | 16.67 ms | 16.80 ms | 16.80 ms |
| Local 3D | 16.67 ms | 16.70 ms | 16.80 ms |
| AR overlay | 16.67 ms | 16.80 ms | 16.80 ms |

Best-spot computation is worker-side (~4.4 s), not part of the frame budget.
These are desktop/headless numbers, not a physical phone. The merged verifier
repeated the measurements (16.667 ms mean / 16.70 ms p95 for Sky, Local 3D and
AR), clicked the Local 3D and AR tabs, confirmed AR camera tracks end on leave,
the map is usable on return, and night mode is red-on-black across map, chart,
3D and AR. **PASS.**

Minor known UI observation: after an Overpass 502, the building-detail line can
remain “Querying Overpass…” while the badge/banner show the error; it is
cosmetic and no fake data is used. `geomagnetism` also logs a console warning
on extrapolated WMM dates; the UI warning is correct.

## Uncertainties

- Live Overpass building data unavailable during verification; building
  horizons are synthetically tested but not confirmed against real Brasov OSM
  data in this run.
- DEM ray distance is limited by the patch (~7.7 km default); distant ridges
  beyond it are not modelled.
- OSM heights are incomplete (97% default in sample); flat-roof assumption;
  no trees/weather/light pollution.
- The 3D scene initial ground differs from the shared Mercator ground by up to
  ~0.9 m; the UI explains both. Horizon/scene are now consistent with ENU.
- Frame timing is headless 4× throttle, not a real phone.
