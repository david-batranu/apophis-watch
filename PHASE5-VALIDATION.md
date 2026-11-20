# Phase 5 validation — offline PWA, robustness, accessibility

Status: implementation complete; the final independent verifier was run against
commit `3463318`. This file records the measured numbers and the checks that
can be repeated. Verifier findings are appended below.

## Research findings that changed the plan

1. **OSM standard raster tiles cannot be used offline.** The current
   `tile.openstreetmap.org` policy says: “Offline use is not permitted” and
   “Bulk downloading is any pre-emptive fetching of tiles other than those a
   user is actively viewing.” The app therefore never prefetches or stores OSM
   raster tiles. Online they are a viewport-only Leaflet layer. Offline the
   base map is a locally rendered hillshade from cached AWS Terrarium DEM plus
   OSM building footprints.
2. **AWS Terrarium is CC-BY 4.0 and explicit caching is allowed.** The S3
   objects have no `Cache-Control` header, so the app caches decoded tiles in
   IndexedDB deliberately.
3. **Overpass needs multi-mirror, serial, identified clients.** 406 is an
   Apache User-Agent block, 429 asks for ~30 s, 502/504 need 30→60→120 s
   backoff. The build script uses dresel first for Europe/NA, then
   overpass-api.de, mail.ru and private.coffee; the runtime live query uses
   dresel then overpass-api.de. No parallel scripts, no UA rotation.
4. **iOS storage is evictable.** Safari/WebKit applies a 7-day cap to
   script-writable storage (including service workers, Cache API and
   IndexedDB) after no user interaction. Home-screen web apps are exempt.
   `navigator.storage.persist()` is granted heuristically; on iOS installation
   is the reliable path. The app requests persistence, shows whether it was
   granted, warns about eviction, and offers re-prepare.
5. **Hosting:** Cloudflare Pages is recommended (custom `_headers`, native SPA
   fallback, unlimited static bandwidth). GitHub Pages works at a root or
   sub-path but has no custom headers and a soft 100 GB/month limit.

## Commands (final)

| Command | Result |
|---|---|
| `npm test` | **208/208** tests, 32 files |
| `npm run typecheck` | clean (`tsc --noEmit`) |
| `npm run build` | clean; assets below |
| `npm run test:e2e` | **16/16** merged Playwright tests |
| `npm run test:offline` | **1/1** production-build offline test |
| `npx playwright test -c tests/ar/playwright.ar.config.ts` | **12/12** AR mock tests |
| `npm run measure:perf` | see Performance |

## Implemented

- **Prepare for offline** in Local 3D: persistent-storage request, progress,
  cancel, size, prepared date, exact stored-item list, clear button.
- Ephemeris + star catalogue text stored in an IndexedDB snapshot, separate
  from the service-worker precache. A refresh cannot silently replace it.
- AWS Terrarium DEM tiles cached for the prepared area (z14, 81 tiles at the
  default 3 km search / 4 km building radius in Brasov).
- OSM buildings from a bundled 2 km Brasov area (9,979 ways) or one polite
  live Overpass query; manual GeoJSON/Overpass import.
- Offline base map: local hillshade + building footprints. No OSM raster
  prefetch.
- PWA manifest, icons, prompt-based service-worker updates, periodic update
  checks, About/data source/solution/retrieval date/storage status.
- Height-uncertainty best-spot ranking: default 8 m (base), ×1.5 pessimistic,
  ×0.7 optimistic; pessimistic primary ranking, score range, rank spread,
  blocker type, nearest-building distance.
- Field-check Pass/Fail/note panel for the top 3 spots, persisted locally.
- Event-day plan derived from the current session + checklist; `EVENT-DAY.md`.
- i18n extraction to `src/i18n/en.ts`; Romanian `ro-RO` is the default
  date/time/number formatting locale, UI copy remains English.
- Keyboard tabs (arrow keys/Home/End), keyboard sky and local-3D canvases,
  AR virtual-look keys, visible focus, labels, reduced-motion CSS and AR snap.
- Performance instrumentation: `window.__apophisPerf` with per-frame
  `performance.measure` p50/p95/max, renderer detection and memory snapshots;
  `npm run measure:perf`.

## Offline test (Playwright, production build, real service worker)

`npm run test:offline` starts a fresh `vite preview`, prepares a 1 km search
area, reloads online to become service-worker controlled, then disables the
network and reloads.

Verified:

- App shell loads from the service-worker cache; offline line and chip say
  `Offline: ready`.
- Sky readout is computed from the prepared ephemeris.
- Local 3D loads the cached DEM (`81 tiles, 81 cached, 0 network` in the
  default-area manual run) and shows the offline hillshade overlay.
- The prepared snapshot's building radius is used, not a narrower stale cache
  entry.
- Best-spot search completes entirely offline; top results and field-check
  controls render.
- AR mounts with the fake camera and shows Apophis from the prepared
  catalogue/session.
