/**
 * English copy for the whole UI.
 *
 * This is the single source of user-visible text. Keys are nested and typed;
 * `t()` in `./index.ts` resolves dotted paths and fills `{placeholders}`.
 * HTML fragments that are inserted with innerHTML keep their entities
 * (`&amp;`, `&lt;`) exactly as the browser renders them today.
 */
export const en = {
  meta: {
    title: 'Apophis Watch',
    description:
      'Apophis Watch — simulate the 2029 close approach from anywhere on Earth.',
  },

  time: {
    utcSuffix: 'UTC',
  },

  jump: {
    topocentricCa: 'Closest to you',
    geocentricCa: 'Closest to Earth',
    rise: 'Rises',
    set: 'Sets',
    maxElevation: 'Highest',
    visibilityStart: 'Visible from',
    visibilityEnd: 'Visible until',
  },

  shell: {
    brandName: 'APOPHIS WATCH',
    brandSubtitle: '(99942) Apophis · 13 April 2029',
    skipToContent: 'Skip to main content',
    locationFallback: 'Location',
    locationChange: 'Change observing location',
    locationChipAria: 'Location: {label}. Change location.',
    locationCoordinates: '{lat}°, {lon}°',
    locationPresetLabel: '{name} · {lat}°, {lon}°',
    locationBrowser: 'My location',
    locationPreview: 'Brasov preview',
    locationOffline: 'Offline area',
    shareButton: 'Share',
    shareAria: 'Share this view',
    shareText: 'Apophis Watch — 13 April 2029 · {time}',
    shareCopied: 'Link copied to the clipboard.',
    shareFailed: 'Could not copy the link.',
    dockCa: 'Closest',
    dockCaAria: 'Jump to closest approach',
    dockUtc: '{utc} UTC',
    dockLocal: '{local} local',
    playAria: 'Play',
    pauseAria: 'Pause',
    offlineChipAria: 'Offline status and preparation',
    offlineSaveArea: 'Save offline area',
    offlineChecking: 'Offline: checking…',
    nightModeButton: 'Night mode',
    nightModeOn: 'Night mode: on',
    nightModeOff: 'Night mode: off',
    tabsAria: 'View',
    tabSky: 'Sky view',
    tabSpace: 'Space view',
    tabLocal: 'Local 3D',
    tabAr: 'AR',
    dataWindowPlaceholder: 'Available time: —',
    dataWindowValue: '{start} → {end} UTC',
    skyAria: 'Sky dome map',
    skyCanvasAria:
      'Sky dome. Drag or use arrow keys to look; plus and minus zoom; zero resets.',
    spaceCanvasAria:
      'Space view: Apophis, Earth and Moon to scale, with the edge of space (100 km) and the satellite limit (geostationary orbit) marked. Camera preset buttons are beside the view.',
    plotCanvasAria:
      'Height and brightness of Apophis over time. The same values are in the live readout.',
    skyHint: 'Drag to look · pinch/scroll to zoom · double-click reset',
    badgeRefracted: 'light bent (display)',
    spaceCameraEarth: 'Earth',
    spaceCameraFlyby: 'Flyby',
    spaceCameraMoon: 'Moon orbit',
    spaceCameraTop: 'Top-down',
    spaceResetCameras: 'Reset cameras',
    spaceLegendScale:
      '1 scene unit = 1,000 km · Earth radius 6,378 km · Moon orbit 384,400 km',
    spaceLegendBoundaries:
      'Edge of space (Kármán line): 100 km above Earth · Satellite limit: geostationary orbit, 35,786 km above Earth',
    spaceLegendTrueScale:
      'Apophis is a true-scale point; its 340 m disc is invisible at this scale.',
    readoutTitle: 'Right now',
    metricAzimuth: 'Direction',
    metricElevation: 'Height in sky',
    metricRange: 'Distance',
    metricRate: 'How fast it moves',
    metricMagnitude: 'Brightness',
    metricSize: 'Apparent size',
    metricMoonSeparation: 'Distance from Moon',
    metricVisibility: 'Can you see it?',
    timeTitle: 'Time',
    play: '▶ Play',
    pause: '⏸ Pause',
    speed: 'Speed',
    scrubAria: 'Time slider',
    localClock: '{label} {zone} ({iana})',
    plotTitle: 'Height and brightness over time',
    plotCaption:
      'Orange: how high Apophis is above the horizon. Blue: how bright it is (higher on the chart is brighter). Shaded: the sky is dark enough to see it. Dashed: the height you set as easy to see.',
    sizeTitle: 'How big will it look?',
    displayTitle: 'Display',
    displayRefraction: 'Bend light near the horizon (display only)',
    displayConstellations: 'Constellation lines',
    displayEnlarged: 'Enlarge the marker',
    displayEnlargedBadge: 'not to scale',
    displayNightMode: 'Night mode (red)',
    displayMinGoodLabel: 'Highlight above this height: ',
    displayMinGoodNote:
      'This only changes the highlight. Visibility is still based on the horizon and on how dark the sky is.',
    aboutSummary: 'About, data, offline storage &amp; licences',
    aboutBuildTitle: 'Build &amp; data source',
    aboutOfflineTitle: 'Prepared offline area',
    aboutAreasTitle: 'Bundled building areas',
    checkUpdates: 'Check for updates',
    aboutNotPrepared: 'Not saved.',
    storageNotChecked: 'Storage status not checked yet.',
    checking: 'Checking…',
    footerNote:
      'Positions are calculated from NASA/JPL data in your browser. This is a planning simulation, not a live feed. Offline maps use stored terrain data; OpenStreetMap street tiles are not downloaded in bulk.',
    pwaUpdateReady:
      'A new version is ready. Reload when convenient; the prepared offline area is kept.',
    pwaOfflineReady:
      'App saved for offline use. You can save terrain for a chosen area later in Local 3D.',
    pwaServiceWorkerError: 'Service worker: {error}',
    pwaChecking: 'Checking for a new build…',
    pwaNewBuildReady: 'A new build is ready; use Reload in the banner.',
    pwaNoUpdate: 'No update found (or the browser is offline).',
    pwaReload: 'Reload',
    pwaGotIt: 'Got it',
    pwaLater: 'Later',
    offlineAreaNotPrepared: 'Offline: area not saved',
    offlineReady: 'Offline: ready',
    offlinePrepared: 'Offline: saved',
    offlineNotPrepared: 'Offline: area not saved',
    offlineMode: 'Offline mode.',
    refractionSubRefracted: 'light bent near the horizon',
    refractionSubAirless: 'straight line of sight',
    rangeSub: '{ratio} × Moon distance',
    rateValue: '{rate}° per minute',
    magnitudeValue: '{magnitude} (estimated)',
    magnitudeSub: 'lower numbers are brighter',
    sizeSub: 'how wide it looks',
    viewBelow: 'Below the horizon',
    viewInWindow: 'Visible now',
    viewNotDark: 'Up, but the sky is too bright',
    viewSubPhase1: 'Sun at least 6° below the horizon',
    viewSubNotMet: 'Sun is still too high',
    viewSubBelow: 'It is below the horizon now',
    badgeDisplayRefracted: 'light bent (display)',
    badgeAirless: 'straight line',
    badgeVisibilityBelow: 'below horizon',
    badgeVisibilityVisible: 'visible · sky dark enough',
    badgeVisibilityNotDark: 'up · sky too bright',
    readoutNoteRefracted:
      'Direction and height are adjusted for air bending near the horizon. Distance, speed and size are direct calculations. Brightness is an estimate. The glow shows brightness, not the real 1.7″ size.',
    readoutNoteAirless:
      'Direction and height use a straight line of sight. Distance, speed and size are direct calculations. Brightness is an estimate. The glow shows brightness, not the real 1.7″ size.',
    trailTicksTitle: 'Trail times (local):',
    trailTicksNone:
      'No trail times above the horizon in this ±3 h window.',
    sizeBadge: 'Apophis {arcsec}″',
    sizeAtRange: 'at {range}',
    sizeTableObject: 'Object',
    sizeTableAngular: 'How wide',
    sizeTableVsApophis: 'vs Apophis',
    sizeObjectMoon: 'Moon',
    sizeObjectApophis: 'Apophis',
    sizeObjectEiffel: 'Eiffel Tower (height)',
    sizeObjectFootball: 'Football pitch (length)',
    sizeObjectIss: 'ISS (solar-array span)',
    sizeNote:
      'Apophis is only {arcsec}″ wide here — a point of light, not a disc. The Moon is shown as if it were at Apophis’ distance, so the comparison is fair; its real distance is much farther away. The dashed marker is enlarged and labelled “not to scale”.',
    presetBrasov: 'Brasov, Romania',
    presetCapeTown: 'Cape Town, South Africa',
    presetTenerife: 'Teide Observatory, Tenerife',
    presetLongyearbyen: 'Longyearbyen, Svalbard',
    enterCoordinates: 'Enter both latitude and longitude, or choose a preset.',
    terrainLoadFailed: 'Terrain failed to load: {error}',
    arLoadFailed: 'AR failed to load: {error}',
    aboutBuild:
      '<p><strong>App</strong> v{version} · built {buildDate}</p>\n      <p><strong>Ephemeris</strong> {provider} · solution <strong>{solution}</strong> · retrieved <strong>{retrieved}</strong></p>\n      <p><strong>This session is using</strong> {activeSource}.{queryLink}</p>\n      <p><strong>Stars</strong> HYG Database v4.4 (CC BY-SA 4.0) · WMM2025 (NOAA/NCEI + BGS) · astronomy-engine (MIT).</p>',
    aboutActivePrepared: 'the prepared offline snapshot',
    aboutActiveBuiltIn: 'the built-in data file',
    aboutQueryLink: ' <a href="{url}">Exact Horizons query</a>.',
    aboutDevelopment: 'development',
    aboutOfflineNone:
      '<p>No offline area is saved. Open <strong>Local 3D</strong> and press <strong>Save this area offline</strong>.</p>',
    aboutOfflinePresent:
      '<p><strong>Saved</strong> {prepared} · {bytes}</p>\n        <p><strong>Area</strong> {area} · search radius {searchRadius} m · buildings within {buildingRadius} m</p>\n        <p><strong>Sky data</strong> retrieved {retrieved} · {ephemerisBytes}</p>\n        <p><strong>Stars</strong> {stars}</p>\n        <p><strong>Terrain</strong> {tileCount} terrain tiles · {terrainBytes} · {attribution}</p>\n        <p><strong>Buildings</strong> {buildings}</p>\n        <p><strong>Map</strong> {baseMapNote}</p>\n        {warnings}\n        <p><strong>Data source</strong> {provider} · solution {solution}.</p>',
    aboutStarsValue: '{source} · {bytes}',
    aboutNotStored: 'not stored',
    aboutBuildingsValue:
      '{count} buildings · {defaultCount} with estimated height · {bytes} · {source}{sourceLabel} · retrieved {retrieved}',
    aboutBuildingsMissing:
      'not saved (clear-spot scores marked incomplete)',
    aboutSourceLabel: ' ({label})',
    aboutWarnings: '<p class="status-line warn">{warnings}</p>',
    aboutStorageUnsupported:
      'Storage API is unavailable in this browser; offline data cannot be inspected.',
    aboutStorageSupported:
      '{persistence} · used {used} · quota {quota}. On iOS, Add to Home Screen and open the app at least once a week to avoid the 7-day eviction rule.',
    aboutPersistentGranted: 'persistent storage granted',
    aboutBestEffort: 'best-effort storage (may be evicted)',
    aboutUsageUnknown: 'usage unknown',
    aboutQuotaUnknown: 'quota unknown',
    aboutAreasNone:
      '<p>No bundled building areas. Use <code>npm run fetch:buildings</code> at build time, or import a GeoJSON/Overpass file in Local 3D.</p>',
    aboutAreasError:
      '<p>No bundled building manifest is available (offline or not built). Live Overpass and manual import remain available.</p>',
    aboutAreaFallback: 'Area',
    aboutAreaItem:
      '<li><strong>{name}</strong> · {lat}°, {lon}° · r={radius} m · {count} buildings · retrieved {retrieved}{source}{endpoint}{query}{license}</li>',
    aboutAreaSource: ' · {source}',
    aboutAreaEndpoint: ' · endpoint {endpoint}',
    aboutAreaQuery: ' · query <code>{query}</code>',
    aboutAreaLicense: ' · {license}',
    creditsBlock: `<strong>Ephemeris:</strong> NASA/JPL Horizons, solution JPL#220, retrieved 2026-11-19. H=19.09, G=0.24, radius 0.170 km.
      <br /><strong>Astronomy engine:</strong> astronomy-engine (MIT) for Sun/Moon/planets, sidereal time and precession/nutation.
      {starCredit}{constellationCredit}
      <br /><strong>Star data licence:</strong> HYG Database v4.4, David Nash / Astronomy Nexus, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; the derived <code>stars.json</code> remains CC BY-SA 4.0. HYG is partly Hipparcos-derived; ESA’s Hipparcos data is CC BY-NC 3.0 IGO — review before any commercial use.
      <br /><strong>Line data licence:</strong> Marc van der Sluys, ConstellationLines v1.4, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · <a href="https://doi.org/10.5281/zenodo.23210182">DOI 10.5281/zenodo.23210182</a>.
      <br /><strong>Full notices:</strong> <a href="./data/README.md">star catalogue</a>, <a href="./data/TERRAIN.md">terrain/buildings</a> and THIRD_PARTY_NOTICES.md.
      <br /><strong>AR compass:</strong> WMM2025 from NOAA/NCEI and BGS, via geomagnetism (Apache-2.0). Extrapolated/unsupported dates are labelled in AR.
      <br /><strong>Terrain:</strong> Terrain Tiles by Mapzen / AWS Open Data (includes Copernicus EU-DEM, USGS 3DEP/SRTM/GMTED2010, NOAA ETOPO1 and other national sources; see <a href="./data/TERRAIN.md">terrain attribution</a>).
      <br /><strong>Buildings &amp; map:</strong> © OpenStreetMap contributors, ODbL; Overpass API; Leaflet (BSD-2-Clause). Light pollution, weather and trees are not modelled.
      <br /><strong>Size figures:</strong> Moon 3,474.8 km (NASA Moon Fact Sheet); ISS 109 m array span (NASA); football pitch 105 m (FIFA/IFAB); Eiffel Tower 330 m (official Eiffel Tower figures); Apophis 340 m (Horizons 2 × 0.170 km).
      <br /><strong>Accuracy:</strong> Phase 1 topocentric az/el max error 0.050 arcmin (3.01″) against Horizons; see PHASE1-VALIDATION.md. This view is a planning simulation, not a live feed.
      <br /><strong>Refraction:</strong> Bennett display-only correction; the validation path is airless.`,
    creditsStars:
      '<br /><strong>Stars:</strong> {source} · {license} · {attribution}',
    creditsStarsUnavailable:
      '<br /><strong>Stars:</strong> catalogue unavailable; sky still works without it.',
    creditsConstellations:
      '<br /><strong>Constellation lines:</strong> {source} · {license}',
    creditsSeeSource: 'see source',
  },

  event: {
    title: 'Event day',
    subtitle:
      'A short plan based on your location, the sky data and when Apophis is visible.',
    badge: '13 April 2029',
    yourPlan: 'Your plan',
    checklist: 'Checklist',
    waitingSession: 'Preparing the simulation…',
    footer:
      'The object is a point of light. The marker is enlarged only when you turn on “Enlarge the marker”; the real apparent size is shown below.',
    waitingObserver: 'Waiting for the sky data and your location.',
    noWindowFallback:
      'Apophis is not visible from this location during the pass.',
    chooseAnother:
      'Try another location, or check whether the Sun or Moon is in the way.',
    spotNote:
      'Run the clear-spot search in Local 3D, tap a result and press “Use this spot” to make this plan specific to that place.',
    plan:
      '<dl class="event-plan-list">\n        <dt>Location</dt>\n        <dd>{location}</dd>\n        <dt>Closest approach</dt>\n        <dd><strong>{caUtc}</strong> · {caLocal} · distance {range} km</dd>\n        <dt>Look at closest approach</dt>\n        <dd><strong>{azimuth}° ({compass})</strong>, height <strong>{elevation}°</strong></dd>\n        <dt>Visible</dt>\n        <dd>{window}</dd>\n        <dt>Highest in sky</dt>\n        <dd>{highest}</dd>\n        <dt>Direction</dt>\n        <dd>{direction}</dd>\n        <dt>What you will see</dt>\n        <dd>{what}</dd>\n        <dt>Spot</dt>\n        <dd>{spot}</dd>\n      </dl>',
    locationLine: '{lat}°, {lon}° · ground {ground} · eye {eye} m',
    groundUnknown: 'unknown',
    visibleWindow: '{start} → {end}',
    highest: '{time} ({local}) at {elevation}°',
    pathDirection: '{direction} · height {min}° → {max}°',
    whatYouSee:
      'A fast-moving point of light (brightness {magnitude}, apparent size {size}″). It will not look like a disc or a movie asteroid; its motion is the giveaway.',
    checklistItems: {
      charge: {
        label: 'Charge the phone and bring a power bank',
        detail: 'Cold batteries drain faster; AR and GPS use a lot of power.',
      },
      update: {
        label: 'Update the app and open it once while online',
        detail:
          'A new build is offered as a reload prompt; do not update in the field.',
      },
      install: {
        label: 'Install the app / Add to Home Screen',
        detail:
          'On iPhone/iPad, this stops Safari from deleting offline data after 7 days without opening it.',
      },
      prepare: {
        label: 'Save the offline area for your chosen spot',
        detail:
          'Local 3D → Save this area offline. Wait for “Offline area ready”.',
      },
      calibrate: {
        label: 'Line up AR using the Moon or a bright planet',
        detail:
          'Do this before it gets dark, while the object is easy to find.',
      },
      early: {
        label: 'Go outside at least 30–45 minutes early',
        detail: 'Let your eyes adapt and confirm the horizon is clear.',
      },
      direction: {
        label: 'Check the predicted direction and time below',
        detail:
          'Use the compass rose and the Local 3D horizon to find the sector.',
      },
      expectation: {
        label: 'Expect a fast-moving point of light, not a disc',
        detail:
          'It will look like a moving star, not a disc; the motion is the giveaway.',
      },
    },
  },

  plot: {
    goodThreshold: 'easy to see above {degrees}°',
    axisElevation: 'Height',
    axisMagnitude: 'Brightness',
  },

  terrain: {
    headerTitle: 'Your view, terrain &amp; clear spots',
    headerIntro:
      'See what blocks the view from your spot, and find a place with a clearer horizon.',
    badgeDem: 'Terrain: —',
    badgeBuildings: 'Buildings: —',
    badgeDemNotPrepared: 'Terrain: not saved',
    offlineTerrainNotPrepared:
      'Offline: terrain was not saved for this location. Sky and AR still work. Reconnect or move to the saved area.',
    buildingsOfflineStatus:
      'Offline: no building data covers this view. Clear-spot scores will be marked incomplete. Reconnect or import a file.',
    statusReady: 'Ready. Pick a point on the map or use your location.',
    observerTitle: 'Your location &amp; map',
    observerIntro:
      'Use your current location, choose a quick place, or tap the map. This sets the sky, times and what blocks your view.',
    observerMapAria: 'OpenStreetMap location picker',
    observerPreset: 'Quick choice',
    observerPresetCustom: 'Custom / map point',
    observerUseLocation: 'Use my location',
    observerStatusIdle: 'Choose a location to update the sky and horizon.',
    observerLocating: 'Finding your location…',
    observerLocationFailed:
      'Could not get your location. Check the browser permission or pick a point on the map.',
    observerLocationUnavailable:
      'This browser cannot provide your location. Pick a point on the map or enter coordinates.',
    observerDetails: 'How heights and coordinates are calculated',
    observerMethod:
      'Ground height comes from terrain data. Eye height is added on top. On a floor, we assume 3 m per floor; on a roof, we use the tallest nearby building. Phone GPS height is never used.',
    observerLat: 'Latitude °',
    observerLon: 'Longitude °',
    observerApply: 'Use this point',
    observerRecenter: 'Show on map',
    eyeHeight: 'Your eye height (m)',
    eyeMode: 'Where you are standing',
    eyeModeGround: 'On the ground',
    eyeModeFloor: 'In a building, on a floor',
    eyeModeRooftop: 'On the roof',
    eyeFloor: 'Floor number',
    eyeNoteInitial:
      'We add your eye height to the ground height. On a floor, we assume 3 m per floor. On a roof, we use the tallest nearby building.',
    groundWaiting: 'Ground height: waiting for terrain data.',
    groundNote:
      'Ground height comes from terrain data for this point. Phone GPS height is not used.',
    demTitle: 'Terrain &amp; buildings',
    demNotLoaded: 'Terrain: not loaded.',
    demReload: 'Reload terrain',
    demClearCache: 'Clear terrain cache',
    demDetailIdle: 'Terrain data is cached in this browser.',
    buildingsNotLoaded: 'Buildings: not loaded.',
    buildingsFetch: 'Load buildings',
    buildingsClearCache: 'Clear building cache',
    buildingsRadius: 'Buildings within (m)',
    buildingsImportLabel: 'Import a building file',
    buildingsImportIdle:
      'Optional: import building outlines exported from OpenStreetMap or another tool. Map data © OpenStreetMap contributors.',
    buildingsDetailIdle:
      'Buildings are loaded once for the area you are viewing.',
    creditsTerrain:
      '<strong>Terrain:</strong> Terrain Tiles by Mapzen / AWS Open Data. Sources include Copernicus EU-DEM, USGS 3DEP/NED, GMTED2010 and SRTM, NOAA ETOPO1, ArcticDEM (DigitalGlobe/NSF), Geoscience Australia, Austria DGM, Canada OGL, INEGI Mexico, LINZ New Zealand, Kartverket Norway and the UK Environment Agency. <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Full attribution</a>.',
    creditsBuildings:
      '<strong>Buildings:</strong> © OpenStreetMap contributors, ODbL. Overpass API.',
    creditsHeightPriority:
      '<strong>Height priority:</strong> <code>building:height</code> → <code>height</code> → <code>building:levels</code>×3 → 8 m default.',
    sceneTitle: 'View from your spot',
    sceneSubtitle: 'at eye height',
    sceneAria: 'Local 3D terrain and building view',
    sceneLook: 'Look at Apophis',
    sceneNavN: 'N',
    sceneNavE: 'E',
    sceneNavS: 'S',
    sceneNavW: 'W',
    sceneFov: 'Field of view',
    sceneTime: 'Time',
    sceneTimeAria: 'Time slider',
    timeLabelLocal: '{utc}Z · {local} local',
    sceneHint:
      'Drag to look around; scroll or pinch to zoom. Terrain and buildings block the view where they are higher than the line to Apophis.',
    sceneNote:
      'This shows whether the ground or buildings block the view. Light pollution, weather, haze and trees are not included.',
    horizonTitle: 'Horizon around you',
    horizonSubtitle: 'how high the skyline is',
    horizonAria: 'How high the skyline is in each direction',
    horizonEmpty: 'Load terrain data to see the local horizon.',
    pathWaiting: 'Path: waiting for the simulation.',
    parallaxWaiting: 'Distance check: —',
    bestTitle: 'Find a clear spot',
    bestSubtitle: 'checks the view around you',
    bestSearchRadius: 'Search radius (m)',
    bestSpacing: 'Grid spacing (m)',
    bestMargin: 'Extra height above the horizon (°)',
    bestRun: 'Search this area',
    bestCancel: 'Cancel',
    bestStatusIdle:
      'No search yet. The score is the share of the pass that would be above the local skyline, with the extra margin you set.',
    bestHeatmapNote:
      'Red means the view is blocked; green means it is clear. Tap a numbered result to look from that spot on the map and in 3D. It does not change your main location unless you choose “Use this spot”.',
    bestDisclaimer:
      'This only checks whether terrain or buildings block the view. Light pollution, weather, haze and trees are not included. Building heights from OpenStreetMap may be missing or out of date; estimated heights are shown in amber in 3D.',
    offlineTitle: 'Offline',
    offlineSubtitle: 'save this area for later',
    offlineStatusNone: 'No offline area saved.',
    offlinePrepare: 'Save this area offline',
    offlineCancel: 'Cancel',
    offlineClear: 'Delete saved area',
    offlineStoragePending: 'Checking storage…',
    offlineStoredNote:
      '<strong>Saved for offline use:</strong> sky data, stars, terrain and building outlines for this area. <strong>Not saved:</strong> OpenStreetMap street tiles, because their service does not allow bulk downloads. The offline map is a simple shaded terrain map with building outlines. On iPhone/iPad, add the app to your Home Screen and open it at least once a week so Safari does not delete the data.',
    footerMethod:
      '<strong>How this works:</strong> terrain data builds a local 3D skyline, OpenStreetMap buildings are added, and the horizon is checked in every direction. Light pollution, weather and trees are not included.',
    footerLicences:
      '<strong>Data licences:</strong> Terrain Tiles by Mapzen / AWS Open Data · © OpenStreetMap contributors (ODbL) · Overpass API. See the project notices for full attribution.',
    footerBuildInfo:
      'Terrain view · terrain, buildings, horizon, clear-spot search, 3D',
    fieldCheckTitle: 'Field check — top 3 spots',
    fieldCheckNote:
      'Record what you actually see on site. Stored only in this browser.',
    fieldCheckGroupAria: 'Field check result for spot {rank}',
    fieldCheckPass: 'Pass',
    fieldCheckFail: 'Fail',
    fieldCheckNotChecked: 'not checked',
    fieldCheckNoteLabel: 'Note',
    fieldCheckNotePlaceholder: 'e.g. ridge confirmed, trees blocked the view',
    fieldCheckEmpty:
      'Run a best-spot search to field-check the top 3 spots.',
    fieldCheckItemTitle: '#{rank} · {lat}°, {lon}°',
    invalidateBuildingRadius:
      'Building distance changed; run the search again.',
    invalidateSearchRadius: 'Search area changed; run the search again.',
    invalidateSpacing: 'Search detail changed; run the search again.',
    invalidateMargin: 'Height margin changed; run the search again.',
    invalidateObserver: 'Location changed; run the search again.',
    invalidateEyeHeight: 'Eye height changed; run the search again.',
    invalidateBuildingsUpdated: 'Buildings updated; run the search again.',
    invalidateBuildingsImported: 'Buildings imported; run the search again.',
    observerMissing:
      'Choose a location first. Enter coordinates or pick a point on the map.',
    badgeDemLoading: 'Terrain: loading…',
    observerErrorLat: 'Latitude must be between −90° and +90°.',
    observerErrorLon: 'Longitude must be between −180° and +180°.',
    eyeErrorRooftopNoBuildings:
      'Roof height needs building data. Load buildings first.',
    eyeErrorRooftopNoFootprint:
      'There is no building outline at this point, so roof height is unavailable. Using ground level instead.',
    eyeRooftopDetail:
      'The tallest nearby building here is {height} m high.',
    eyeDefaultHeight: 'estimated height',
    eyeNoteFloor:
      'Floor {floor}: your eye is {height} above the ground.',
    eyeNoteRooftop: 'Roof: your eye is {height} above the ground.',
    eyeNoteGround: 'Your eye is {height} above the ground.',
    eyeNoteSuffix:
      'For a floor, we assume 3 m per floor; for a roof, we use the tallest nearby building.',
    eyeNoteCombined: '{base} {extra} {suffix}',
    statusDemLoading: 'Loading terrain around {lat}°, {lon}°…',
    statusDemReady:
      'Terrain ready: {spacing} m per pixel, {tiles} tiles. Ground height {ground}.',
    unknown: 'unknown',
    statusHostDemReady: 'Terrain loaded at {spacing} m per pixel.',
    statusDemFailed:
      'Terrain could not load: {message}. Check your connection and try again.',
    badgeDemFailed: 'Terrain: failed',
    badgeDemProgress: 'Terrain: {loaded}/{total}',
    groundUnknown:
      'Ground height is unknown until terrain loads. Phone GPS height is not used.',
    groundMismatch:
      'Ground height: {local} for the 3D view, {shared} for the sky view (difference {difference}). The 3D view uses {local}. Phone GPS height is ignored.',
    groundOk:
      'Ground height from terrain data: {ground}. Eye altitude: {altitude}. Phone GPS height is ignored.',
    demInfo:
      'Terrain: {spacing} m per pixel · {width} × {height} km · {tiles} tiles ({cached} cached, {network} downloaded, {failed} failed) · ground {ground}.',
    badgeDemValue: 'Terrain: {spacing} m per pixel',
    demDetailFailed:
      '{count} terrain tiles failed. Gaps are left empty in 3D and skipped in the horizon. Try Reload terrain.',
    demDetailOk:
      'Terrain is shown as a local 3D view, including Earth curvature for distant ground.',
    buildingsOfflineBadge: 'Buildings: offline',
    buildingsOfflineDetail:
      'Offline: building data was not saved for this area. The horizon uses terrain only. Reconnect or import a file.',
    importNoObserver: 'Choose a location first.',
    importWaitDem: 'Wait for terrain to load, then import the file.',
    importNoPolygons:
      'The file contains no usable buildings. Nothing was replaced.',
    importSuccessStatus:
      'Imported {count} buildings from {file}; {defaultCount} use an estimated 8 m height.',
    importSuccessHost: 'Imported {count} buildings from {file}.',
    importFailedStatus: 'Import failed: {message}',
    importFailedHost: 'Building import failed: {message}',
    buildingsAlreadyLoaded:
      'Buildings are already loaded for this view ({count}).',
    badgeBuildingsLoading: 'Buildings: loading…',
    buildingsLoadedStatus:
      'Buildings: {count} within {radius}; {defaultCount} use an estimated {defaultHeight} m height.',
    buildingsLoadedHost: 'Buildings loaded: {count} from OpenStreetMap.',
    badgeBuildingsCooldown: 'Buildings: wait',
    buildingsRateLimitDetail:
      'The map service asked us to slow down. Wait for the countdown, then press Load buildings again.',
    buildingsTimeoutStatus:
      '{message} Press Load buildings to try again.',
    badgeBuildingsTimeout: 'Buildings: slow',
    buildingsTimeoutDetail:
      'The map service was slow. Building data may be incomplete, but the clear-spot search can still run with what is loaded.',
    overpassError: 'Map service error: {message}',
    badgeBuildingsError: 'Buildings: error',
    buildingFetchFailed: 'Could not load buildings: {message}',
    buildingsInfo:
      'Buildings: {count} within {radius}. {defaultCount} ({percent}%) use an estimated height.',
    buildingsSourceLabel: ' ({label})',
    buildingsRetrieved: ' · retrieved {time}',
    buildingsOsm: ' · OpenStreetMap {time}',
    badgeBuildingsValue: 'Buildings: {count} ({percent}% estimated)',
    buildingsNoneDetail:
      'No buildings found in this radius. The horizon will use terrain only.',
    buildingsDefaultDetail:
      '{defaultCount} of {total} buildings ({percent}%) have no height in OpenStreetMap, so we assume 8 m; they are shown in amber in 3D. © OpenStreetMap contributors.',
    buildingsCooldownFinished:
      'The wait is over. Press Load buildings to try again.',
    badgeBuildingsReady: 'Buildings: ready',
    buildingsCooldown:
      'Please wait {seconds} s before loading buildings again.',
    badgeBuildingsCountdown: 'Buildings: {seconds}s',
    cacheTerrainCleared: 'Terrain tile cache cleared.',
    cacheBuildingCleared: 'Building cache cleared.',
    buildInfoValue:
      'Terrain workstream · cached DEM tiles: {tiles} · cached Overpass queries: {queries}',
    pathNoSession: 'Apophis path: the simulation session is not ready.',
    pathNoSessionYet: 'Apophis path: no simulation session yet.',
    pathInfo:
      'Path: <strong>{sector}</strong>; height {min}°–{max}°, highest at {maxUtc}. Visible {start} → {end}. The path is calculated once for this search area.',
    parallaxInfo:
      'Moving 5 km changes the view by only {arcsec}″ — far less than one horizon step.',
    horizonBuildingSource: 'building {id}',
    horizonCandidate: 'spot {lat}°, {lon}°',
    horizonObserver: 'you',
    horizonInside:
      ' You are inside a mapped building ({height} high). Choose Roof or move the point.',
    horizonAnchor:
      ' The shared sky view uses a slightly different ground reading: {ground}.',
    horizonInfo:
      'Horizon at {location}: ground {ground} + eye {eye} = {total}. The skyline is highest at {elevation}° in direction {azimuth}° ({source}{distance}). {buildings} buildings checked within {radius}.{anchor}{inside}',
    horizonDistance: ', {distance} away',
    sceneMarkerUnavailable: 'Apophis marker unavailable.',
    sceneMarker:
      'Apophis: direction {az}°, height {el}°; skyline {horizon}° → {state}.',
    sceneStateBelow: 'below the horizon',
    sceneStateOccluded: 'blocked by terrain or buildings',
    sceneStateVisible: 'visible',
    sceneCamera: 'Looking {az}° / {el}° · field of view {fov}°. {marker}',
    bestErrorNeedsDem:
      'The clear-spot search needs terrain data and a loaded simulation. Wait for terrain, then try again.',
    bestErrorNoWindow: 'Apophis is not visible from this location during the pass.',
    bestStatusPreparing:
      'Checking the area and nearby buildings…',
    bestStatusFetchingBuildings:
      'Loading buildings for the search area ({radius})…',
    bestWarningBuildingsIncomplete:
      'Building data did not cover the whole area, so some scores may be too optimistic. Buildings that were already loaded are still used.',
    bestWarningCancelled:
      'The location or terrain changed during the search, so it was cancelled. Run it again.',
    bestErrorNoCandidates:
      'No search points fall inside the terrain area. Reload terrain or choose a smaller radius.',
    bestStatusScoringStart:
      'Checking {count} possible spots…',
    bestStatusScoring: 'Checked {processed} of {total} spots…',
    bestStatusCancelled: 'Clear-spot search cancelled.',
    bestStatusCompletePrefix: 'Search complete: ',
    bestStatusCompleteClear:
      '{percent}% clear (cautious estimate) at {lat}°, {lon}°',
    bestStatusCompleteNoClear: 'no clear spots',
    bestStatusCompleteSuffix:
      ' · {count} spots in {seconds} s.',
    bestHostStatus: 'Clear-spot search: {summary}',
    bestHostTop:
      'The clear-spot search found {count} good spots.',
    bestStatusFailed: 'Search failed: {message}',
    bestStatusHostFailed: 'Clear-spot search failed: {message}',
    bestWorkerError: 'worker error',
    bestStatusCancelledShort: 'Search cancelled.',
    bestSummary:
      'Checked {count} spots in {seconds} s. Each score is the share of the pass above the local skyline. The ranking is cautious about building heights; the range shows the cautious-to-optimistic spread.',
    bestWarningIncomplete:
      'Building data did not cover the whole search area, so some spots may look clearer than they are. Treat them as provisional.',
    bestDetailEmpty:
      'No results. Try reloading terrain or choosing a smaller area.',
    bestDetailHint:
      'Tap a spot to look from there. “Rank ±N” means it moves N places when building heights are uncertain.',
    bestViewpoint:
      '<strong>Spot #{rank}</strong> at {lat}°, {lon}° · ground {ground} · cautious score {score}% (optimistic {optimistic}%) · rank {rankPessimistic} (optimistic rank {rankOptimistic}, spread {spread}) · lowest clearance {clearance}°. {reason}',
    bestMakeObserver: 'Use this spot',
    bestSummaryNone: 'No current search result.',
    bestSummaryInitial: 'No search yet.',
    footerBuildInfoInitial:
      'Terrain workstream · cached DEM tiles: — · cached Overpass queries: —',
    blockersDefault: '{count} with estimated height',
    blockersReal: '{count} with mapped height',
    blockersTerrain: 'terrain',
    blockersNone: 'none',
    openNoBuildings: 'no mapped buildings',
    openInside: 'inside a building outline',
    openNearest: '{distance} m to the nearest building',
    rankFlag: 'rank ±{spread}',
    rankFlagTitle: 'Rank changes when building heights are uncertain',
    rank: '#{rank}',
    scoreRange:
      '{optimistic}–{pessimistic}% depending on building heights',
    blockers: 'Blockers: {blockers} · {openSpace}',
    offlinePreparedStatus:
      'Area saved for offline use · {bytes} · {date}.',
    offlineStatusPreparing: 'Saving this area for offline use…',
    offlineStatusCancelled: 'Saving cancelled.',
    offlineStatusFailed: 'Could not save the area: {message}',
    offlineErrorNoObserver:
      'Choose a location before saving an offline area.',
    offlineErrorOffline:
      'You are offline. Reconnect, then save the area.',
    offlinePreparedHost: 'Offline area saved for this location.',
    offlineCleared: 'Saved offline data deleted.',
    offlineClearConfirm:
      'Delete the saved area, cached terrain and building data? The app itself stays installed.',
    offlineStatusOfflineNoSnapshot:
      'You are offline and no saved area was found. Reconnect and save an area.',
    offlineRunning: ' · using this saved area',
    offlineStatusPrepared: 'Saved {date} · {bytes}{active}.',
    offlineContentsEphemeris:
      '<li><strong>Sky data:</strong> {provider} · solution {solution} · retrieved {retrieved} · {bytes}</li>',
    offlineContentsStars:
      '<li><strong>Stars:</strong> {stars}</li>',
    offlineContentsTerrain:
      '<li><strong>Terrain:</strong> {tiles} terrain tiles · {bytes} · {attribution}</li>',
    offlineContentsBuildings:
      '<li><strong>Buildings:</strong> {buildings}</li>',
    offlineContentsBaseMap:
      '<li><strong>Map:</strong> a shaded terrain map with building outlines. OpenStreetMap street tiles are not saved.</li>',
    offlineNotStored: 'not stored',
    offlineBuildingsValue:
      '{count} buildings · {defaultCount} with estimated height · {bytes} · {source}{sourceLabel}',
    offlineBuildingsMissing:
      'not stored; clear-spot scores will be incomplete',
    offlineMismatchWarning:
      'This location is outside the saved area. Sky and AR still work; terrain maps and clear-spot searches do not.',
    offlineBuildingsNotPrepared:
      'Buildings: not saved for this offline location.',
    offlineDemNotPrepared:
      'Terrain: not saved for this offline location.',
    offlineBuildingsBadgeNotPrepared: 'Buildings: not prepared',
    offlineIncomplete: 'Offline data is incomplete.',
    offlineStorage:
      '{persistence} · used {used} · quota {quota}.',
    offlineStorageUnavailable: 'Storage API unavailable.',
    offlinePersistent: 'Persistent storage granted',
    offlineBestEffort: 'Best-effort storage (may be evicted)',
    offlineLoadedFromSnapshot:
      'Loaded {count} buildings from the offline snapshot (retrieved {retrieved}).',
    buildingsProgressCheckingBundled:
      'Checking for saved building data…',
    buildingsProgressNoBundledCoverage:
      'No saved building data covers this view; loading from OpenStreetMap…',
    buildingsProgressLoadingBundled:
      'Loading saved buildings from "{area}" within {radius} km…',
    buildingsProgressLoadedBundled:
      'Loaded {count} buildings from "{area}".',
    buildingsProgressBundledUnavailable:
      'Saved building data unavailable; loading from OpenStreetMap…',
    buildingsProgressCheckingCache: 'Checking saved buildings…',
    buildingsProgressCacheHit:
      'Loaded {count} buildings from saved data ({source}).',
    buildingsProgressRetry:
      'Trying again in {seconds} s…',
    buildingsProgressRetryAction: 'Retrying',
    buildingsProgressFallbackAction: 'Trying another map service',
    buildingsProgressQuerying:
      'Loading buildings within {radius} km from OpenStreetMap…',
    buildingsProgressLoaded:
      'Loaded {count} buildings; {defaultCount} use an estimated {defaultHeight} m height.',
    buildingsProgressUnreachable:
      'The map service could not be reached; trying another one.',
    buildingsProgressHttp406:
      'The map service blocked the request; switching to another service.',
    buildingsRateLimit:
      'The map service asked us to wait. Try again in {seconds} s.',
    buildingsEndpointError:
      'The map service returned HTTP {status}{body}',
    buildingsResponseError: 'The map service returned HTTP {status}{body}',
    buildingsInvalidJson:
      'The map service returned data we could not read.',
    buildingsRemark: 'Map service: {remark}',
    buildingsTimeout: 'The map service did not answer within {seconds} s.',
    buildingsAllFailed:
      'No building data could be downloaded. Try again later.',
    buildingsHttpBody: ': {body}',
    buildingsSourceBundled: 'Saved area: {name}',
    importedAreaSource: 'Imported area: {name}',
    buildingsTimeoutDefault: 'Map service request timed out',
    buildingsNoElements: 'The map service returned no building data.',
    gridProgressLoading: 'Loading terrain ({count} tiles)…',
    gridProgressTiles:
      'Loading terrain: {loaded}/{total} ({cached} already saved)',
    gridProgressStitching: 'Preparing terrain…',
    gridProgressReady:
      'Terrain ready: {spacing} m per pixel',
    importNotJson: 'Imported building data is not valid JSON.',
    importNoFeatures:
      'GeoJSON FeatureCollection has no features array.',
    importNotGeoJson:
      'Imported building data is not a GeoJSON FeatureCollection.',
    manifestNotArray:
      'Bundled area manifest must contain an "areas" array.',
    manifestHttp: 'Bundled area manifest responded HTTP {status}.',
    manifestNotJson: 'Bundled area manifest is not valid JSON.',
    bundledHttp: 'Bundled area "{name}" responded HTTP {status}.',
    bundledReadFailed: 'Could not read bundled area "{name}".',
  },

  map: {
    attributionOsm:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    attributionOffline:
      'Offline hillshade: Terrain Tiles by Mapzen / AWS Open Data · &copy; OpenStreetMap contributors (ODbL)',
    markerObserverTitle: 'Observer — drag or click the map to move',
    viewpointTooltip: 'Local 3D viewpoint',
    resultTooltip: '#{rank} · {percent}% clear (cautious)',
  },

  scene3d: {
    webglUnavailable:
      'WebGL is unavailable in this browser, so the local 3D view cannot be shown. The horizon chart and best-spot list still work.',
    canvasAria:
      'Local 3D terrain view. Arrow keys look around; plus and minus change the field of view; 0 resets the view.',
    markerApophis: 'Apophis',
    cardinalN: 'N',
    cardinalE: 'E',
    cardinalS: 'S',
    cardinalW: 'W',
  },

  horizonChart: {
    empty: 'Load terrain data to see the local horizon.',
    legendHorizon: 'skyline: terrain + buildings',
    legendPath: 'Apophis path (red = below the horizon or your height limit)',
  },

  bestSpot: {
    insideBuilding:
      'You are inside a mapped building ({id}); this is not a ground-level spot. Choose Roof or another point.',
    noWindow: 'Apophis is not visible from this location during the pass.',
    clearWhole:
      'Clear for the whole visible pass (lowest clearance {clearance}°).',
    clearPercent:
      '{percent}% of the visible pass is clear.',
    marginLimited:
      'The view is limited by {source}{direction} from {when}; it is less than the {margin}° margin above the skyline. {percent}% of the visible pass is clear.',
    blocked:
      'Blocked by {source}{direction} from {when}; {percent}% of the visible pass is clear (lowest clearance {clearance}°).',
    sourceBuildings: 'buildings',
    sourceTerrain: 'terrain',
    sourceHorizon: 'the skyline',
    verbBuildings: 'leave',
    verbOther: 'leaves',
    direction: ' to the {direction}',
    whenLocal: '{time} UTC ({local} local)',
    whenUtc: '{time} UTC',
    parallaxWorst: 'at worst along the visible pass',
    parallaxGeocentric: 'at closest approach to Earth',
  },

  path: {
    noSector: 'no above-horizon sector',
    crossesNorth: 'crosses north',
    clockwise: 'clockwise',
    sector: '{min}° → {max}° ({direction}, {span}°)',
  },

  compass: {
    north: 'north',
    northEast: 'north-east',
    east: 'east',
    southEast: 'south-east',
    south: 'south',
    southWest: 'south-west',
    west: 'west',
    northWest: 'north-west',
  },

  sky: {
    cardinalN: 'N',
    cardinalE: 'E',
    cardinalS: 'S',
    cardinalW: 'W',
    moonPhase: 'Moon {percent}%',
    apophisLabel: 'Apophis  V≈{magnitude}  {diameter}″',
    enlarged: 'ENLARGED — NOT TO SCALE',
  },

  space: {
    moon: 'Moon',
    earth: 'Earth',
    geoRing: 'Satellite limit — GEO 35,786 km',
    karmanLine: 'Edge of space — 100 km',
    moonOrbit: 'Moon orbit 384,400 km',
    apophis: 'Apophis — true-scale point',
    enlarged: 'ENLARGED — NOT TO SCALE',
    rulerTick: '{thousands},000 km',
  },

  ar: {
    canvasAria:
      'Augmented reality sky overlay. Arrow keys pan the virtual view when touch mode is active.',
    statusCamera: 'Camera',
    statusSensors: 'Sensors',
    statusAccuracyPlaceholder: '±—°',
    statusRehearsal: '2029 rehearsal',
    enableCompass: 'Enable compass',
    fullscreen: 'Full screen',
    waitingClock: 'Waiting for the host clock…',
    tapPrompt: 'Tap a target in the image',
    cancel: 'Cancel',
    calibrationTitle: 'Calibration',
    headingOffset: 'Heading offset',
    horizontalFov: 'Horizontal FOV',
    fovTargetAAria: 'FOV target A',
    fovTargetBAria: 'FOV target B',
    tapA: 'Tap A',
    tapB: 'Tap B',
    fovInstructions:
      'FOV from two taps: choose two objects at least 5° apart, then tap each in the camera image.',
    calibrationTargetAria: 'Calibration target',
    align: 'Align on target',
    twoPointMarkA: 'Two-point heading: mark A',
    reset: 'Reset',
    errorPlaceholder: '±—° estimated pointing error.',
    calibrationExplainer:
      'One tap centres the overlay on a known object. Two-point heading averages two heading marks and reports their disagreement. FOV from two taps is separate: it solves the lens FOV from the pixel spacing of two known objects and does not claim to fix heading.',
    rehearsalTitle: 'Rehearsal &amp; fallback',
    modeRehearsal: '2029 rehearsal',
    modeTonight: 'Tonight practice',
    timeLabel: 'Rehearsal time (UTC)',
    go: 'Go',
    jumpTopocentricCa: 'Closest approach',
    jumpVisibilityStart: 'Visible start',
    jumpRise: 'Rise',
    touchToggle: 'Touch-drag virtual AR (no sensors)',
    enableSensors: 'Enable compass / motion',
    retryCamera: 'Retry camera',
    sensorNote:
      'Absolute compass is requested only from a user gesture on iOS. Android Chrome may grant it automatically.',
    tonightNote:
      'Tonight practice uses the real clock for Sun, Moon, planets and stars. Apophis is hidden there because the committed ephemeris covers only 13–14 April 2029 (UTC ±24 h).',
    cameraNotStarted: 'Camera not started.',
    sensorNotStarted: 'Sensors not started.',
    timeTonight: 'Tonight · real clock',
    timeRehearsal: '2029 rehearsal · host clock',
    cameraInsecure:
      'Camera needs HTTPS (or localhost). The AR overlay will run on black.',
    cameraUnavailable:
      'This browser has no camera API. AR overlay runs on black.',
    cameraRequesting: 'Requesting rear camera…',
    cameraLive: 'Rear camera live.',
    cameraDenied:
      'Camera permission denied. The AR overlay is shown on black; sensors still drive it. Use Touch-drag in Rehearsal & fallback if sensors are unavailable.',
    cameraUnavailableDetail:
      'Camera unavailable ({name}). The AR overlay is shown on black; sensors still drive it. Use Touch-drag in Rehearsal & fallback if sensors are unavailable.',
    cameraErrorNameFallback: 'error',
    cameraStatusIdle: 'Camera idle',
    cameraStatusStarting: 'Camera starting…',
    cameraStatusLive: 'Camera live',
    cameraStatusDenied: 'Camera denied',
    cameraStatusUnavailable: 'No camera',
    cameraStatusInsecure: 'HTTPS needed',
    sensorWaiting: 'Waiting for motion sensors…',
    sensorTouchIgnored:
      'Touch-drag virtual AR. Sensor data is ignored while touch look is on.',
    sensorAccuracyUnusable:
      'Compass accuracy is reported as unusable (negative). Absolute tilt may still work; align manually or use touch-drag.',
    sensorCompassNoAccuracy:
      'Compass heading (accuracy not reported; 5–15° is typical).',
    sensorCompassAccuracy:
      'Compass heading, device reports ±{accuracy}°.',
    sensorAbsolute:
      'Absolute orientation (magnetic north assumed). Declination is applied from WMM2025.',
    sensorRelative:
      'Relative orientation only: alpha has an arbitrary zero. Align on a known object to set north, or use touch-drag.',
    sensorStatusIdle: 'Sensors idle',
    sensorStatusRequesting: 'Sensors…',
    sensorStatusCompass: 'Compass',
    sensorStatusAbsolute: 'Absolute',
    sensorStatusRelative: 'Relative only',
    sensorStatusDenied: 'Sensors denied',
    sensorStatusUnavailable: 'No sensors',
    sensorDeniedTouch: 'Sensors denied · touch',
    sensorUnavailableTouch: 'No sensors · touch',
    sensorTouch: 'Touch look',
    sensorDeniedSettings:
      'Sensor permission denied. Use touch-drag virtual AR, or allow Motion & Orientation in settings and reload.',
    sensorIosGesture:
      'iOS requires a tap to allow compass/motion. Tap “Enable compass / motion”.',
    sensorRequesting: 'Requesting motion sensor permission…',
    sensorNotRequired:
      'Motion sensor permission is not required on this browser.',
    sensorGranted:
      'Sensor permission granted. Move the phone in a figure-eight if the compass drifts.',
    sensorDeniedSafari:
      'Sensor permission denied. Use touch-drag virtual AR, or allow Motion & Orientation in Safari settings and reload.',
    sensorFailed:
      'Sensor permission failed: {message}. Use touch-drag virtual AR.',
    sensorIosAccess:
      'Tap “Enable compass / motion” to allow iOS motion access, or use touch-drag virtual AR.',
    sensorNoData:
      'No motion sensor data arrived. Touch-drag virtual AR is enabled; the overlay still shows the sky at the host time.',
    offsetValue: '{sign}{offset}°',
    fovValue: '{fov}°',
    errorEstimate: '{label}. {detail}',
    estimatedAccuracy: '±{value}° est.',
    touchAlignment: 'Touch alignment',
    twoPointMarkB: 'Two-point heading: mark B & apply',
    targetOption: '{name} · {elevation}°',
    noTargets: 'No named target above the horizon',
    fovErrorNoTarget: 'Choose a named target above the horizon first.',
    fovErrorNoOrientation:
      'No orientation yet. Enable the compass or use touch look first.',
    fovErrorOutsideView:
      '{name} is outside the current camera view. Point the phone towards it before tapping.',
    fovErrorBehindCamera:
      '{name} is behind the camera. Point the phone towards it before tapping.',
    fovTapNamed: 'Tap {name} in the camera image',
    fovErrorTapOutside: 'Tap inside the camera image.',
    fovStatusArmed: 'Tap {name} in the image ({slot}).',
    fovButtonTapAOnImage: 'Tap A on image…',
    fovButtonTapAAgain: 'Tap A again',
    fovButtonTapBOnImage: 'Tap B on image…',
    fovButtonTapBAgain: 'Tap B again',
    fovStatusSolved:
      'Solved FOV {fov}° from {a}–{b} ({separation}° apart), tap residual {px} px / {deg}°.',
    fovStatusMarkedA:
      '{name} marked. Choose target B and tap it in the image.',
    fovStatusMarkedB:
      '{name} marked. Choose target A and tap it in the image.',
    fovErrorSameTarget:
      'Choose two different targets for FOV calibration.',
    fovErrorFailed: 'FOV calibration failed: {error}',
    fovSuccess:
      'FOV calibrated to {fov}° from {a}–{b}; tap residual {px} px ({deg}°).',
    calibrationErrorNoTarget:
      'No calibration target above the horizon right now.',
    calibrationErrorNoOrientation:
      'No orientation yet. Enable the compass or switch to touch look.',
    calibrationAligned:
      'Aligned on {name}: heading offset {offset}°.',
    calibrationErrorNeedTarget:
      'Choose a target above the horizon and get an orientation first.',
    calibrationTwoPointFirst:
      'Two-point: {name} marked. Now point at a second known object, choose it, and tap again.',
    calibrationErrorSameSecond:
      'Choose a different second target for two-point calibration.',
    calibrationTwoPointApplied:
      'Two-point heading calibration applied: offset {offset}°, disagreement ±{residual}°.',
    calibrationResetDone: 'Calibration reset: offset 0°, FOV 60°.',
    calibrationStorageFailed:
      'Calibration could not be saved (storage blocked).',
    timeErrorEmpty: 'Enter a UTC date and time first.',
    timeErrorInvalid: 'Invalid UTC date/time.',
    timeErrorNoSession: 'No simulation session yet.',
    timeErrorNoJump: 'No {kind} available for this observer.',
    fullscreenUnavailable:
      'Fullscreen is unavailable in this browser.',
    messageHttps:
      'Camera and motion sensors need HTTPS. Use localhost or a trusted LAN certificate.',
    messageWaitingObserver:
      'Waiting for the host to supply an observer location.',
    messageWaitingClock: 'Waiting for the host clock.',
    statusHostSummary: '{camera} {sensor}',
    canvasWaitingOrientation: 'Waiting for orientation…',
    canvasWaitingObserver: 'Waiting for observer location…',
    chartApophis: 'Apophis · {elevation}°',
    chartSun: 'Sun',
    chartMoon: 'Moon',
    readingWaiting: 'Waiting for observer and clock…',
    readingCameraNone: 'Camera —',
    readingCamera: 'Camera {az} / {pitch}',
    readingTonight:
      'Tonight practice · {camera} · Apophis hidden (2029 ephemeris only)',
    readingNoApophis: '{camera} · no Apophis data',
    readingApophis:
      '{camera} · Apophis {az} / {el} · {range} · {below}{extrapolated}',
    readingBelow: 'below horizon',
    readingExtrapolated: ' · extrapolated WMM',
    calibrationErrorDetailCompassUnknown:
      'device compass accuracy not reported; 5–15° is typical (a 2026 iPhone field test saw ±14–16°)',
    calibrationErrorDetailCompass: 'device compass ±{accuracy}°',
    calibrationErrorDetailResidual: 'alignment residual ±{residual}°',
    calibrationErrorSuffix:
      'A phone compass is not an arcsecond instrument; treat the overlay as a finder, not a measurement.',
    calibrationErrorLabel:
      '±{value}° estimated pointing error',
    fovErrorViewport: 'The camera viewport has no size yet.',
    fovErrorTapCoordinates: 'The tap coordinates are invalid.',
    fovErrorAngularSeparation:
      'The two targets do not have a usable angular separation.',
    fovErrorTargetsTooClose:
      'Choose targets at least {minimum}° apart; these are only {actual}° apart.',
    fovErrorTapsTooClose:
      'The two taps are only {actual} px apart; tap each object more precisely.',
    fovErrorNoPinhole:
      'The taps do not fit any pinhole FOV in the supported range. Re-centre the objects and tap again.',
    fovErrorOutOfRange:
      'Solved FOV {fov}° is outside the {min}–{max}° supported range. Check the targets and taps.',
    declinationInvalidDate:
      'Invalid date: magnetic declination is unavailable.',
    declinationBeforeModel:
      'WMM2025 starts 2024-11-13. This date is outside the bundled model; declination is not applied.',
    declinationAfterModel:
      'WMM2025 is officially valid to 2029-12-31. This date is beyond it; declination is not applied. WMM2030 is expected in December 2029.',
    declinationExtrapolated:
      'Extrapolated WMM2025: the installed package window ends 2029-11-13, although the model is nominally valid to 2029-12-31. Declination uncertainty grows outside the package window.',
    declinationUnavailable:
      'Magnetic declination is unavailable for this date: {message}',
    declinationInvalidResult: 'WMM returned a non-finite declination',
  },

  location: {
    offlineUnavailable:
      'No offline area has been saved. Connect to the internet, open Local 3D and use “Save this area offline”, then try again.',
    browserOffline:
      'Browser location is not used offline. Set coordinates manually or reconnect.',
    requesting: 'Requesting browser location…',
    ephemerisFetchFailed: 'Ephemeris fetch failed: HTTP {status}',
    fromUrl: 'Location set by this link.',
    previewStatus:
      'Showing Brasov for now. Choose your location so the sky matches where you are.',
    restoredStatus:
      'Using your saved location. Change it with the location button.',
    locatingPreview:
      'Locating you… showing Brasov preview. You can set a location manually.',
    offlineNoPreparedArea: 'Offline: no saved area.',
    offlineNotPrepared:
      'Offline: terrain and buildings are only saved near {area}. Sky and AR still work for these coordinates.',
    offlineUsingPrepared:
      'Offline: using the saved area {area}{urlSuffix}. Saved {preparedAt}.',
    offlineUrlSuffix: ' (from this link)',
    offlineMismatch:
      'Offline: terrain and buildings are only saved for {area}. Sky and AR still work here.',
    offlineAllAvailable:
      'Offline: sky/AR data and the saved terrain area are available. Saved {preparedAt}.',
    offlineOneArea: 'one area',
    geolocationUnavailable:
      'This browser cannot provide your location. Choose a preset or enter coordinates.',
    usingBrowser:
      'Using your current location. Phone GPS height is ignored; eye height is added above the terrain ground.',
    denied:
      'Location permission was denied. Choose a preset or enter coordinates.',
    dialogTitle: 'Where are you observing from?',
    dialogIntro:
      'Apophis passes on 13 April 2029. Choose where you will watch from so the times and sky match your spot. This stays on your device.',
    dialogUseLocation: 'Use my location',
    dialogCoordinates: 'Enter coordinates',
    dialogPresetLabel: 'Or choose a preset',
    dialogPresetPlaceholder: 'Choose a location…',
    dialogKeep: 'Not now',
    dialogClose: 'Close',
    dialogForget: 'Forget saved location',
    dialogForgotten:
      'Saved location forgotten. This session keeps its current location.',
    presetStatus:
      '{preset}. Ground height {elevation} m; eye height is added above it.',
    validationLat: 'Latitude must be between -90 and 90 degrees.',
    validationLon: 'Longitude must be between -180 and 180 degrees.',
    validationEyeHeight: 'Eye height must be between 0 and 100 m.',
    validationGroundOptional:
      'Ground elevation must be between -500 and 9000 m, or left blank.',
    validationGround:
      'Ground elevation must be between -500 and 9000 m.',
    manualStatus:
      'Your coordinates. Ground height {ground}; eye height {eye} m.',
    groundUnknownAssumed: 'not known (0 m assumed)',
    groundValue: '{elevation} m',
    timeOutsideWindow:
      'That time is outside the available range; it has been moved to the nearest available time.',
    endOfWindow: 'Reached the end of the available time range.',
    fromTerrain: 'Location changed from the map.',
    groundFromDem:
      'Ground height {elevation} m from terrain data; eye height {eye} m.',
    eyeHeightStatus:
      'Eye height {eye} m above the ground. The sky view does not check terrain or buildings.',
    noJump:
      'There is no {target} for this location in the available time range.',
    noObserver: 'No observer set',
    observerSummary:
      '{lat}°, {lon}°, {elevation} m effective',
  },

  offline: {
    cancelled: 'Offline preparation cancelled',
    requestStorage: 'Requesting persistent storage…',
    storageWarning:
      'Persistent storage was not granted. The browser may evict offline data; on iOS, add the app to the Home Screen and open it at least once a week.',
    downloadingEphemeris: 'Downloading sky data…',
    ephemerisLabel: 'Sky data',
    invalidEphemeris: 'The downloaded sky data is invalid.',
    missingMetadata:
      'The sky data is missing its source information.',
    downloadingStars: 'Downloading the star map…',
    starsLabel: 'Star map',
    starsUnavailable:
      'Star map unavailable: {message}. The sky still works without labels.',
    downloadingTerrain: 'Saving terrain tiles…',
    terrainFailed: 'Could not prepare terrain: {message}',
    missingTiles:
      'Some terrain tiles could not be saved. Browser storage may be full or blocked. Free some space and try again.',
    failedTiles:
      'Some terrain tiles could not be downloaded, so offline terrain will have gaps. Try again on a stable connection.',
    cachedTiles: 'Saved {count} terrain tiles.',
    fetchingBuildings: 'Downloading building outlines from OpenStreetMap…',
    buildingsUnavailable:
      'Building data unavailable: {message}. Clear-spot scores will be incomplete.',
    writingSnapshot: 'Finishing the offline save…',
    snapshotFailed:
      'The offline area could not be saved. Browser storage is full or unavailable. Delete the saved area or free space and try again.',
    storageNearlyFull:
      'Browser storage is over 90% full. Saving may fail; try a smaller search area or free some space.',
    persistentGranted:
      'The browser has granted persistent storage.',
    done: 'Offline area ready.',
    downloadFailed:
      '{label} could not be downloaded: {error}',
    downloadHttp: '{label} download failed: HTTP {status}',
    invalidJson: '{label} could not be read.',
    baseMapNote:
      'The offline map is a shaded terrain map with building outlines. OpenStreetMap street tiles are not saved because their service does not allow bulk downloads.',
    verifyMissingTiles:
      'Some terrain tiles are missing. The browser may have deleted site data; save the area again.',
    verifyEphemeris:
      'The stored sky data is missing or incomplete. Save the area again.',
  },

  startup: {
    title: 'Apophis Watch could not start',
    offlineHint:
      'If you are offline, save an area while online first: open <strong>Local 3D</strong> → <strong>Save this area offline</strong>. Then reload.',
  },
} as const;
