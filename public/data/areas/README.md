# Bundled building areas

Static building footprints for known observing sites. The app checks
`data/areas/index.json` after its IndexedDB cache misses and before it queries
Overpass. A bundled area is used only when it **fully covers** the requested
circle; a partial area is never used as if it were complete.

All OSM-derived files here are:

- **© OpenStreetMap contributors**
- Licensed under the **Open Database Licence (ODbL) 1.0**
  <https://opendatacommons.org/licenses/odbl/1-0/>
- Attribution: <https://www.openstreetmap.org/copyright>

Keep the attribution and licence notice with any copy or redistribution. If
you publicly use a derived database, ODbL share-alike applies to that database.

## Run the build script

```sh
npm run fetch:buildings -- \
  --lat=45.6427 --lon=25.5887 --radius=1500 --name=brasov

# Without the npm alias:
npx tsx scripts/fetch-buildings.ts \
  --lat=45.6427 --lon=25.5887 --radius=1500 --name=brasov
```

Options: `--lat`, `--lon`, `--radius` (metres, 1–20000), `--name`, optional
`--slug`, `--out=DIR`, `--dry-run`, `--help`. The default output directory is
this directory. `--dry-run` prints the exact query and mirror order without
touching the network or filesystem.

The script:

1. Queries building ways only with
   `[out:json][timeout:60][maxsize:268435456];way["building"](around:R,LAT,LON);out geom;`
2. Uses one serial request at a time, a descriptive User-Agent, and at least
   2.5 s between attempts. No stock browsers UAs, no UA rotation, no parallel
   scripts.
3. Tries mirrors in this order: in Europe, dresel EU (`/api/interpreter`) first;
   in North-American longitudes, dresel NA (`/api-na/interpreter`) first;
   elsewhere `overpass-api.de` first. The remaining mirrors are
   `overpass-api.de`, `maps.mail.ru`, and `overpass.private.coffee`.
4. Backs off **30 → 60 → 120 s** on HTTP 429/502/503/504, with at most three
   attempts per endpoint. HTTP 406 is treated as an Apache User-Agent block:
   the script waits 30 s and moves to the next mirror rather than repeating the
   same client/endpoint. A 4xx query error stops the run.
5. Writes nothing if every endpoint fails. Outputs are written to temporary
   files and renamed into place.

Respect the public Overpass service: roughly **100 queries/day** for scripts
(divide by 100 again for regular/interactive use), **< 10 MB/day**, and at most
**two connections** (one for scripts). Do not run this in a loop, in parallel,
or as part of the app's runtime. Browser requests need an HTTP `Referer`;
scripts do not, but they must identify themselves with a descriptive
User-Agent. Do not prefetch, bulk-download, or cache `tile.openstreetmap.org`
tiles: that is forbidden by the tile policy. This workstream does not touch
terrain tiles.

## Files written

- `<slug>.geojson` — a `FeatureCollection`. Each feature is a `Polygon` with
  `[lon, lat]` coordinates (outer ring only). Properties:
  `osmId`, `heightM`, `heightSource`, `levels`, and the original `tags`.
- `<slug>.json` — provenance sidecar: centre, radius, source endpoint, exact
  query, retrieval time, `timestamp_osm_base`, counts, licence and attribution.
- `index.json` — the sorted manifest. Adding one area replaces only the entry
  with the same slug; other entries are preserved.

Height priority is identical to the live parser:
`building:height` → `height` → `building:levels × 3` → **8 m default**. Each
feature records which source was used. `heightSource: "default"` means no
height tags were present; it does not mean the building is 8 m tall.

## Manifest entry

`index.json` has this shape (only `slug`, `name`, centre, radius and `file` are
required by the loader):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-20T12:00:00.000Z",
  "license": "ODbL",
  "attribution": "© OpenStreetMap contributors",
  "areas": [
    {
      "slug": "brasov",
      "name": "Brasov",
      "centerLatDeg": 45.6427,
      "centerLonDeg": 25.5887,
      "radiusM": 1500,
      "file": "brasov.geojson",
      "metadataFile": "brasov.json",
      "buildingCount": 1234,
      "defaultHeightCount": 321,
      "taggedHeightCount": 913,
      "retrievedAt": "2026-11-20T12:00:00.000Z",
      "osmTimestamp": "2026-11-20T10:00:00Z",
      "license": "ODbL",
      "attribution": "© OpenStreetMap contributors",
      "sourceEndpoint": "https://ovp.dresel.systems/api/interpreter",
      "sourceQuery": "[out:json][timeout:60][maxsize:268435456];way[\"building\"](around:1500,45.642700,25.588700);out geom;"
    }
  ]
}
```

Coverage test: let `d` be the great-circle distance between the requested
centre and the area centre. The area is used only when
`d + requestedRadius <= area.radiusM` (with 1 m slack). If the area is smaller
or offset, the app goes to the live Overpass path instead of silently using
partial footprints.

## Manual import

You can add an area without running the script:

1. Produce a GeoJSON `FeatureCollection` of building footprints with
   `Polygon` or `MultiPolygon` geometry in WGS84 `[lon, lat]` order. Put OSM
   tags under `properties.tags` (a flat `building`, `height`,
   `building:height`, `building:levels` also works). Height priority is
   recomputed from those tags.
2. Save it as `data/areas/<slug>.geojson`.
3. Add or update the manifest entry with the correct centre, radius, file,
   licence and – ideally – source query/retrieval metadata.
4. Optionally add `<slug>.json` with the same provenance shape as the script
   output. If the sidecar is missing, top-level GeoJSON foreign members
   (`retrievedAt`, `osmTimestamp`, `sourceEndpoint`, `sourceQuery`, `license`)
   are used when present.

Imports made with `parseImportedBuildings()` accept either a GeoJSON document
or raw Overpass `out geom;` JSON. Invalid rings (too few points, non-finite or
out-of-range coordinates, zero-area rings) are skipped; no placeholder geometry
is generated. `MultiPolygon` outer rings become separate footprints. Holes are
ignored because the horizon model treats each footprint as solid and
`BuildingFeature` carries a single ring.

## Limitations

- OSM coverage and height tagging vary by city. A missing building is missing,
  not zero-height.
- Only building **ways** are fetched. Building relations and parts are not
  assembled; the Overpass query used here does not request them.
- Interior courtyards (holes) are not represented.
- Bundled snapshots age. Re-run the script when the area changes materially and
  keep `retrievedAt`/`osmTimestamp` in the metadata.
- This directory is not a tile cache and must not be used to prefetch OSM map
  tiles.
