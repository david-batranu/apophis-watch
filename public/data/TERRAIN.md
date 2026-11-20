# Terrain, buildings and map attribution

This file is served with the app so the runtime credits can link to it.

## Terrain Tiles

**Terrain Tiles by Mapzen / AWS Open Data**:
<https://registry.opendata.aws/terrain-tiles>

The required upstream attribution list is:
<https://github.com/tilezen/joerd/blob/master/docs/attribution.md>

It includes, among others: Copernicus EU-DEM (“Produced using Copernicus data
and information funded by the European Union - EU-DEM layers”), USGS
3DEP/NED, SRTM and GMTED2010 (“courtesy of the U.S. Geological Survey”),
NOAA ETOPO1, ArcticDEM (DigitalGlobe/NSF), Geoscience Australia, DGM Austria,
Canada OGL, INEGI Mexico, LINZ New Zealand, Kartverket Norway, and the UK
Environment Agency. The app uses the Terrarium PNG tiles at
`elevation-tiles-prod.s3.amazonaws.com` (256×256, max zoom 15) and caches them
in IndexedDB. Terrain Tiles are licensed **CC-BY 4.0**; explicit persistent
caching and offline storage are permitted. The S3 objects have no
`Cache-Control` header, so the app caches them deliberately.

## Buildings and map tiles

**© OpenStreetMap contributors**, data under the **Open Database Licence
(ODbL) 1.0**: <https://www.openstreetmap.org/copyright>

Buildings are queried through the **Overpass API** with a debounced, cached,
building-only query per settled view. No bulk scraping or polling. The app
checks a bundled GeoJSON area first, then a live mirror (dresel EU/NA, then
overpass-api.de), and offers a manual GeoJSON/Overpass import as a fallback.
The build-time script uses one serial request with a descriptive User-Agent,
2.5 s spacing and 30→60→120 s backoff; it never runs in parallel. See
`public/data/areas/README.md`.

**OpenStreetMap raster tiles are online-only.** The standard tile service
(`tile.openstreetmap.org`) explicitly forbids bulk downloading, prefetching and
offline use. The app never prefetches or stores those tiles. When offline, the
base map is a locally rendered hillshade from cached AWS Terrarium DEM plus OSM
building footprints. Online, the Leaflet map displays raster tiles only for the
current viewport with the required attribution.

## Leaflet

**Leaflet** is BSD-2-Clause: <https://leafletjs.com/>.

## Not modelled

Light pollution, sky brightness, weather, trees and distant terrain beyond the
loaded DEM patch are not modelled. Best-spot scores are geometric skyline
clearance only.
