# Event-day guide — 13 April 2029

The in-app **Event day** panel generates this plan from the current observer,
the committed JPL Horizons ephemeris and the Phase 1 visibility window. The
numbers below are the verified Brasov example; do not treat them as universal.
Open the app, choose your spot, and use the panel's own values.

## Before the event

1. **Charge the phone** and bring a power bank. AR, GPS and a bright screen are
   power-hungry; cold batteries drain faster.
2. **Update the app** while online. A new build appears as a reload prompt. Do
   not update in the field.
3. **Install it** (Add to Home Screen / Install). On iOS this is what keeps the
   service worker and IndexedDB data from being deleted after seven days
   without a tap.
4. **Prepare the offline area** for the chosen spot: Local 3D → **Prepare for
   offline**. Wait for “Offline area ready”, then check the About panel for the
   stored ephemeris solution, retrieval date, tile count and building count.
   The app stores ephemeris, stars, AWS Terrarium DEM tiles and OSM building
   footprints. It **does not** store OpenStreetMap raster tiles; the offline
   base map is a local hillshade plus building footprints.
5. **Calibrate AR** on the Moon or a bright planet before it gets dark. Use the
   one-tap alignment and, if needed, the two-tap FOV calibration.
6. **Run the best-spot search** for your area. The ranking is pessimistic:
   default-height buildings are assumed to be 1.5× taller, and the list shows
   the optimistic–pessimistic score range and rank change. Choose a spot, press
   “Make this the observer”, and re-check the Event day panel.
7. **Field-check the top three spots** in daylight or at dusk: record Pass/Fail
   and a note in Local 3D. The app cannot see trees, walls, weather or lights.

## At the site

- Go outside **30–45 minutes early** and let your eyes adapt.
- Confirm the predicted horizon sector; the app's Local 3D view and horizon
  chart are geometric planning aids, not a live camera occlusion system.
- Keep the phone's compass away from magnets, metal railings and car bodies.
  A phone compass is a finder, not a measuring instrument: expect roughly
  5–15° error even after calibration.

## Brasov example (verified computation)

At the Brasov preset (45.6427°, 25.5887°, 600 m ground, 1.7 m eye):

| Quantity | Value |
|---|---|
| Topocentric closest approach | **2029-04-13 21:35:42 UTC** = 2029-04-14 00:35:42 EEST |
| Geocentric closest approach | 2029-04-13 21:45:03.557 UTC |
| Look direction at topocentric CA | **azimuth ≈ 214°, elevation ≈ 42.3°** |
| Visible window (Sun < −6°) | ≈ 17:32 → 22:44 UTC |
| Highest | ≈ 20:45 UTC at 42.29° |
| Path across the sky | az ≈ 124° → 320°, elevation 0° → 42.3° |
| Range at topocentric CA | ≈ 34,800 km |
| True angular size | ≈ 2″ (a point, not a disc) |
| Brightness | roughly second magnitude, an estimate |

The object crosses the sky quickly. It will look like a **moving point of
light**, not a resolved asteroid, a movie-style rock or a long-exposure
streak. The 5-minute trail ticks in the app are there to help you recognise the
motion.

## If something fails

- **Offline but “area not prepared”**: sky and AR still work for the selected
  coordinates, but terrain, buildings and the offline base map are only stored
  for the prepared area. Reconnect and prepare, or move back to the prepared
  area.
- **Storage evicted / “re-prepare”**: Safari can remove site data after seven
  days without interaction if the app is not installed. Add to Home Screen,
  open the app, and prepare again.
- **No camera / no compass**: the AR tab falls back to a black background and
  touch-drag virtual AR. The sky, Local 3D and best-spot views do not need the
  camera.
- **Overpass unavailable**: the app uses a bundled area if one exists, then a
  live mirror, then a manual GeoJSON/Overpass import. If none is available it
  says so and marks the best-spot result incomplete rather than inventing
  buildings.

## After the event

Record your field-check results and notes while they are fresh. The checks are
stored only in this browser; export or copy anything you want to keep.
