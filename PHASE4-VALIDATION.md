# Phase 4 validation — AR mode

Workstream commits `9b4ac06` + `82d4ddc` on `phase4-ar`; merged into main.
Independent AR verifier round 1 found nine issues (landscape screen sign,
remount duplication/touch stranding, stale WMM warning, no true two-point FOV
solve, plus minor precision/lifecycle issues); all were fixed and round 2
returned **PASS** (106/106 units, 12/12 AR Playwright). Two final minor
residuals (sensor-denial cause after remount; sub-degree accuracy text) were
then fixed in `82d4ddc`.

## Commands

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | **48/48 AR tests**, 106 in the worktree; merged suite 162 |
| AR Playwright suite | **12/12 pass** (mock sensors + fake camera) |
| Merged Playwright suite | **12/12 pass**, 390×844, Europe/Bucharest |
| Build | AR code-split chunk 81.59 kB (24.59 kB gzip), CSS 8.03 kB |

## Features verified

- Rear `getUserMedia`; black-background overlay when camera denied/unavailable.
- Absolute orientation (`deviceorientationabsolute` / `absolute`), iOS
  `webkitCompassHeading`/`webkitCompassAccuracy`, screen angles 0/90/180/270.
- WMM declination, manual heading offset/nudges, one-tap alignment on
  Sun/Moon/planet/bright star, **real two-tap FOV solve**, localStorage,
  honest 5–15° pointing error.
- Apophis trail with 5-minute local-time ticks, Sun/Moon/planets, bright stars,
  N/E/S/W, horizon.
- Touch-drag virtual AR; rehearsal 2029; Tonight practice with real
  Sun/Moon/planets and Apophis hidden.
- `?debug=1` raw angles, absolute/compass, declination/status, offsets, FOV,
  quaternion, projected target pixels.

## Independent numerical checks

Declination at Brasov (NOAA WMM2025, independent of `geomagnetism`):

| Date | Module | NOAA WMM2025 | Δ |
|---|---:|---:|---:|
| 2029-04-13 12:00 | 6.71520° | 6.7164° | −0.0012° |
| 2026-11-20 12:00 | 6.54379° | 6.5450° | −0.0012° |
| 2029-11-14 (extrapolated) | 6.75723° | 6.75853° | −0.0013° |
| 2030-01-01 | unsupported | — | labelled unsupported |

Orientation/projection against an independent Three.js camera: all sampled
poses matched to **0.000 px** (max quaternion difference 2.4×10⁻⁶°). The
W3C/chrome landscape case was the defect: the module now uses
`Rz(−screenAngle)`, so top-right with screen 270° gives the correct up vector;
the corrected Playwright screenshot is `ar-04-landscape-270.png`.

Two-point FOV: two tapped targets solve the pinhole focal length from their
known az/el separation; the test changes FOV **60° → 50°** with **1.0 px**
reprojection residual and rejects degenerate/too-close/behind cases.

Screen/overlay movement: mocked headings 269/239/299° put Apophis at
x ≈ 195 / 356 / 32 px, matching the debug projection; night mode is red,
camera-denied remains usable, Tonight uses the real clock and hides Apophis.

## Fixed verifier defects

- Landscape screen rotation sign (180° roll on Chrome/Android) → corrected.
- Root click handler duplicated after remount; touch mode stranded → fixed,
  remount test (`ar-14-remount.png`).
- WMM warning stale/missing after time changes → updates on host time without
  a sensor event; tests 2024-11-01, 2029-11-14, 2030-01-01.
- Heading-only “two-point” flow replaced by real two-point FOV solve.
- Sensor denial reason preserved across remount; debug panel no longer covers
  warnings; accuracy 0/sub-degree text consistent; stale two-point residual
  cleared; async callbacks guarded after unmount; sensor DOM updates throttled.

## Real-phone-only checks

- Actual compass accuracy/drift/interference/figure-eight calibration and
  whether iOS/Android grants absolute orientation in the target build.
- Whether absolute alpha is magnetic or true north; the module assumes
  magnetic and applies WMM (≈ +6.7° at Brasov).
- Real camera FOV/crop/aspect/rolling shutter; the two-tap solver assumes a
  centred pinhole with square pixels.
- Real screen-rotation transition timing and legacy `window.orientation`.
- Sensor rate, smoothing feel, thermal/battery, real frame rate.
- Camera/sensor permission on an untrusted HTTPS certificate (basic-ssl);
  a trusted mkcert certificate is recommended for iPhone.
- No AR terrain occlusion/SLAM.

## Final status

Merged verifier: **PASS**. It independently reproduced the WMM declination
(+6.7153° Brasov 2029; +6.5438° 2026; −27.3820° Cape Town) against a WMM2025
implementation, all orientation poses to <1e-6°, the 270° landscape convention,
heading/pitch signs, and the two-point FOV solve. It also confirmed the AR
camera track ends on tab leave and measured 16.667 ms mean / 16.70 ms p95 at
4× CPU throttle. Remaining items are real-phone-only checks listed above.
