# Phase 2 validation — Apophis Watch

Phase 2 was verified on 2026-11-19 against the frozen Phase 1 ephemeris and a
fresh HYG/ConstellationLines bundle. The independent verifier ran separately;
its report is summarised at the end.

## Automated tests

| Command | Result |
|---|---|
| `npm test` | **58/58 Vitest tests pass** (14 files) |
| `npm run typecheck` | clean |
| `npm run build` | clean; JS 702.89 kB (gzip 188.11 kB), CSS 9.89 kB (gzip 2.72 kB) |
| `npm run test:e2e` | **10/10 Playwright tests pass** at 390×844, Europe/Bucharest |

Covered: projection round-trip and known px positions, DST/local time, frozen
Phase 1 jump targets, size calculations, HYG RA degree checks (Sirius,
Capella, Vega, Polaris; full-sky span), out-of-range clamping, observer
presets/manual input, refraction labelling, drag/wheel/reset, night-mode
colours, space presets, screenshot marker/projection consistency and marker
pixels, 5-minute trail order and frame time.

## Sky screenshots (phone viewport)

All screenshots use Brasov (45.6427°, 25.5887°, 600 m, eye 0) and the default
display refraction. The debug overlay was captured in `*-debug.png` and hidden
for the clean images.

| Shot | UTC | Airless az/el (for Horizons) | Displayed (refracted) az/el | Range | V | Size | Marker px |
|---|---|---|---:|---:|---:|---:|---:|
| `sky-2045.png` | 2029-04-13T20:45:00Z | 213.987057° / 42.289883° | 213.987° / 42.308° | 40,404.2 km | 2.92 | 1.736″ | 143.72, 322.71 |
| `sky-topoca.png` | 2029-04-13T21:35:42Z | 268.858990° / 30.267107° | 268.859° / 30.296° | 34,591.4 km | 3.58 | 2.027″ | 87.81, 261.96 |
| `sky-near-setting.png` | 2029-04-13T22:40:00Z | 317.648022° / 1.376164° | 317.648° / 1.680° | 43,296.0 km | 6.25 | 1.620″ | 74.05, 137.19 |

The Playwright test independently recomputes the stereographic projection from
the debug az/el, centre, horizon radius and canvas size and requires the marker
within **1 px** of the debug pixel; it also samples the marker pixel to prove
something is drawn. It passed for all three shots. The clean images were
inspected manually: N/E/S/W and the horizon are visible; the corrected HYG star
field (Capella, Vega, Arcturus, Procyon, Betelgeuse, Altair) and constellation
lines are in the right parts of the sky; the trail is ordered from rise to
setting; local-time labels are legible; the 5-minute tick strip below the
readout lists every 5-minute tick. Dome labels are thinned to avoid overlap
(4/3/2 labels at these times), and trail labels near the marker or a planet are
suppressed. The complete 5-minute tick list remains in the strip, so the sparse
dome labels do not hide timing information.

## Jump targets and local time

At Brasov 600 m, phase 1 values:

| Target | UTC |
|---|---|
| Topocentric CA | 2029-04-13T21:35:42.000Z |
| Geocentric CA | 2029-04-13T21:45:03.557Z |
| Rise | 2029-04-13T17:15:43.765Z |
| Max elevation | 2029-04-13T20:45:04.939Z |
| Set | 2029-04-13T22:44:06.557Z |
| Visibility start | 2029-04-13T17:32:35.247Z |
| Visibility end | 2029-04-13T22:44:06.557Z |

`21:45:03 UTC` displays as `2029-04-14 00:45:03 EEST` in Europe/Bucharest.
Out-of-range URLs clamp to the ±24 h window end and show an error, never
extrapolate.

## Size comparison at the geocentric CA range (34,803.7 km)

| Object | Physical size | Calculated angular size |
|---|---:|---:|
| Apophis | 340 m | **2.015″** |
| Eiffel Tower | 330 m | 1.956″ |
| ISS array span | 109 m | 0.646″ |
| Football pitch length | 105 m | 0.622″ |
| Moon (if at this distance) | 3,474.8 km | **5.716°** |

All use `2 atan(radius/distance)`. The real Moon is at ~384,400 km and ~0.5°.

## Night mode

