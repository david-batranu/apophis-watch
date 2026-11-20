# Real-phone test checklist

Ordered by importance. Headless Chromium and desktop Playwright cannot certify
these. Do this on the actual phone/browser you will use on event day.

## 1. Trusted HTTPS and installation

- [ ] Open the deployed HTTPS URL, not an IP with a self-signed certificate.
- [ ] Install / Add to Home Screen. Launch from the home-screen icon.
- [ ] Grant camera and Motion & Orientation access. On iOS the motion prompt
      must follow a user gesture.
- [ ] Confirm `navigator.storage.persisted()` is true (About panel) after
      preparation. If it is false, the OS may evict data.

## 2. Offline preparation and airplane mode

- [ ] Online: Local 3D → Prepare for offline. Wait for “Offline area ready”.
- [ ] About panel shows the ephemeris solution ID, retrieval date, prepared
      date, tile count, building count and size.
- [ ] Enable airplane mode, force-quit the app, relaunch from the home screen.
- [ ] Sky view loads the prepared ephemeris and stars.
- [ ] Local 3D loads cached DEM, shows the offline hillshade + building
      footprints, and runs a best-spot search.
- [ ] AR opens with the fake/real camera; the overlay and trail are present.
- [ ] Change the URL/observer to an unprepared location offline: the app says
      terrain is not prepared and does not silently fail.
- [ ] Clear the prepared area, confirm the status says not prepared, then
      re-prepare.

## 3. Compass calibration and accuracy

- [ ] Figure-eight calibrate the compass; compare N/E/S/W with a known landmark.
- [ ] Note absolute vs relative heading and the reported accuracy.
- [ ] Walk near a car, railing and building; see how the heading drifts.
- [ ] Confirm the app's declared 5–15° pointing error is believable; do not
      use it as a measuring instrument.

## 4. AR alignment and camera

- [ ] One-tap align on the Moon, a bright planet, or a star during rehearsal.
- [ ] Two-tap FOV calibration on two objects at least 5° apart; check the
      residual (pixels/degrees) and that it persists after reload.
- [ ] Manual heading nudges and offset persist.
- [ ] Deny camera: black-background overlay remains usable.
- [ ] Deny motion: touch-drag virtual AR works; the cause is still shown after
      unmount/remount.
- [ ] Portrait ↔ landscape: horizon stays level, cardinals are not mirrored,
      the screen-angle convention matches the phone.
- [ ] Check the real camera's FOV/crop/aspect; the two-tap solver assumes a
      centred pinhole.

## 5. Event-day rehearsal and Tonight practice

- [ ] Jump to topocentric CA, max elevation, rise, set, visibility start/end.
- [ ] Rehearse 2029 with the host clock and 600× playback.
- [ ] Tonight practice uses the real Sun/Moon/planets and hides Apophis.
- [ ] Check the Event day panel's direction/time against the sky.

## 6. Local 3D, best spot and field check

- [ ] DEM loads and the ground elevation matches the map/terrain.
- [ ] Buildings load from a bundled area, a live mirror, or a manual import.
- [ ] Best-spot search shows pessimistic scores, score range, rank change,
      blocker type and nearest-building distance.
- [ ] Top three spots show a field-check Pass/Fail control and notes persist
      after reload.
- [ ] Field-check the top three on site: predicted obstruction vs what you see.
- [ ] Dark night mode: map, horizon chart, 3D canvas, AR and all text are
      red-on-black with readable contrast.

## 7. Performance, memory and power

- [ ] Record real frame rate and main-thread time in Sky, Local 3D and AR.
- [ ] Watch memory over a 10-minute session with tab switches.
- [ ] Check thermal throttling, battery drain and screen brightness.
- [ ] Confirm terrain/AR chunks still load only when their tabs open (network
      panel or bundle inspector).

## 8. Accessibility on the phone

- [ ] Keyboard/switch access: Tab through every control, visible focus, no
      traps; arrow keys work on the sky canvas and tabs.
- [ ] Screen reader labels for the map, AR canvas, time scrub and controls.
- [ ] Reduced-motion setting: transitions/animations are suppressed.
- [ ] Night-mode contrast is still adequate.

## 9. Known limits to verify, not fix in the field

- No AR terrain occlusion/SLAM.
- No trees, weather, light pollution or distant ridges beyond the DEM patch.
- OSM building heights are often default; the pessimistic ranking is the
  mitigation, not a survey.
- A phone compass is a finder, not a theodolite.