- An unprepared observer URL shows “terrain and buildings are only prepared
  for 45.6427°, 25.5887°” and the DEM badge says “not prepared”; it does not
  fail silently.

Manual full-size preparation at Brasov (3 km search, 4 km buildings) produced:

| Item | Value |
|---|---|
| Snapshot size | 32.5 MB |
| DEM | 81 tiles, z14, 21.2 MB |
| Buildings | 22,107 OSM ways, 20,217 default height, 10.1 MB |
| Ephemeris | 936.7 kB, solution JPL#220, retrieved 2026-11-19 |
| Stars | 187.6 kB |
| Persistent storage | not granted in headless Chromium; warned |
| Offline sky at 20:45 UTC | az 213.987°, el 42.308° |
| Offline AR at 20:45 UTC | Apophis 214.0° / +42.3°, range 40,404 km |

## Service-worker update

Manually verified with a rebuild while the preview server was live:

1. Page controlled by the old worker, no banner.
2. `npm run build` produced new hashed assets and a new `sw.js`.
3. `registration.update()` installed the waiting worker.
4. Banner appeared: “A new version is ready. Reload when convenient; the
   prepared offline area is kept.”
5. Reload activated the new build; banner disappeared; prepared data remained
   in IndexedDB.

`registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`.
`sw.js`/`workbox-*.js` are `no-cache` in `public/_headers`.

## Sub-path deployment

Served `dist/` at `http://127.0.0.1:4180/sub/` with a plain static server:

- service worker scope `http://127.0.0.1:4180/sub/`
- second load controlled
- offline reload served the cached shell
- no absolute-root asset URLs

This exercises the same relative-`base` behaviour used by GitHub Pages
sub-path hosting.

## Bundled area and import

- `npm run fetch:buildings -- --lat=45.6427 --lon=25.5887 --radius=2000
  --name=brasov` fetched 9,979 ways from `ovp.dresel.systems`, 417 tagged,
  9,562 default, OSM timestamp 2026-11-19T21:22:20Z, retrieval
  2026-11-20T12:15:14.819Z. The GeoJSON is 4.6 MB compact.
- A fresh Local 3D load used the bundled area (`source bundled`) and made no
  Overpass request for the building query.
- A manual one-building GeoJSON import produced `source import`, 1 way,
  preserved ODbL attribution and the file name.

## Accessibility

- Tab through the shell: skip link, tabs, controls; visible 2 px focus outline.
- ArrowRight/ArrowLeft/Home/End move and activate tabs; roving tabindex.
- Sky canvas: arrow keys pan, `+`/`-` zoom, `0`/Home reset.
- Local 3D canvas: arrow keys look, `+`/`-` FOV, `0` reset.
- AR canvas: arrow keys pan virtual look and enable touch mode.
- Night contrast: `--muted` raised to `#d05a4a` (5.2:1 on black) from the
  earlier 3.2:1; body text `#ff8a7a` is 9.2:1. Day muted is 5.6:1 on panels.
- `prefers-reduced-motion: reduce` collapses CSS transitions/animations and
  makes AR orientation snap instead of slerp.
- Canvas labels added for sky, local 3D, AR, space and elevation plot; the
  Leaflet container keeps an accessible name.

## Performance

Measured with `npm run measure:perf` on headless Chromium at 390×844 with
**4× CPU throttling**, 12 s per view (playback at 60×), main-thread time from
`performance.measure` around the frame callback (not just the rAF interval):

| View | Frames / 12 s | Mean | p50 | p95 | Max | >20 ms |
|---|---:|---:|---:|---:|---:|---:|
| Sky | 717 | 4.01 ms | 3.6 ms | **5.4 ms** | 24.7 ms | 2 |
| Local 3D | 370 | 3.74 ms | 3.2 ms | **5.3 ms** | 17.8 ms | 0 |
| AR | 720 | 2.23 ms | 1.9 ms | **3.5 ms** | 15.9 ms | 0 |