`body.night` was sampled after the 120 ms transition:

- body background `rgb(0,0,0)`; panels `rgb(8,0,0)`; buttons/metrics
  `rgb(18,2,2)`; text `rgb(255,138,122)`.
- sky-canvas background pixel < 20 in every channel; sky/space/plot palettes
  are red-only; debug overlay red.
- Screenshots: `sky-night.png`, `night-full.png`, `space-night.png`.

## Performance

Headless Chromium, **4× CPU throttle**, sky view playing at **600×**:

| Metric | Value |
|---|---:|
| Mean rAF interval | **16.88 ms** (16.5–17.1 across runs) |
| p95 | **16.8 ms** (16.7–16.8 across runs) |
| Max | **33.4 ms** (single occasional hitch; other runs 16.8 ms) |
| Frames | 150 |

Caching: star/constellation horizontal positions per simulated minute, trail
per simulated minute, Sun/Moon/planets per 5 simulated minutes, batched canvas
paths, and size-panel updates at ~100 km resolution. This changed the earlier
33 ms p95 to 16.7 ms. This is not a real-phone measurement; WebGL space-view
phone performance remains unmeasured.

## Verifier-driven fixes

The independent verifier caught a blocking star-coordinate bug and two smaller
presentation issues. All were fixed and covered:

- **HYG RA units:** HYG's `ra` column is hours, not degrees. The generator now
  multiplies by 15 for both stars and constellation vertices. A regression test
  pins Sirius 101.287°, Capella 79.172°, Vega 279.234° and Polaris 37.95° and
  requires full-sky RA coverage; the corrected screenshots show the real star
  patterns.
- **Night ruler labels:** Three.js ruler-label sprites are now recoloured in
  `applyPalette`, not just line objects. A Playwright image scan requires fewer
  than 100 blue-dominant pixels in the night space screenshot (currently 0
  around the ruler).
- **Plot/marker disclosure:** the plot is labelled as airless geometric
  elevation, and the readout says the marker glow encodes magnitude rather than
  the 1.7″ physical disc.
- **Label collisions:** trail labels near Apophis or a planet are suppressed;
  body labels have backgrounds and collision avoidance.
- **Jump test independence:** Playwright now uses frozen Phase 1 target strings,
  not a simulation rerun. Max elevation was refined to 20:45:04.939Z (Horizons
  peak ~20:45:05.27Z; 0.33 s).
- **Test strength:** new star-coordinate test, canvas-marker pixel check,
  plot-canvas night pixel check, space-night blue-pixel scan, and a tightened
  p95 <25 ms frame assertion.

## Star / constellation provenance

- Stars: HYG Database v4.4, commit `53e3df3`, **CC BY-SA 4.0**, 1,615 stars
  with V < 5, 183.2 KiB. HYG's `ra` column is hours; the generator multiplies
  by 15. A regression test pins Sirius 101.287°, Capella 79.172°, Vega
  279.234° and Polaris 37.95° and requires full-sky RA coverage. Data file
  remains CC BY-SA 4.0. HYG is partly Hipparcos-derived (ESA CC BY-NC 3.0 IGO).
- Lines: Marc van der Sluys, ConstellationLines v1.4, commit `158ea7c`,
  **CC BY 4.0**, DOI 10.5281/zenodo.23210182, 90 polylines. 9/840 HR vertices
  absent from HYG; lines split there.
- Notices: `public/data/README.md`, `THIRD_PARTY_NOTICES.md`, UI credits.

## Known uncertainties

- The app is suitable for personal/non-commercial use; HYG/Hipparcos commercial
  terms need review.
- The Moon is ~0.2% illuminated during the flyby; its phase icon is a thin
  crescent and can be hard to see.
- Dome labels are deliberately thinned; the complete 5-minute list is in the
  tick strip.
- Frame time is a headless 4× CPU throttle, not a physical mid-range phone.
- Pinch zoom is implemented but not automated; wheel/drag/reset are.
- The space view is true-scale, so Earth is tiny at Moon-orbit framing.
- Independent Phase 2 verifier: **PASS** after the S1 star-RA and N1 night-label
  fixes; fresh Horizons airless checks max **0.0384′** separation, size panel
  exact, night canvases red-only, and all jump targets correct.
