# Terrain workstream (Phase 3)

Self-contained terrain tab: map picker, AWS Terrarium DEM, Overpass buildings,
1° horizon profile, best-spot search in a Web Worker, and a Three.js eye-height
view. Shared state is read-only; observer/ground/time changes go through
`TerrainHostApi`.

## Mount

```ts
import { createTerrainWorkstream } from './terrain';

const terrain = createTerrainWorkstream(root, {
  getState, subscribe, getSession, getEphemeris, getCatalogue,
  setObserver, setGroundElevationM, setTimeUtcMs, setStatus,
  // optional: setEyeHeightM
});
terrain.mount();
```

`TerrainHostApi` and `TerrainWorkstream` are exported from `index.ts`. The
workstream subscribes to the host store itself and also accepts `update(state)`
pushes, so either integration style works.

### Eye height

The required host API has no eye-height setter. The tab keeps a local eye
height (default 1.7 m), supports floor N ((N−1)×3 m + 1.7 m) and rooftop
(tallest OSM building at the point + 1.7 m), and calls the optional
`setEyeHeightM` if the host implements it. Without that extension, the local
horizon/3D view uses the local value while the shared sky tab keeps its own.

## Data and method

### DEM

- Source: `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png`
  (AWS Open Data, Mapzen/joerd). 256×256 RGB PNG, max zoom 15, CORS `*`.
- Encoding: `elevation_m = (R*256 + G + B/256) - 32768`.
- The loader chooses the highest zoom whose tile-aligned bbox fits a 81-tile
  budget. At Brasov (45.6427°, 25.5887°) and a 7 km radius this is **z14,
  6.68 m/px**, 9×9 = 81 tiles, 15.4 × 15.4 km. The UI states the selected zoom
  and resolution. The nominal Web Mercator resolution is adjusted for the
  ellipsoid's east/north pixel scales (about 0.2% difference).
- Tiles are cached in IndexedDB (`apophis-watch-terrain`, store `cache-v1`)
  with a one-year TTL. Individual tile failures leave NaN holes; the 3D mesh
  skips those cells and the horizon ray march skips them, and the UI reports
  the failed count.
- The stitched grid is mapped into a local east/north frame anchored at the
  observer. Earth curvature is applied as the spherical sagitta
  `R(1 − cos(d/R))`; at 10 km it is 7.85 m. The geometric horizon of a flat
  plane for a 1.7 m eye is the tangent point at √(2Rh) ≈ 4.65 km, which the
  ray march finds correctly.
- The shared astronomy ground elevation uses the Mercator pixel sample at the
  observer. The local 3D mesh anchors at the constant-spacing ENU sample at
  (0,0), because that is the ground the mesh actually draws. At Cape Town the
  two differed by **0.92 m** (14.49 m ENU vs 15.41 m Mercator) on the
  verifier's real DEM. `sceneGroundElevationM()` performs this anchor; the
  camera eye height is measured from the mesh, not from a 0.9 m pedestal.

### Buildings

- Overpass endpoint `https://overpass-api.de/api/interpreter`; query
  `[out:json][timeout:25];way["building"](around:R,LAT,LON);out geom;`.
- One query per settled view, debounced 1.2 s; IndexedDB cache with a 30-day
  TTL; no polling and no automatic retry. HTTP 429 sets a user-visible cooldown
  from `Retry-After`; 502/503/504 are reported as "at capacity". The UI's
  Fetch button is the only retry.
- Height priority: `building:height` → `height` → `building:levels × 3` →
  8 m default. Metres and feet are parsed. `building=no` is skipped
  case-insensitively so construction-site outlines do not become phantom 8 m
  obstructions. The UI shows the number and share of default-height
  buildings; they extrude amber in 3D. The sample Brasov 1 km
  query had 2,828 ways, of which 2,750 (97%) use the 8 m default — a useful
  warning about OSM height completeness.
- Best-spot searches expand the query to
  `min(5 km, search radius + building radius)` so every candidate has
  `buildingRadiusM` (default 1 km, max 5 km) of coverage. If that query fails,
  the search still runs with available data and marks the result incomplete.

### Horizon

- `computeHorizonSlopes` ray-marches the DEM at 1° azimuth bins (or a caller's
  subset), using slope space so no `atan2` is needed per terrain sample. It
  records source (terrain/building), distance and top elevation.
- Terrain is sampled at the nearest cell with a step of ~0.9 × DEM spacing.
  The independent verifier measured **+0.055°** on a synthetic ridge and
  **0.127°** against an independent real-DEM march. Both are sub-bin for the
  1° profile; this is a deliberate speed/accuracy trade-off, not exact
  ray-tracing.
