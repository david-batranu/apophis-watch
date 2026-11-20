# Third-party notices — Apophis Watch

## Ephemeris

NASA/JPL Horizons, orbit solution JPL#220, retrieved 2026-11-19. The committed
state vectors are NASA/JPL data; see `public/data/apophis-2029.json` for the
exact query and retrieval timestamp.

## astronomy-engine

MIT License. Copyright Don Cross. Used for Sun/Moon/planet positions, sidereal
time, precession/nutation and rise/set helpers.
<https://github.com/cosinekitty/astronomy>

## Stars — HYG Database v4.4

- Source: <https://codeberg.org/astronexus/hyg>
- Commit: `53e3df311869e813ace5f1ad2ec4ce909f13256c`
- Licence: **CC BY-SA 4.0** — <https://creativecommons.org/licenses/by-sa/4.0/>
- Attribution: David Nash / Astronomy Nexus, HYG Database v4.4.
- Changes: filtered to apparent magnitude < 5, converted to JSON.
- The derived star data in `public/data/stars.json` remains **CC BY-SA 4.0**.
- HYG is partly derived from Hipparcos (ESA). ESA distributes Hipparcos under
  **CC BY-NC 3.0 IGO**; review that restriction before any commercial use.

## Constellation lines — ConstellationLines v1.4

- Source: <https://github.com/MarcvdSluys/ConstellationLines>
- Commit: `158ea7c588dd78a295dc977326e72ad29004d8eb`
- DOI: <https://doi.org/10.5281/zenodo.23210182>
- Licence: **CC BY 4.0** — <https://creativecommons.org/licenses/by/4.0/>
- Copyright: Marc van der Sluys, 2005–2026.
- Changes: joined BSC HR-number vertices to J2000 RA/Dec from HYG and
  reformatted as JSON. Nine of 840 vertices are absent from HYG; polylines are
  split there rather than bridged.

## Terrain, buildings and maps

- **Terrain Tiles by Mapzen / AWS Open Data**:
  <https://registry.opendata.aws/terrain-tiles> and
  <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>.
  Licensed **CC-BY 4.0**; persistent IndexedDB/offline caching is permitted.
  Required sources include Copernicus EU-DEM, USGS 3DEP/SRTM/GMTED2010,
  NOAA ETOPO1, and national datasets listed at the attribution link.
- **Buildings and map data:** © OpenStreetMap contributors, ODbL 1.0
  (<https://www.openstreetmap.org/copyright>). Buildings come from the Overpass
  API or a bundled GeoJSON/Overpass import. The build-time fetch is serial,
  identified, and rate-limited; no bulk scraping or polling.
- **OSM standard raster tiles:** online viewport display only. The app does not
  prefetch, bulk-download or store `tile.openstreetmap.org` tiles; their usage
  policy forbids offline use. The offline base map is locally rendered from
  cached terrain tiles and building footprints.
- **Leaflet:** BSD-2-Clause, <https://leafletjs.com/>.

## World Magnetic Model

WMM2025 coefficients via `geomagnetism@0.2.0`, Apache-2.0. WMM2025 is produced
by NOAA/NCEI and the British Geological Survey; see
<https://www.ncei.noaa.gov/products/world-magnetic-model>. The package covers
2024-11-13 through 2029-11-13; the AR module marks extrapolated or unsupported
dates explicitly.

## Size-comparison figures

- Moon mean diameter 3,474.8 km: NASA Moon Fact Sheet,
  <https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html>
- ISS 109 m array span: NASA ISS reference,
  <https://www.nasa.gov/reference/international-space-station/>
- Football pitch 105 m length: FIFA stadium guidelines / IFAB Laws of the Game.
- Eiffel Tower 330 m including antennas: official Eiffel Tower figures,
  <https://www.toureiffel.paris/en/the-monument/key-figures>
- Apophis 340 m: JPL Horizons equivalent radius 0.170 km.
