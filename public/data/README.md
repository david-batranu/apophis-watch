# Bundled star catalogue and constellation lines

## Stars — HYG Database v4.4

- Source: https://codeberg.org/astronexus/hyg
- Pinned commit: 53e3df311869e813ace5f1ad2ec4ce909f13256c
- Licence: **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: David Nash / Astronomy Nexus, HYG Database v4.4.
- Changes: filtered to apparent magnitude < 5, reformatted as JSON.
- The derived star data in `stars.json` remains **CC BY-SA 4.0**.
- HYG is partly based on Hipparcos (ESA). ESA's Hipparcos catalogue is
  distributed under CC BY-NC 3.0 IGO; review that restriction before any
  commercial use.

## Constellation lines — ConstellationLines v1.4

- Source: https://github.com/MarcvdSluys/ConstellationLines
- Pinned commit: 158ea7c588dd78a295dc977326e72ad29004d8eb
- DOI: 10.5281/zenodo.23210182
- Licence: **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/)
- Copyright: Marc van der Sluys, 2005–2026.
- Changes: joined BSC HR-number vertices to J2000 RA/Dec from HYG and
  reformatted as JSON. Line vertices include stars fainter than V=5.

## Generated

- Retrieved: 2026-11-20T00:37:09.857Z
- Stars: 1615; constellation polylines: 90
- Missing BSC HR line vertices: 9 of 840 (lines are split there, not bridged)
- Combined file: 183.2 KiB
