# Phase 1 validation — Apophis Watch

Generated from the committed data and the independent Horizons truth set.

## Provenance

- Source: **NASA/JPL Horizons**, API 1.2
- Horizons clock: `Thu Nov 19 07:04:49 2026 Pasadena, USA      / Horizons`
- Data retrieved: **2026-11-19T15:04:50.443Z**
- Orbit solution: **JPL#220**
- Target: 99942 Apophis (2004 MN4)
- H = **19.09**, G = **0.24**, equivalent radius = **0.17 km**
- Committed window: JD(TDB) 2462239.395833 … 2462241.416667, 60 s, cubic Hermite

## Time scales

| Quantity | Scale | Usage |
|---|---|---|
| State vectors | TDB | Horizons output, interpolation |
| Civil time / labels | UTC | UI, validation truth |
| Physics time | TT | UTC + 69.184 s in 2029 (37 leap s + 32.184 s) |
| Earth rotation | UT1 ≈ UTC | GAST; residual bounded below |

UTC→TT deliberately does **not** use astronomy-engine's Delta-T prediction. In this epoch that is a TT−UT1 value of about 77 s; using it as TT−UTC would move Apophis by ~59 km. A regression test pins 69.184 s.

## Closest approaches

- **Geocentric** (minimum range from Earth's centre): **2029-04-13T21:45:03.557Z UTC** = JD(TDB) **2462240.407091935**
  - range **38011.3 km** from centre.
  - minimum surface distance **31638.2 km** at **2029-04-13T21:45:02.137Z UTC** = JD(TDB) **2462240.407075498** (WGS84 radius at that sub-point 6373.1 km).
  - Earth-fixed sub-asteroid point: **28.9823°, -43.1041°** (east-positive).
  - derived vs independent 10 s Horizons truth: **0.00 s** time difference.
- **Topocentric, Brasov, Romania**: **2029-04-13T21:35:42.000Z UTC** = JD(TDB) **2462240.400592427**
  - range **34591.4 km**; **-561.6 s** (9.4 min earlier) than the geocentric CA. This is the "jump to closest approach" target.
  - derived vs independent 10 s Horizons observer truth: **0.09 s** time difference.

The commonly quoted "~21:46 UTC" is 56.4 s later than the JPL#220 geocentric minimum derived here; this report uses the derived value, not the quoted one.

## Hermite interpolation check

1455 independent Horizons vectors at +30 s offsets from the 60 s grid:

- maximum position error **0.000448 km** (target < 1 km)
- maximum velocity error **1.43e-5 km/s**

## Topocentric az/el validation

Truth: Horizons OBSERVER table, airless apparent az/el (light-time, stellar aberration, precession/nutation included). Our pipeline uses the same physics plus a WGS84 observer; refraction is off.

| site | epoch (UTC) | az/el error (arcmin) | range error (km) |
|---|---|---:|---:|
| Brasov, Romania | 2029-04-13 09:45:03.557 UTC | 0.031 | 0.004 |
| Brasov, Romania | 2029-04-13 15:45:03.557 UTC | 0.032 | 0.042 |
| Brasov, Romania | 2029-04-13 20:45:03.556 UTC | 0.038 | 0.024 |
| Brasov, Romania | 2029-04-13 21:45:03.557 UTC | 0.033 | 0.040 |
| Brasov, Romania | 2029-04-13 22:45:03.556 UTC | 0.026 | 0.023 |
| Brasov, Romania | 2029-04-14 03:45:03.557 UTC | 0.031 | 0.040 |
| Brasov, Romania | 2029-04-14 09:45:03.557 UTC | 0.033 | 0.000 |
| Cape Town, South Africa | 2029-04-13 09:45:03.557 UTC | 0.041 | 0.016 |
| Cape Town, South Africa | 2029-04-13 15:45:03.557 UTC | 0.044 | 0.068 |
| Cape Town, South Africa | 2029-04-13 20:45:03.556 UTC | 0.050 | 0.023 |
| Cape Town, South Africa | 2029-04-13 21:45:03.557 UTC | 0.040 | 0.056 |
| Cape Town, South Africa | 2029-04-13 22:45:03.556 UTC | 0.032 | 0.041 |
| Cape Town, South Africa | 2029-04-14 03:45:03.557 UTC | 0.041 | 0.057 |
| Cape Town, South Africa | 2029-04-14 09:45:03.557 UTC | 0.044 | 0.009 |
| Teide Observatory, Tenerife | 2029-04-13 09:45:03.557 UTC | 0.034 | 0.041 |
| Teide Observatory, Tenerife | 2029-04-13 15:45:03.557 UTC | 0.035 | 0.042 |
| Teide Observatory, Tenerife | 2029-04-13 20:45:03.556 UTC | 0.043 | 0.022 |
| Teide Observatory, Tenerife | 2029-04-13 21:45:03.557 UTC | 0.040 | 0.030 |
| Teide Observatory, Tenerife | 2029-04-13 22:45:03.556 UTC | 0.030 | 0.050 |
| Teide Observatory, Tenerife | 2029-04-14 03:45:03.557 UTC | 0.034 | 0.027 |
| Teide Observatory, Tenerife | 2029-04-14 09:45:03.557 UTC | 0.037 | 0.041 |
| Longyearbyen, Svalbard | 2029-04-13 09:45:03.557 UTC | 0.008 | 0.001 |
| Longyearbyen, Svalbard | 2029-04-13 15:45:03.557 UTC | 0.008 | 0.003 |
| Longyearbyen, Svalbard | 2029-04-13 20:45:03.556 UTC | 0.008 | 0.005 |
| Longyearbyen, Svalbard | 2029-04-13 21:45:03.557 UTC | 0.008 | 0.003 |
| Longyearbyen, Svalbard | 2029-04-13 22:45:03.556 UTC | 0.006 | 0.001 |
| Longyearbyen, Svalbard | 2029-04-14 03:45:03.557 UTC | 0.008 | 0.002 |
| Longyearbyen, Svalbard | 2029-04-14 09:45:03.557 UTC | 0.008 | 0.000 |
| Honolulu, Hawaii | 2029-04-13 09:45:03.557 UTC | 0.041 | 0.020 |
| Honolulu, Hawaii | 2029-04-13 15:45:03.557 UTC | 0.042 | 0.071 |
| Honolulu, Hawaii | 2029-04-13 20:45:03.556 UTC | 0.039 | 0.017 |
| Honolulu, Hawaii | 2029-04-13 21:45:03.557 UTC | 0.037 | 0.057 |
| Honolulu, Hawaii | 2029-04-13 22:45:03.556 UTC | 0.036 | 0.055 |
| Honolulu, Hawaii | 2029-04-14 03:45:03.557 UTC | 0.040 | 0.069 |
| Honolulu, Hawaii | 2029-04-14 09:45:03.557 UTC | 0.041 | 0.009 |

**Maximum az/el error: 0.050 arcmin (3.01 arcsec). Target < 1 arcmin: PASS.**

Maximum range error: 0.071 km. Maximum H-G magnitude difference where Horizons printed a fractional APmag: 0.0005 mag.

## Visibility windows

- **Brasov, Romania**: 2029-04-13T17:32:35.247Z → 2029-04-13T22:44:06.557Z UTC (above horizon, Sun < −6°).
- **Brasov, Romania**: 2029-04-14T02:50:37.066Z → 2029-04-14T03:02:44.053Z UTC (above horizon, Sun < −6°).
- Max elevation in that dark window: **42.29°** at 2029-04-13T20:45:03.555Z.
- Moon at the reference time: **0.2%** illuminated, 148.6° from Apophis, altitude -25.7°.
- **Longyearbyen, Svalbard**: The Sun never drops below -6°, so there is no dark-sky window. (no valid interval).

## Known residuals and limits

- **UT1−UTC is not known for 2029.** The leap-second system bounds it to |UT1−UTC| < 0.9 s. That is at most 0.9 × 15.041 = **13.54″ (0.226′)** of Earth rotation, and at most **0.42 km** of equatorial observer displacement (≤2.5″ at the 34,800 km flyby range). It is not corrected or hidden with a fudge; the measured worst residual is reported above. The actual 2029 UT1−UTC will be known from IERS EOP data closer to the event.
- Polar motion (<0.5″) is omitted.
- Solar gravitational light deflection is not modelled; it is far below the measured 3″ residual at these elongations.
- The H-G magnitude is an **estimate**: it matches the JPL APmag values in this window to <0.01 mag where Horizons prints fractional values, but real brightness depends on rotation phase and aspect.
- The topocentric closest-approach time is a shallow range minimum: the measured range curvature makes a 0.1 km residual correspond to ~12.2 s. The measured derived-vs-independent difference above is 0.09 s, with a 0.038 km range difference.

## Test command

```
npm test        # 34 tests: time scales, Hermite, WGS84/frames, topocentric, events, magnitude, provenance, UI store
npm run typecheck
```
