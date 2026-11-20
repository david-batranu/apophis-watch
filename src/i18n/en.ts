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
    topocentricCa: 'Topocentric CA',
    geocentricCa: 'Geocentric CA',
    rise: 'Rise',
    set: 'Set',
    maxElevation: 'Max elevation',
    visibilityStart: 'Visibility start',
    visibilityEnd: 'Visibility end',
  },

  shell: {
    brandName: 'APOPHIS WATCH',
    brandSubtitle: '(99942) Apophis · 13 April 2029',
    skipToContent: 'Skip to main content',
    locationFallback: 'Location',
    offlineChipAria: 'Offline status and preparation',
    offlineChecking: 'Offline: checking…',
    nightModeButton: 'Night mode',
    nightModeOn: 'Night mode: on',
    nightModeOff: 'Night mode: off',
    tabsAria: 'View',
    tabSky: 'Sky view',
    tabSpace: 'Space view',
    tabLocal: 'Local 3D',
    tabAr: 'AR',
    dataWindowPlaceholder: 'Data window: —',
    dataWindowValue: '{start} → {end} UTC',
    skyAria: 'Stereographic sky dome',
    skyCanvasAria:
      'Sky dome. Drag or use arrow keys to look; plus and minus zoom; zero resets.',
    spaceCanvasAria:
      'Space view: Apophis, Earth and Moon to scale. Camera preset buttons are beside the view.',
    plotCanvasAria:
      'Elevation and magnitude of Apophis versus time. The same values are in the live readout.',
    skyHint: 'Drag to look · pinch/scroll to zoom · double-click reset',
    badgeRefracted: 'refracted',
    spaceCameraEarth: 'Earth',
    spaceCameraFlyby: 'Flyby',
    spaceCameraMoon: 'Moon orbit',
    spaceCameraTop: 'Top-down',
    spaceResetCameras: 'Reset cameras',
    spaceLegendScale:
      '1 scene unit = 1,000 km · Earth radius 6,378 km · GEO ring 42,164 km · Moon orbit 384,400 km',
    spaceLegendTrueScale:
      'Apophis is a true-scale point; its 340 m disc is invisible at this scale.',
    readoutTitle: 'Live readout',
    metricAzimuth: 'Azimuth',
    metricElevation: 'Elevation',
    metricRange: 'Range',
    metricRate: 'Angular rate',
    metricMagnitude: 'V magnitude',
    metricSize: 'Angular size',
    metricMoonSeparation: 'Moon separation',
    metricVisibility: 'Visibility',
    timeTitle: 'Time',
    play: '▶ Play',
    pause: '⏸ Pause',
    speed: 'Speed',
    scrubAria: 'Time scrub',
    localClock: '{label} {zone} ({iana})',
    plotTitle: 'Elevation &amp; magnitude vs time',
    plotCaption:
      'Elevation line is airless geometric elevation (the readout may be refracted) · magnitude line (lower is brighter) · shaded: Phase 1 visibility (Sun &lt; −6°) · dashed: good-viewing threshold.',
    sizeTitle: 'Size honesty',
    observerTitle: 'Observer',
    observerPreset: 'Preset',
    observerCustom: 'Custom / browser location',
    observerLat: 'Latitude °',
    observerLon: 'Longitude °',
    observerGroundElevation: 'Ground elev. m (optional)',
    observerGroundPlaceholder: 'unknown',
    observerEyeHeight: 'Eye height m',
    observerApply: 'Apply coordinates',
    observerUseLocation: 'Use my location',
    observerNote:
      'Height is eye height above ground. In Local 3D the ground elevation comes from the DEM and eye height is added; browser GPS altitude is only a cross-check and is ignored.',
    displayTitle: 'Display',
    displayRefraction: 'Refraction (display only)',
    displayConstellations: 'Constellation lines',
    displayEnlarged: 'Enlarged marker',
    displayEnlargedBadge: 'not to scale',
    displayNightMode: 'Night mode (red)',
    displayMinGoodLabel: 'Good-viewing minimum elevation: ',
    displayMinGoodNote:
      'The Phase 1 visibility window (above horizon + Sun &lt; −6°) is unchanged; this threshold only highlights the easier part of the path.',
    aboutSummary: 'About, data, offline storage &amp; licences',
    aboutBuildTitle: 'Build &amp; data source',
    aboutOfflineTitle: 'Prepared offline area',
    aboutAreasTitle: 'Bundled building areas',
    checkUpdates: 'Check for updates',
    aboutNotPrepared: 'Not prepared.',
    storageNotChecked: 'Storage status not checked yet.',
    checking: 'Checking…',
    footerNote:
      'Everything is computed from the committed JPL Horizons state vectors and astronomy-engine. The view is a simulation for planning, not a live feed. Offline base maps are rendered from cached terrain tiles; OpenStreetMap raster tiles are never bulk-downloaded.',
    pwaUpdateReady:
      'A new version is ready. Reload when convenient; the prepared offline area is kept.',
    pwaOfflineReady:
      'App shell cached for offline use. Open Local 3D and press “Prepare for offline” to store terrain and buildings.',
    pwaServiceWorkerError: 'Service worker: {error}',
    pwaChecking: 'Checking for a new build…',
    pwaNewBuildReady: 'A new build is ready; use Reload in the banner.',
    pwaNoUpdate: 'No update found (or the browser is offline).',
    pwaReload: 'Reload',
    pwaGotIt: 'Got it',
    pwaLater: 'Later',
    offlineAreaNotPrepared: 'Offline: area not prepared',
    offlineReady: 'Offline: ready',
    offlinePrepared: 'Offline: prepared',
    offlineNotPrepared: 'Offline: not prepared',
    offlineMode: 'Offline mode.',
    refractionSubRefracted: 'refracted',
    refractionSubAirless: 'airless',
    rangeSub: '{ratio} lunar distances',
    rateValue: '{rate}°/min',
    magnitudeValue: '{magnitude} (est.)',
    sizeSub: 'true angular size',
    viewBelow: 'Below horizon',
    viewInWindow: 'In visibility window',
    viewNotDark: 'Above horizon, not dark',
    viewSubPhase1: 'Phase 1 (Sun < −6°)',
    viewSubNotMet: 'Sun criterion not met',
    badgeDisplayRefracted: 'refracted (display)',
    badgeAirless: 'airless',
    badgeVisibilityBelow: 'below horizon',
    badgeVisibilityVisible: 'visible · Sun < −6°',
    badgeVisibilityNotDark: 'above horizon · not dark',
    readoutNoteRefracted:
      'Refracted azimuth/elevation · range/rate/size are geometric · magnitude is an H-G estimate · marker glow encodes magnitude, not the 1.7″ physical disc.',
    readoutNoteAirless:
      'Airless azimuth/elevation · range/rate/size are geometric · magnitude is an H-G estimate · marker glow encodes magnitude, not the 1.7″ physical disc.',
    trailTicksTitle: '5-min trail ticks (local, thinned on dome):',
    trailTicksNone:
      '5-min trail ticks: none above the horizon in this ±3 h window.',
    sizeBadge: 'Apophis {arcsec}″',
    sizeAtRange: 'at {range}',
    sizeTableObject: 'Object',
    sizeTableAngular: 'Angular',
    sizeTableVsApophis: 'vs Apophis',
    sizeObjectMoon: 'Moon',
    sizeObjectApophis: 'Apophis',
    sizeObjectEiffel: 'Eiffel Tower (height)',
    sizeObjectFootball: 'Football pitch (length)',
    sizeObjectIss: 'ISS (solar-array span)',
    sizeNote:
      'Every angular figure is calculated as 2·atan(radius/distance) at the current Apophis range. The Moon is shown as if it were at that distance, not its real 384,400 km. Apophis’ real size is {arcsec}″; the true-scale marker is a point, and the dashed marker is labelled “not to scale”.',
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
      '<p>No offline area is prepared. Open <strong>Local 3D</strong> and press <strong>Prepare for offline</strong>.</p>',
    aboutOfflinePresent:
      '<p><strong>Prepared</strong> {prepared} · {bytes}</p>\n        <p><strong>Area</strong> {area} · search radius {searchRadius} m · buildings within {buildingRadius} m</p>\n        <p><strong>Ephemeris</strong> solution {solution} · retrieved {retrieved} · {ephemerisBytes}</p>\n        <p><strong>Stars</strong> {stars}</p>\n        <p><strong>Terrain</strong> {tileCount} DEM tiles (z{zoom}) · {terrainBytes} · {attribution}</p>\n        <p><strong>Buildings</strong> {buildings}</p>\n        <p><strong>Base map</strong> {baseMapNote}</p>\n        {warnings}\n        <p><strong>Data source</strong> {provider} · solution {solution}.</p>',
    aboutStarsValue: '{source} · {bytes}',
    aboutNotStored: 'not stored',
    aboutBuildingsValue:
      '{count} OSM ways · {defaultCount} default height · {bytes} · {source}{sourceLabel} · retrieved {retrieved}',
    aboutBuildingsMissing:
      'not stored (best-spot scores marked incomplete)',
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
      'A short plan generated from the current observer, ephemeris and visibility window.',
    badge: '13 April 2029',
    yourPlan: 'Your plan',
    checklist: 'Checklist',
    waitingSession: 'Waiting for the simulation session.',
    footer:
      'The object is a point of light. The app’s marker is enlarged only when you turn on “Enlarged marker”; the true angular size is shown in the readout.',
    waitingObserver: 'Waiting for the ephemeris and observer.',
    noWindowFallback: 'No physical Phase 1 visibility window at this location.',
    chooseAnother:
      'Choose another observer or check the Sun/Moon geometry.',
    spotNote:
      'Run the best-spot search in Local 3D, tap a result and press “Make this the observer” to make this plan spot-specific.',
    plan:
      '<dl class="event-plan-list">\n        <dt>Location</dt>\n        <dd>{location}</dd>\n        <dt>Closest approach</dt>\n        <dd><strong>{caUtc}</strong> · {caLocal} · range {range}</dd>\n        <dt>Look at closest approach</dt>\n        <dd><strong>{azimuth}° ({compass})</strong>, elevation <strong>{elevation}°</strong></dd>\n        <dt>Visible window</dt>\n        <dd>{window}</dd>\n        <dt>Highest</dt>\n        <dd>{highest}</dd>\n        <dt>Path direction</dt>\n        <dd>{direction}</dd>\n        <dt>What you will see</dt>\n        <dd>{what}</dd>\n        <dt>Spot</dt>\n        <dd>{spot}</dd>\n      </dl>',
    locationLine: '{lat}°, {lon}° · ground {ground} · eye {eye} m',
    groundUnknown: 'unknown',
    visibleWindow: '{start} → {end}',
    highest: '{time} ({local}) at {elevation}°',
    pathDirection: '{direction} · elevation {min}° → {max}°',
    whatYouSee:
      'A fast-moving point of light (V ≈ {magnitude}, true size {size}″). It will not look like a disc or a movie asteroid. The trail and motion are the signature.',
    checklistItems: {
      charge: {
        label: 'Charge the phone and bring a power bank',
        detail: 'Cold batteries drain faster; AR and GPS are power-hungry.',
      },
      update: {
        label: 'Update the app and open it once while online',
        detail:
          'A new build is offered as a reload prompt; do not update in the field.',
      },
      install: {
        label: 'Install the PWA / Add to Home Screen',
        detail:
          'On iOS this is what keeps offline data from being evicted after 7 days without a tap.',
      },
      prepare: {
        label: 'Prepare the offline area for the chosen spot',
        detail: 'Local 3D → Prepare for offline. Wait for “Offline area ready”.',
      },
      calibrate: {
        label: 'Calibrate AR on the Moon or a bright planet',
        detail:
          'Do this before it gets dark, while the object is easy to identify.',
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
          'At flyby the angular size is only a few arcseconds; the trail is the giveaway.',
      },
    },
  },

  plot: {
    goodThreshold: 'good ≥ {degrees}°',
    axisElevation: 'Elevation',
    axisMagnitude: 'V mag',
  },

  terrain: {
    headerTitle: 'Terrain, buildings &amp; best spot',
    headerIntro:
      'Local horizon from the AWS Terrarium DEM and OpenStreetMap buildings, with the Phase 1 Apophis path.',
    badgeDem: 'DEM: —',
    badgeBuildings: 'Buildings: —',
    badgeDemNotPrepared: 'DEM: not prepared',
    offlineTerrainNotPrepared:
      'Offline: terrain is not prepared for this location. Sky and AR still work. Reconnect or move to the prepared area.',
    buildingsOfflineStatus:
      'Offline: no cached or bundled buildings cover this view. Best-spot scores will be marked incomplete. Reconnect or import a building file.',
    statusReady: 'Ready. Pick a point on the map or enter coordinates.',
    observerTitle: 'Observer &amp; map',
    observerMapAria: 'OpenStreetMap location picker',
    observerLat: 'Latitude °',
    observerLon: 'Longitude °',
    observerApply: 'Apply',
    observerRecenter: 'Re-center on map',
    eyeHeight: 'Eye height (m)',
    eyeMode: 'Viewpoint',
    eyeModeGround: 'Ground / custom eye height',
    eyeModeFloor: 'Floor N',
    eyeModeRooftop: 'Rooftop (tallest OSM building)',
    eyeFloor: 'Floor N',
    eyeNoteInitial:
      'Eye height 1.7 m above DEM ground. Floor N uses (N−1)×3 m + 1.7 m; rooftop uses the tallest OSM building at the point + 1.7 m.',
    groundWaiting: 'Ground elevation: waiting for DEM.',
    groundNote:
      'Ground elevation is taken from the DEM. Browser GPS altitude is only a cross-check and is never used. Eye height is added above the DEM ground for the shared sky/AR observer.',
    demTitle: 'Terrain &amp; buildings',
    demNotLoaded: 'DEM: not loaded.',
    demReload: 'Reload DEM',
    demClearCache: 'Clear tile cache',
    demDetailIdle: 'AWS Terrarium z15 max; tiles cached in IndexedDB.',
    buildingsNotLoaded: 'Buildings: not loaded.',
    buildingsFetch: 'Fetch buildings',
    buildingsClearCache: 'Clear cache',
    buildingsRadius: 'Building radius (m)',
    buildingsImportLabel: 'Import GeoJSON / Overpass JSON',
    buildingsImportIdle:
      'Optional fallback: import a building file exported from Overpass or another tool. ODbL attribution applies.',
    buildingsDetailIdle:
      'Bundled area first, then one debounced live query per settled view; no polling.',
    creditsTerrain:
      '<strong>Terrain:</strong> Terrain Tiles by Mapzen / AWS Open Data. Sources include Copernicus EU-DEM, USGS 3DEP/NED, GMTED2010 and SRTM, NOAA ETOPO1, ArcticDEM (DigitalGlobe/NSF), Geoscience Australia, Austria DGM, Canada OGL, INEGI Mexico, LINZ New Zealand, Kartverket Norway and the UK Environment Agency. <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Full attribution</a>.',
    creditsBuildings:
      '<strong>Buildings:</strong> © OpenStreetMap contributors, ODbL. Overpass API.',
    creditsHeightPriority:
      '<strong>Height priority:</strong> <code>building:height</code> → <code>height</code> → <code>building:levels</code>×3 → 8 m default.',
    sceneTitle: 'Local 3D view',
    sceneSubtitle: 'eye-height view',
    sceneAria: 'Local 3D terrain and building view',
    sceneLook: 'Look at Apophis',
    sceneNavN: 'N',
    sceneNavE: 'E',
    sceneNavS: 'S',
    sceneNavW: 'W',
    sceneFov: 'FOV',
    sceneTime: 'Time',
    sceneTimeAria: 'Time scrub',
    timeLabelLocal: '{utc}Z · {local} local',
    sceneHint:
      'Drag to look, scroll/pinch to zoom. The horizon and Apophis trail are depth-tested against the terrain and buildings.',
    sceneNote:
      'The trail uses the once-per-area path. Light pollution is <strong>not</strong> modelled; visibility here is geometric skyline clearance only.',
    horizonTitle: 'Horizon profile',
    horizonSubtitle: '1° bins',
    horizonAria: 'Horizon elevation angle by azimuth',
    horizonEmpty: 'Load a DEM to compute the local horizon.',
    pathWaiting: 'Apophis path: waiting for the simulation session.',
    parallaxWaiting: 'Parallax check: —',
    bestTitle: 'Best spot',
    bestSubtitle: 'Apophis path computed once per area',
    bestSearchRadius: 'Search radius (m)',
    bestSpacing: 'Grid spacing (m)',
    bestMargin: 'Minimum elevation margin (°)',
    bestRun: 'Run search',
    bestCancel: 'Cancel',
    bestStatusIdle:
      'No search yet. The score is the fraction of the physical Phase 1 visibility window above the local horizon plus the margin.',
    bestHeatmapNote:
      'Heatmap: red = 0% clear, green = 100% clear. Tap a numbered result to teleport the local 3D camera and map. The app-wide observer is not changed unless you use “Make this the observer”.',
    bestDisclaimer:
      'Light pollution, sky brightness, weather and trees are not modelled. Buildings come from OSM and may be missing or stale; default-height buildings are marked amber in 3D. Score is geometric skyline clearance only.',
    offlineTitle: 'Offline',
    offlineSubtitle: 'prepare the selected area',
    offlineStatusNone: 'No offline area prepared.',
    offlinePrepare: 'Prepare for offline',
    offlineCancel: 'Cancel',
    offlineClear: 'Clear prepared area',
    offlineStoragePending: 'Storage status not checked yet.',
    offlineStoredNote:
      '<strong>Stored:</strong> ephemeris, star catalogue, AWS Terrarium DEM tiles and OSM building footprints for this area. <strong>Not stored:</strong> OpenStreetMap raster tiles — tile.openstreetmap.org forbids bulk/offline use. The offline base map is a local hillshade plus building footprints. On iOS, Add to Home Screen and open the app weekly; Safari may evict site data after 7 days without a tap.',
    footerMethod:
      '<strong>Method:</strong> AWS Terrarium DEM (Mapzen/joerd) → local ENU mesh with Earth curvature; Overpass <code>way["building"](around:…);out geom;</code>; horizon ray march at 1° azimuth; Phase 1 topocentric Apophis path computed once at the search centre. The 5 km parallax is tens of arcseconds, far below the 1° horizon bin. <strong>Light pollution is not modelled.</strong>',
    footerLicences:
      '<strong>Licences:</strong> Terrain Tiles by Mapzen / AWS Open Data · © OpenStreetMap contributors (ODbL) · Overpass API. Map tiles © OpenStreetMap contributors. See the project notices for full source attribution.',
    footerBuildInfo:
      'Terrain workstream · phases: DEM, buildings, horizon, best spot, local 3D',
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
      'Building radius changed; run the search again.',
    invalidateSearchRadius: 'Search radius changed; run the search again.',
    invalidateSpacing: 'Grid spacing changed; run the search again.',
    invalidateMargin: 'Elevation margin changed; run the search again.',
    invalidateObserver: 'Observer changed; run the search again.',
    invalidateEyeHeight: 'Eye height changed; run the search again.',
    invalidateBuildingsUpdated: 'Buildings updated; run the search again.',
    invalidateBuildingsImported: 'Buildings imported; run the search again.',
    observerMissing:
      'No observer is set. Enter coordinates or pick a point on the map.',
    badgeDemLoading: 'DEM: loading…',
    observerErrorLat: 'Latitude must be between −90° and +90°.',
    observerErrorLon: 'Longitude must be between −180° and +180°.',
    eyeErrorRooftopNoBuildings:
      'Rooftop needs building data at the observer. Fetch buildings first.',
    eyeErrorRooftopNoFootprint:
      'No OSM building footprint at this point; rooftop unavailable. Using the ground eye height.',
    eyeRooftopDetail:
      'Rooftop of OSM way {id}: {height} m ({source}) + 1.7 m eye.',
    eyeDefaultHeight: 'default 8 m height',
    eyeNoteFloor:
      'Floor {floor}: {height} above DEM ground ((N−1)×3 m + 1.7 m).',
    eyeNoteRooftop: 'Rooftop: {height} above DEM ground.',
    eyeNoteGround: 'Eye height {height} above DEM ground.',
    eyeHostAvailable:
      'The shared session eye height is updated through the optional host setter.',
    eyeHostUnavailable:
      'The shared session has no eye-height setter in the required API, so this value is local to the terrain tab; the sky tab keeps its own eye height.',
    eyeNoteSuffix:
      'Floor N uses (N−1)×3 m + 1.7 m; rooftop uses the tallest OSM building + 1.7 m.',
    eyeNoteCombined: '{base} {extra} {suffix} {host}',
    statusDemLoading: 'Loading DEM tiles around {lat}°, {lon}°…',
    statusDemReady:
      'DEM ready: z{zoom}, {spacing} m/px, {tiles} tiles ({failed} failed). Ground elevation {ground}.',
    unknown: 'unknown',
    statusHostDemReady: 'Terrain DEM z{zoom} at {spacing} m/px loaded.',
    statusDemFailed:
      'DEM load failed: {message}. Check the tile service and retry.',
    badgeDemFailed: 'DEM: failed',
    badgeDemProgress: 'DEM: {loaded}/{total}',
    groundUnknown:
      'Ground elevation: unknown until the DEM loads. GPS altitude is not used.',
    groundMismatch:
      'Local scene ground (ENU anchor): {local}; shared astronomy ground (Mercator sample): {shared}. Difference {difference}: the horizon profile, 3D mesh and eye height use the local anchor, while the shared ephemeris/session uses the Mercator ground. GPS altitude is ignored. Local eye altitude: {altitude}.',
    groundOk:
      'Ground elevation from DEM: {ground} above sea level. Local scene anchor and shared astronomy ground agree within 0.1 m. Browser GPS altitude is ignored; it is only a cross-check. Effective eye altitude: {altitude}.',
    demInfo:
      'DEM: z{zoom} · {spacing} m/px · {width} × {height} km · {tiles} tiles ({cached} cached, {network} network, {failed} failed) · Mercator ground {ground}.',
    badgeDemValue: 'DEM: z{zoom} {spacing} m/px',
    demDetailFailed:
      '{count} tiles failed; gaps are transparent in 3D and skipped in the horizon. Use Reload DEM to retry.',
    demDetailOk:
      'Tile-aligned Web Mercator grid resampled to a local ENU frame; Earth curvature applied for distances > 5 km.',
    buildingsOfflineBadge: 'Buildings: offline',
    buildingsOfflineDetail:
      'Offline: no building snapshot was stored for this area. The horizon uses terrain only; import a file or re-prepare online.',
    importNoObserver: 'Set an observer before importing building data.',
    importWaitDem: 'Wait for the DEM to load, then import the building file.',
    importNoPolygons:
      'The file contains no usable building polygons. Nothing was replaced.',
    importSuccessStatus:
      'Imported {count} buildings from {file}; {defaultCount} use the 8 m default. ODbL attribution applies.',
    importSuccessHost: 'Imported {count} building ways from {file}.',
    importFailedStatus: 'Import failed: {message}',
    importFailedHost: 'Building import failed: {message}',
    buildingsAlreadyLoaded:
      'Buildings already loaded for this view ({count} ways).',
    badgeBuildingsLoading: 'Buildings: loading…',
    buildingsLoadedStatus:
      'Buildings: {count} ways within {radius}; {defaultCount} use the {defaultHeight} m default.',
    buildingsLoadedHost: 'Terrain buildings loaded: {count} OSM ways.',
    badgeBuildingsCooldown: 'Buildings: cooldown',
    buildingsRateLimitDetail:
      'Overpass returned HTTP 429. No automatic retry will be made; wait for the cooldown, then press Fetch buildings.',
    buildingsTimeoutStatus:
      '{message} No automatic retry; press Fetch buildings to try again.',
    badgeBuildingsTimeout: 'Buildings: timeout',
    buildingsTimeoutDetail:
      'Overpass timed out or was slow. Data may be incomplete; the best-spot search can still run with existing buildings.',
    overpassError: 'Overpass error: {message}',
    badgeBuildingsError: 'Buildings: error',
    buildingFetchFailed: 'Building fetch failed: {message}',
    buildingsInfo:
      'Buildings: {count} ways · {tagged} tagged · {defaultCount} default ({percent}%) · query {radius} · {source}{sourceLabel}{retrieved}{osm}.',
    buildingsSourceLabel: ' ({label})',
    buildingsRetrieved: ' · retrieved {time}',
    buildingsOsm: ' · OSM {time}',
    badgeBuildingsValue: 'Buildings: {count} ({percent}% default)',
    buildingsNoneDetail:
      'No building ways found in this radius. The horizon will use terrain only.',
    buildingsDefaultDetail:
      '{defaultCount} of {total} ways ({percent}%) use the 8 m fallback height; these extrude amber in 3D. Height priority: building:height → height → building:levels×3 → 8 m. ODbL © OpenStreetMap contributors.',
    buildingsCooldownFinished:
      'Overpass cooldown finished. Press Fetch buildings to query once.',
    badgeBuildingsReady: 'Buildings: ready',
    buildingsCooldown:
      'Overpass cooldown: {seconds} s remaining. No automatic retry.',
    badgeBuildingsCountdown: 'Buildings: {seconds}s',
    cacheTerrainCleared: 'Terrain tile cache cleared.',
    cacheBuildingCleared: 'Building cache cleared.',
    buildInfoValue:
      'Terrain workstream · cached DEM tiles: {tiles} · cached Overpass queries: {queries}',
    pathNoSession: 'Apophis path: the simulation session is not ready.',
    pathNoSessionYet: 'Apophis path: no simulation session yet.',
    pathInfo:
      'Apophis path (Phase 1, airless): <strong>{sector}</strong>; elevation {min}°–{max}°, max at {maxUtc}. Physical visibility {start} → {end}; {samples} samples at 30 s. The path is computed <strong>once</strong> for this search area, not per candidate.',
    parallaxInfo:
      'Parallax over a 5 km baseline: {arcsec}″ at {range} km (worst on the visible path); {geocentricArcsec}″ at {geocentricRange} km (geocentric CA). This is <1° horizon-bin width and shifts edge-of-ridge timing by seconds, not the ranking.',
    horizonBuildingSource: 'building way {id}',
    horizonCandidate: 'candidate {lat}°, {lon}°',
    horizonObserver: 'observer',
    horizonInside:
      ' The viewpoint is inside OSM building way {id} ({height} high); the ground 3D view is inside its walls. Choose Rooftop or move the point.',
    horizonAnchor:
      ' Local ENU anchor; shared astronomy ground is {ground} (Mercator).',
    horizonInfo:
      'Horizon at {location}: ground {ground} + eye {eye} = {total}; 360 bins at 1°; highest obstruction {elevation}° at az {azimuth}° ({source}{distance}); {buildings} buildings considered (within {radius}). Terrain ray distance is limited by the DEM patch.{anchor}{inside}',
    horizonDistance: ', {distance} away',
    sceneMarkerUnavailable: 'Apophis marker unavailable.',
    sceneMarker:
      'Apophis az {az}° el {el}°; horizon {horizon}° → {state}.',
    sceneStateBelow: 'below horizon',
    sceneStateOccluded: 'occluded by terrain/buildings',
    sceneStateVisible: 'visible',
    sceneCamera: 'Camera az {az}° el {el}° · FOV {fov}°. {marker}',
    bestErrorNeedsDem:
      'Best spot needs a loaded DEM and a simulation session. Wait for the DEM, then retry.',
    bestErrorNoWindow: 'No physical visibility window at this observer.',
    bestStatusPreparing:
      'Preparing the search area and building coverage…',
    bestStatusFetchingBuildings:
      'Fetching buildings covering the search area ({radius})…',
    bestWarningBuildingsIncomplete:
      'Building data could not be expanded to cover the whole search area. Scores may be optimistic; buildings from the previous query are still used where available.',
    bestWarningCancelled:
      'Observer or DEM changed during the building fetch; search cancelled. Run it again.',
    bestErrorNoCandidates:
      'No candidate grid points fall inside the DEM. Reload the DEM or choose a smaller radius.',
    bestStatusScoringStart:
      'Scoring {count} candidates in a Web Worker…',
    bestStatusScoring: 'Scoring {processed} / {total} candidates…',
    bestStatusCancelled: 'Best-spot search cancelled.',
    bestStatusCompletePrefix: 'Search complete: ',
    bestStatusCompleteClear:
      '{percent}% clear (pessimistic) at {lat}°, {lon}°',
    bestStatusCompleteNoClear: 'no clear candidates',
    bestStatusCompleteSuffix:
      ' · {count} candidates in {seconds} s.',
    bestHostStatus: 'Best spot: {summary}',
    bestHostTop:
      'Terrain best-spot search found {count} top candidates.',
    bestStatusFailed: 'Search failed: {message}',
    bestStatusHostFailed: 'Best-spot search failed: {message}',
    bestWorkerError: 'worker error',
    bestStatusCancelledShort: 'Search cancelled.',
    bestSummary:
      '{count} candidates · {radius} radius · {spacing} m spacing · {margin}° margin · {pathSamples} path samples · {seconds} s. Ranked by the pessimistic score (default building heights ×1.5); range shows ×0.7 to ×1.5. Score = fraction of the physical Phase 1 visibility window above the local horizon + margin.',
    bestWarningIncomplete:
      'Warning: the Overpass query did not cover the full search area, so some buildings may be missing. Treat open-looking spots as provisional.',
    bestDetailEmpty:
      'No scored candidates. Check the DEM coverage.',
    bestDetailHint:
      'Tap a result to move the local 3D camera and map. “Rank ±N” means the spot moves N places between optimistic and pessimistic default heights. The app-wide observer and the shared Phase 1 path are unchanged.',
    bestViewpoint:
      '<strong>Local viewpoint #{rank}</strong> at {lat}°, {lon}° · ground {ground} · pessimistic score {score}% (optimistic {optimistic}%) · rank {rankPessimistic} (optimistic rank {rankOptimistic}, spread {spread}) · min clearance {clearance}°. {reason}',
    bestMakeObserver: 'Make this the observer',
    bestSummaryNone: 'No current search result.',
    bestSummaryInitial: 'No search yet.',
    footerBuildInfoInitial:
      'Terrain workstream · cached DEM tiles: — · cached Overpass queries: —',
    blockersDefault: '{count} default-height',
    blockersReal: '{count} real-height',
    blockersTerrain: 'terrain',
    blockersNone: 'none',
    openNoBuildings: 'no mapped buildings',
    openInside: 'inside a building footprint',
    openNearest: '{distance} m to nearest building',
    rankFlag: 'rank ±{spread}',
    rankFlagTitle: 'Rank changes with the height assumption',
    rank: '#{rank}',
    scoreRange:
      '{optimistic}–{pessimistic}% across height assumptions',
    blockers: 'Blockers: {blockers} · {openSpace}',
    offlinePreparedStatus:
      'Offline area ready · {bytes} · prepared {date}.',
    offlineStatusPreparing: 'Preparing offline area…',
    offlineStatusCancelled: 'Offline preparation cancelled.',
    offlineStatusFailed: 'Offline preparation failed: {message}',
    offlineErrorNoObserver:
      'Set an observer before preparing an offline area.',
    offlineErrorOffline:
      'Cannot prepare offline data while offline. Reconnect, then press Prepare for offline.',
    offlinePreparedHost: 'Offline area prepared for this location.',
    offlineCleared: 'Offline data cleared.',
    offlineClearConfirm:
      'Clear the prepared offline area, cached DEM tiles and cached building data? The app shell itself stays installed.',
    offlineStatusOfflineNoSnapshot:
      'Offline mode, but no prepared snapshot was found. Reconnect and prepare an area.',
    offlineRunning: ' · running offline from this snapshot',
    offlineStatusPrepared: 'Prepared {date} · {bytes}{active}.',
    offlineContentsEphemeris:
      '<li><strong>Ephemeris:</strong> {provider} · solution {solution} · retrieved {retrieved} · {bytes}</li>',
    offlineContentsStars:
      '<li><strong>Stars:</strong> {stars}</li>',
    offlineContentsTerrain:
      '<li><strong>Terrain:</strong> {tiles} DEM tiles at z{zoom} · {bytes} · {attribution}</li>',
    offlineContentsBuildings:
      '<li><strong>Buildings:</strong> {buildings}</li>',
    offlineContentsBaseMap:
      '<li><strong>Base map:</strong> locally rendered hillshade from cached DEM + building footprints; OSM raster tiles are not stored.</li>',
    offlineNotStored: 'not stored',
    offlineBuildingsValue:
      '{count} OSM ways · {defaultCount} default height · {bytes} · {source}{sourceLabel}',
    offlineBuildingsMissing:
      'not stored; best-spot scores will be marked incomplete',
    offlineMismatchWarning:
      'This observer is outside the prepared area. Sky and AR still work; terrain maps and best-spot searches for this location do not.',
    offlineBuildingsNotPrepared:
      'Buildings: not prepared for this offline location.',
    offlineDemNotPrepared:
      'DEM: not prepared for this offline location.',
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
      'Checking for a bundled building area…',
    buildingsProgressNoBundledCoverage:
      'No bundled area covers this view; querying Overpass…',
    buildingsProgressLoadingBundled:
      'Loading bundled area "{area}" for buildings within {radius} km…',
    buildingsProgressLoadedBundled:
      'Loaded {count} buildings from the bundled area "{area}".',
    buildingsProgressBundledUnavailable:
      'Bundled building area unavailable; querying Overpass…',
    buildingsProgressCheckingCache: 'Checking the local building cache…',
    buildingsProgressCacheHit:
      'Loaded {count} buildings from cache ({source}).',
    buildingsProgressRetry:
      '{action} {endpoint} in {seconds} s…',
    buildingsProgressRetryAction: 'Retrying',
    buildingsProgressFallbackAction: 'Trying the fallback endpoint',
    buildingsProgressQuerying:
      'Querying {endpoint} for buildings within {radius} km…',
    buildingsProgressLoaded:
      'Loaded {count} buildings; {defaultCount} use the {defaultHeight} m default.',
    buildingsProgressUnreachable:
      '{endpoint} could not be reached; trying the fallback endpoint once.',
    buildingsProgressHttp406:
      '{endpoint} blocked the request (HTTP 406); switching endpoints without retrying it.',
    buildingsRateLimit:
      'Overpass rate limit reached (HTTP 429). Wait {seconds} s before trying again.',
    buildingsEndpointError:
      'Overpass endpoint {endpoint} responded HTTP {status}{body}',
    buildingsResponseError: 'Overpass responded HTTP {status}{body}',
    buildingsInvalidJson:
      'Overpass returned a response that is not valid JSON.',
    buildingsRemark: 'Overpass: {remark}',
    buildingsTimeout: 'Overpass did not answer within {seconds} s.',
    buildingsAllFailed:
      'All Overpass endpoints failed. No building data was written or cached.',
    buildingsHttpBody: ': {body}',
    buildingsSourceBundled: 'Bundled area: {name}',
    importedAreaSource: 'Imported area: {name}',
    buildingsTimeoutDefault: 'Overpass request timed out',
    buildingsNoElements: 'Overpass response has no elements array',
    gridProgressLoading: 'Loading {count} DEM tiles at z{zoom}…',
    gridProgressTiles:
      'Loading DEM tiles: {loaded}/{total} ({cached} cached)',
    gridProgressStitching: 'Stitching {count} tiles…',
    gridProgressReady:
      'DEM ready: z{zoom}, {spacing} m/px',
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
    resultTooltip: '#{rank} · {percent}% clear (pessimistic)',
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
    empty: 'Load a DEM to compute the local horizon.',
    legendHorizon: 'horizon: terrain + buildings',
    legendPath: 'Apophis path (red = below horizon/margin)',
  },

  bestSpot: {
    insideBuilding:
      'Inside OSM building {id}; not a ground-level observing spot. Choose a rooftop eye height or another point.',
    noWindow: 'No physical Phase 1 visibility window at this location.',
    clearWhole:
      'Clear for the whole visible window (minimum clearance {clearance}°).',
    clearPercent:
      '{percent}% of the visible window is clear.',
    marginLimited:
      '{source}{direction} {verb} less than the {margin}° margin from Apophis at {when}; {percent}% of the visible window is clear.',
    blocked:
      'Blocked by {source}{direction} from {when}; {percent}% of the visible window is clear (minimum clearance {clearance}°).',
    sourceBuildings: 'buildings',
    sourceTerrain: 'terrain',
    sourceHorizon: 'the horizon',
    verbBuildings: 'leave',
    verbOther: 'leaves',
    direction: ' to the {direction}',
    whenLocal: '{time} UTC ({local} local)',
    whenUtc: '{time} UTC',
    parallaxWorst: 'worst case along the visible path',
    parallaxGeocentric: 'at geocentric closest approach',
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
    geoRing: 'GEO ring 42,164 km',
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
      'No offline area is prepared. Connect to the internet, open Local 3D and use “Prepare for offline”, then try again.',
    browserOffline:
      'Browser location is not used offline. Set coordinates manually or reconnect.',
    requesting: 'Requesting browser location…',
    ephemerisFetchFailed: 'Ephemeris fetch failed: HTTP {status}',
    fromUrl: 'Observer set from URL parameters.',
    locatingPreview:
      'Locating you… showing Brasov preview. You can set a location manually.',
    offlineNoPreparedArea: 'Offline mode: no prepared area.',
    offlineNotPrepared:
      'Offline: this location is not prepared. Terrain, buildings and the offline base map are only available near {area}. Sky and AR still work for the selected coordinates.',
    offlineUsingPrepared:
      'Offline: using the prepared area {area}{urlSuffix}. Prepared {preparedAt}.',
    offlineUrlSuffix: ' (URL coordinates)',
    offlineMismatch:
      'Offline: terrain and buildings are only prepared for {area}. Sky and AR still work here.',
    offlineAllAvailable:
      'Offline: all sky/AR data and the prepared terrain area are available. Prepared {preparedAt}.',
    offlineOneArea: 'one area',
    geolocationUnavailable:
      'Geolocation is unavailable. Using the Brasov preview; set coordinates or a preset.',
    usingBrowser:
      'Using browser location. GPS altitude ignored; eye height 1.7 m above unknown ground (no terrain data).',
    denied:
      'Location permission denied or unavailable. Using the Brasov preview; set coordinates or choose a preset.',
    presetStatus:
      '{preset} preset. Ground elevation {elevation} m + eye height; no terrain data.',
    validationLat: 'Latitude must be between -90 and 90 degrees.',
    validationLon: 'Longitude must be between -180 and 180 degrees.',
    validationEyeHeight: 'Eye height must be between 0 and 100 m.',
    validationGroundOptional:
      'Ground elevation must be between -500 and 9000 m, or left blank.',
    validationGround:
      'Ground elevation must be between -500 and 9000 m.',
    manualStatus:
      'Manual location. Ground elevation {ground} + {eye} m eye height; no terrain data.',
    groundUnknownAssumed: 'unknown (0 m assumed)',
    groundValue: '{elevation} m',
    timeOutsideWindow:
      'Requested time is outside the committed ±24 h data window; clamped.',
    endOfWindow: 'Reached the end of the data window.',
    fromTerrain: 'Observer moved from the terrain/map panel.',
    groundFromDem:
      'Ground elevation {elevation} m from the terrain DEM; eye height {eye} m.',
    eyeHeightStatus:
      'Eye height {eye} m above ground; no terrain occlusion in the shared sky readout.',
    noJump:
      'No {target} available for this observer in the data window.',
    noObserver: 'No observer set',
    observerSummary:
      '{lat}°, {lon}°, {elevation} m effective',
  },

  offline: {
    cancelled: 'Offline preparation cancelled',
    requestStorage: 'Requesting persistent storage…',
    storageWarning:
      'Persistent storage was not granted. The browser may evict offline data; on iOS, add the app to the Home Screen and open it at least once a week.',
    downloadingEphemeris: 'Downloading the committed ephemeris…',
    ephemerisLabel: 'Ephemeris',
    invalidEphemeris: 'The downloaded ephemeris is invalid.',
    missingMetadata:
      'The ephemeris is missing its target/solution metadata.',
    downloadingStars: 'Downloading the star catalogue…',
    starsLabel: 'Star catalogue',
    starsUnavailable:
      'Star catalogue unavailable: {message}. The sky still works without labels.',
    downloadingTerrain: 'Downloading and caching DEM tiles…',
    terrainFailed: 'Terrain preparation failed: {message}',
    missingTiles:
      '{count} DEM tiles could not be stored in IndexedDB. The browser storage may be full or blocked. Free space and try again.',
    failedTiles:
      '{count} DEM tiles failed to download; offline terrain has gaps there. Re-prepare when the network is stable.',
    cachedTiles: 'Cached {count} DEM tiles at z{zoom}.',
    fetchingBuildings: 'Fetching OSM building footprints…',
    buildingsUnavailable:
      'Building data unavailable: {message}. Best-spot scores will be marked incomplete.',
    writingSnapshot: 'Writing the offline snapshot metadata…',
    snapshotFailed:
      'The offline snapshot could not be saved. Browser storage is full or unavailable. Clear the prepared area or free storage and try again.',
    storageNearlyFull:
      'Storage is over 90% full. Further updates may fail; consider a smaller search radius or clearing browser data.',
    persistentGranted:
      'Persistent storage is now granted for this origin.',
    done: 'Offline area ready.',
    downloadFailed:
      '{label} could not be downloaded: {error}',
    downloadHttp: '{label} download failed: HTTP {status}',
    invalidJson: '{label} is not valid JSON',
    baseMapNote:
      'Offline base map is rendered locally from cached DEM tiles plus OSM building footprints. OSM raster tiles are not stored because tile.openstreetmap.org forbids bulk/offline use.',
    verifyMissingTiles:
      '{missing} of {total} DEM tiles are missing. The browser may have evicted site data; re-prepare the area.',
    verifyEphemeris:
      'The stored ephemeris is missing or truncated. Re-prepare the area.',
  },

  startup: {
    title: 'Apophis Watch could not start',
    offlineHint:
      'If you are offline, prepare an area while online first: open <strong>Local 3D</strong> → <strong>Prepare for offline</strong>. Then reload.',
  },
} as const;