- The renderer was **SwiftShader** (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader
  Device ...), SwiftShader driver)`), i.e. software rendering. Local 3D is
  GPU-bound in this environment at ~30 fps; disabling antialiasing and using a
  256² terrain mesh raised it from ~10 fps to ~30 fps. On a phone GPU the
  cost is different and is **not measured here**.
- Sky and AR are above 30 fps and have main-thread p95 below 6 ms. Local 3D's
  main-thread p95 is 5.5 ms, but its headless frame count is limited by
  SwiftShader.
- A 10-minute mixed session (sky/local/AR cycled while paused) sampled JS heap
  and listener counts every ~62 s. The first local load creates transient
  geometry (137 MiB at 62 s), after which the session settled at
  **20–22 MiB** with listeners 140–180 (samples at 124/185/247/309/370/432/493 s:
  21.5, 21.8, 21.1, 20.6, 20.2, 21.8, 20.9 MiB). No monotonic growth was
  observed. This is Chromium heap, not a phone memory measurement.
- Best-spot search: 317 candidates × 3 height scenarios in **~2.0 s** on this
  desktop after sharing one terrain horizon and using a building spatial index;
  the default 2,821-candidate search is projected at ~18 s and remains a
  cancellable worker operation, not a frame-loop cost.

These are headless numbers. Thermal throttling, real GPU cost and real battery
drain are on the real-phone checklist.

## Independent verifier findings and fixes

A fresh read-only verifier checked policy compliance, a clean-clone `npm ci`
build, the actual offline flow, PWA update, storage, keyboard/i18n, building
import/scenarios, event day, field checks, deployment and performance. It
found four defects; all were fixed and re-tested:

1. **Event-day path direction included a daylight pass.**
   `eventGuide.ts` filtered only `elevationDeg > 0`; it now requires
   `inVisibilityWindow` and clips to the chosen visibility interval. Brasov now
   reports the visible sector **124.3° → 319.8°**, elevation **0.1° → 42.3°**;
   a new e2e test rejects the old 50.9° start.
2. **Offline reload did not restore the prepared search radius.** With a 1 km
   prepare, the app requested a 3 km search and 81 tiles; only 49 were cached
   and 32 failed. The offline update now adopts the snapshot's search/building
   radius, spacing and margin before loading. The offline test now asserts
   `search-radius = 1000` and **0 failed** DEM tiles.
3. **Snapshot buildings leaked into an unprepared offline location.** The
   terrain tab now clears the grid/3D/horizon/best-spot/building state when the
   observer is outside the prepared area and shows “not prepared” instead of
   the Brasov 9,979-building result. The offline test checks that no 9,979
   building count is shown at an unprepared point.
4. **Two ARIA labels bypassed `en.ts`.** `spaceView.ts` and `elevationPlot.ts`
   now use `shell.spaceCanvasAria` / `shell.plotCanvasAria`; the i18n test also
   scans `setAttribute('aria-label', ...)`.

After the fixes: **208/208** unit tests, **16/16** merged Playwright,
**1/1** offline, **12/12** AR, typecheck/build clean. The verifier’s other
checks passed: no OSM raster prefetch (only 5 viewport tile requests during
prepare), AWS CC-BY caching, Overpass script policy, no fake data, prompt-based
update with unchanged prepared snapshot, sub-path SW scope, and independent
4× performance (Sky p95 5.5 ms, Local 3D p95 5.1 ms, AR p95 3.0 ms; SwiftShader
software renderer).

## Build (final)

| Asset | Raw | Gzip |
|---|---:|---:|
| initial JS | 789.25 kB | 214.18 kB |
| terrain chunk | 287.66 kB | 81.74 kB |
| AR chunk | 79.99 kB | 23.35 kB |
| best-spot worker | 13.63 kB | — |
| CSS (initial/terrain/AR) | 12.91 / 24.12 / 8.03 kB | 3.35 / 8.66 / 2.29 kB |

Service-worker precache: 22 entries, 1,249.52 KiB. Terrain and AR remain
separate lazy chunks; the worker is separate. The worker was 68.7 kB before
the text/scoring split; moving `describeBestSpot` and compass labels out of the
worker path brought it back to 13.6 kB.

## Known limitations / uncertainties

- Offline base map is hillshade + building footprints, not a full street map
  with labels. A Protomaps PMTiles extract is the recommended future upgrade.
- iOS may evict all script-writable storage after 7 days without interaction
  unless installed; persistence is not guaranteed. The app warns and offers
  re-prepare, but cannot prevent eviction.
- A 3 km search + 4 km building snapshot is ~32.5 MB at Brasov; users can
  choose smaller radii. Storage quota varies.
- Live Overpass remains best-effort; 406/502/504 are possible. Bundled areas
  and manual import are fallbacks. No fake building data is written when all
  sources fail.
- Building heights are mostly default; the pessimistic ranking is a
  mitigation, not a survey.
- Offline street tiles are not available by design (OSM policy).
- Headless Chromium performance is not a real-phone result; GPU, thermal and
  battery behaviour need the real-phone checklist. Local 3D ran at ~31 fps
  under SwiftShader (software GPU); it was ~10 fps before disabling
  antialiasing and reducing the terrain mesh to 256². The phone GPU could be
  faster or slower.
- The default 2,821-candidate best-spot search is projected at ~18 s on this
  desktop (317 candidates measured at ~2.0 s). It is a cancellable worker with
  progress, not a frame-loop operation; a phone will be slower.
- The 10-minute memory session was paused to keep tab switching reliable; it
  still exercises mount/unmount, DEM/terrain retention and AR camera teardown.

## Real-phone checks

See `REAL-PHONE-CHECKLIST.md` for the ordered list. The critical unverified
items are trusted HTTPS/installation, iOS storage persistence, real compass
accuracy/drift, real camera FOV/crop, screen-rotation timing, sensor
permissions, thermals/battery, and on-site field checks of the top three spots.
