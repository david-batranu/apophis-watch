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
in IndexedDB.

## Buildings and map tiles

**© OpenStreetMap contributors**, data under the **Open Database Licence
(ODbL) 1.0**: <https://www.openstreetmap.org/copyright>

Buildings are queried through the **Overpass API** (<https://overpass-api.de/>)
with a debounced, cached, building-only query per settled view. No bulk
scraping or polling. Map tiles are displayed with the required OSM attribution
in the Leaflet map.

## Leaflet

**Leaflet** is BSD-2-Clause: <https://leafletjs.com/>.

## Not modelled

Light pollution, sky brightness, weather, trees and distant terrain beyond the
loaded DEM patch are not modelled. Best-spot scores are geometric skyline
clearance only.