- Buildings are represented by their footprint edges sampled every 2 m; the
  nearest wall/roof edge determines the obstruction angle. A ground-level point
  inside a footprint scores 0 (not a valid observing spot); a rooftop eye above
  the roof is allowed.
- `computeHorizonProfile` decodes the arrays into objects for the chart and 3D
  horizon line.

### Best spot

- The Apophis path is built **once per search area** from
  `SimulationSession.visibleIntervalForJump()` (the physical Phase 1 window
  containing/nearest the topocentric CA), sampled every 30 s with
  `apparentHorizontalAtJd`. It is not recomputed per candidate.
- Candidates are an ENU grid centred on the observer (default 3 km radius,
  100 m spacing; 50–100 m allowed), skipping points outside the DEM.
- For each candidate the worker evaluates the 1°-bin horizon at the path
  azimuths and counts the fraction of path samples whose elevation is at least
  `horizon + margin` (default margin 2°). Score = clear fraction. Ties sort by
  minimum clearance, then candidate index for reproducibility.
- The worker reports progress 100 times and yields every 120 candidates so
  cancel messages are handled; the main thread can also terminate it.
- A 5 km baseline changes the topocentric direction by
  `atan(5 km / range)`: **27.13″** at the geocentric CA range 38,011 km and
  **29.81″** at the 34,591 km topocentric CA. This is far below the 1° horizon
  bin; edge-of-ridge timing shifts by seconds, not the ranking. The UI reports
  both numbers.
- Measured in the dev harness with the real Brasov DEM, 2,828 cached OSM
  buildings (1 km query) and 2,821 candidates: **4.4 s** in the worker,
  625 path samples. A flat synthetic 2,007 × 2,007 grid with no buildings took
  **3.4 s** for the same candidate count. These are desktop headless numbers;
  phone performance is not yet measured.

### Brasov visible-path sector (Phase 1, airless)

With observer 45.6427°, 25.5887°, 600 m, the physical visibility window
containing the topocentric CA is **2029-04-13 17:32:35 → 22:44:06 UTC**
(625 samples at 30 s). The path covers:

- **azimuth 124.3° → 320.1° clockwise (195.8° span)**
- **elevation 0.0° → 42.29°**, maximum at 20:45:05 UTC
- topocentric CA 21:35:42 UTC; geocentric CA 21:45:03.557 UTC

## 3D scene

- Three.js, metric ENU: +x east, +y up, +z south. Terrain mesh is downsampled
  to at most 512² vertices; building footprints are extruded with ear-clipped
  roofs. Ring winding is normalised by signed area before clipping, so
  clockwise concave OSM footprints (common in practice) still produce a
  complete roof.
- Camera at eye height, pointer-drag look, wheel/pinch FOV, N/E/S/W shortcuts.
- The horizon profile and Apophis trail/marker are drawn on a far dome and
  depth-tested against terrain/buildings, so occlusion is visible rather than
  simulated with a 2D mask. The trail is coloured by the numeric horizon
  comparison, and the marker is red when occluded.
- Clicking a best-spot result moves the local camera and the map to the
  candidate without changing the app-wide observer (a button offers that).

## Attribution / licences

- **Terrain Tiles by Mapzen / AWS Open Data.** Required sources include
  ArcticDEM (DigitalGlobe/NSF), Australia (Geoscience Australia), Austria
  (DGM), Canada (OGL-Canada), Europe (Copernicus EU-DEM), ETOPO1 (NOAA),
  Mexico (INEGI), New Zealand (LINZ), Norway (Kartverket), United Kingdom
  (Environment Agency), and US 3DEP/NED, GMTED2010 and SRTM (USGS).
  <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
- **Buildings:** © OpenStreetMap contributors, ODbL. Overpass API.
- **Map tiles:** © OpenStreetMap contributors.
- Do not add Overture or other live queries.

## Known limitations

- Light pollution, sky brightness, weather and trees are **not modelled**.
  Scores are geometric skyline clearance only.
- Terrain ray distance is limited by the DEM patch (about 7.7 km for the
  default 3 km search). A candidate near the patch edge can under-count a
  distant ridge; the UI warns that rays are limited.
- OSM building heights are incomplete (97% default in the Brasov sample);
  footprints can be stale or missing. Default heights are marked.
- The `visibleIntervalForJump` pass is used, not every dark interval in the
  ±24 h data window. This is intentional: it is the physical window around
  the close approach.
- Horizon rays use nearest-cell sampling and a 0.9-pixel step; the measured
  sub-bin error is documented above (≤0.055° synthetic, 0.127° real DEM).
- Buildings are assumed flat-roofed, no `min_height`/building parts, and roof
  triangulation uses ear clipping without holes.
- DEM tiles are a snapshot of the AWS service; no refresh is scheduled.
