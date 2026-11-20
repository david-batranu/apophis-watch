/**
 * Public entry point for the Phase 3 terrain workstream.
 *
 * The orchestrator mounts this into a new app tab:
 *
 *   import { createTerrainWorkstream } from './terrain';
 *   const terrain = createTerrainWorkstream(root, api);
 *   terrain.mount();
 *   terrain.update(store.getState());
 *
 * The module owns its DOM and all DEM/building/3D resources; shared state is
 * read-only and observer/ground/time changes go through TerrainHostApi.
 */

import type { TerrainHostApi, TerrainWorkstream } from './host';
import { TerrainUi } from './ui';

export type {
  TerrainHostApi,
  TerrainWorkstream,
} from './host';

export {
  DEFAULT_BUILDING_HEIGHT_M,
  DEFAULT_BUILDING_RADIUS_M,
  MAX_BUILDING_QUERY_RADIUS_M,
  buildOverpassQuery,
  buildingHeightFromTags,
  parseHeightMeters,
  parseOverpassBuildings,
} from './buildings';
export { computeHorizonProfile, computeHorizonSlopes } from './horizon';
export { buildApophisPath, observerKey, summarizePath } from './path';
export {
  describeBestSpot,
  generateSearchCandidates,
  heatmapColor,
  searchBestSpots,
  searchBestSpotsSync,
} from './bestSpot';
export {
  curvatureDropM,
  enuToLatLon,
  latLonToEnu,
  parallaxArcsec,
} from './geo';
export {
  loadTerrainGrid,
  sampleGridEnu,
  sampleGridLatLon,
  sceneGroundElevationM,
} from './terrainGrid';
export {
  TERRARIUM_ATTRIBUTION,
  decodeTerrarium,
  encodeTerrarium,
  terrariumTileUrl,
} from './terrarium';
export { chooseTerrainZoom, groundResolutionM } from './mercator';

export function createTerrainWorkstream(
  root: HTMLElement,
  api: TerrainHostApi,
): TerrainWorkstream {
  return new TerrainUi(root, api);
}
