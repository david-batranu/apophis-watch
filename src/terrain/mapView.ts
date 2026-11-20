/**
 * Leaflet map picker, search-area circles and best-spot heatmap.
 * OpenStreetMap tiles with the required attribution; no geocoding service.
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { t } from '../i18n';
import { enuToLatLon } from './geo';
import { heatmapColor } from './bestSpot';
import type { BestSpotSummary, TerrainGrid } from './types';

export interface TerrainMapOptions {
  onObserverPick: (latitudeDeg: number, longitudeDeg: number) => void;
  onResultPick?: (resultIndex: number) => void;
  /** Start without the online OSM raster layer (offline boot). */
  offline?: boolean;
}

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = t('map.attributionOsm');
const OFFLINE_ATTRIBUTION = t('map.attributionOffline');

export class TerrainMap {
  private readonly map: L.Map;
  private readonly container: HTMLElement;
  private readonly observerMarker: L.Marker;
  private tileLayer: L.TileLayer | null = null;
  private offlineOverlay: L.ImageOverlay | null = null;
  private offlineMode: boolean;
  private searchCircle: L.Circle | null = null;
  private buildingCircle: L.Circle | null = null;
  private heatmap: L.ImageOverlay | null = null;
  private resultMarkers: L.CircleMarker[] = [];
  private viewpointMarker: L.CircleMarker | null = null;
  private lastObserver: { lat: number; lon: number } | null = null;
  private disposed = false;

  constructor(container: HTMLElement, private readonly options: TerrainMapOptions) {
    this.container = container;
    this.map = L.map(container, {
      center: [45.6427, 25.5887],
      zoom: 15,
      zoomControl: true,
      preferCanvas: true,
      worldCopyJump: true,
    });
    this.offlineMode = options.offline === true;
    if (!this.offlineMode) {
      this.tileLayer = L.tileLayer(OSM_URL, {
        maxZoom: 19,
        attribution: OSM_ATTRIBUTION,
      }).addTo(this.map);
    } else {
      this.map.attributionControl.addAttribution(OFFLINE_ATTRIBUTION);
    }
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    const icon = L.divIcon({
      className: 'tw-pick-marker',
      html: '<span></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    this.observerMarker = L.marker([45.6427, 25.5887], {
      icon,
      draggable: true,
      keyboard: true,
      title: t('map.markerObserverTitle'),
      bubblingMouseEvents: false,
    }).addTo(this.map);
    this.observerMarker.on('dragend', () => {
      const position = this.observerMarker.getLatLng();
      this.lastObserver = { lat: position.lat, lon: position.lng };
      this.options.onObserverPick(position.lat, position.lng);
    });

    this.map.on('click', (event: L.LeafletMouseEvent) => {
      this.lastObserver = { lat: event.latlng.lat, lon: event.latlng.lng };
      this.observerMarker.setLatLng(event.latlng);
      this.options.onObserverPick(event.latlng.lat, event.latlng.lng);
    });
  }

  private distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    return this.map.distance([a.lat, a.lon], [b.lat, b.lon]);
  }

  setObserver(
    latitudeDeg: number,
    longitudeDeg: number,
    options: { recenter?: boolean } = {},
  ): void {
    if (this.disposed) return;
    const position = { lat: latitudeDeg, lon: longitudeDeg };
    this.observerMarker.setLatLng([latitudeDeg, longitudeDeg]);
    const shouldRecenter =
      options.recenter === true ||
      this.lastObserver === null ||
      this.distanceM(this.lastObserver, position) > 30;
    this.lastObserver = position;
    if (shouldRecenter) {
      this.map.setView([latitudeDeg, longitudeDeg], Math.max(this.map.getZoom(), 15), {
        animate: false,
      });
    }
  }

  setViewpoint(latitudeDeg: number, longitudeDeg: number): void {
    if (this.disposed) return;
    if (!this.viewpointMarker) {
      this.viewpointMarker = L.circleMarker([latitudeDeg, longitudeDeg], {
        radius: 7,
        color: '#7fe7ff',
        weight: 2,
        fillColor: '#0b2630',
        fillOpacity: 0.9,
        bubblingMouseEvents: false,
      })
        .bindTooltip(t('map.viewpointTooltip'), { direction: 'top' })
        .addTo(this.map);
    } else {
      this.viewpointMarker.setLatLng([latitudeDeg, longitudeDeg]);
    }
  }

  focus(latitudeDeg: number, longitudeDeg: number, zoom = 17): void {
    if (this.disposed) return;
    this.map.setView([latitudeDeg, longitudeDeg], zoom, { animate: false });
  }

  clearViewpoint(): void {
    if (this.disposed || !this.viewpointMarker) return;
    this.map.removeLayer(this.viewpointMarker);
    this.viewpointMarker = null;
  }

  setSearchArea(
    latitudeDeg: number,
    longitudeDeg: number,
    radiusM: number,
    buildingRadiusM: number,
  ): void {
    if (this.disposed) return;
    if (!this.searchCircle) {
      this.searchCircle = L.circle([latitudeDeg, longitudeDeg], {
        radius: radiusM,
        color: '#7fe7ff',
        weight: 1.5,
        opacity: 0.8,
        fill: false,
        dashArray: '5 5',
        interactive: false,
      }).addTo(this.map);
    } else {
      this.searchCircle.setLatLng([latitudeDeg, longitudeDeg]);
      this.searchCircle.setRadius(radiusM);
    }
    if (!this.buildingCircle) {
      this.buildingCircle = L.circle([latitudeDeg, longitudeDeg], {
        radius: buildingRadiusM,
        color: '#ffb347',
        weight: 1,
        opacity: 0.7,
        fill: false,
        dashArray: '2 6',
        interactive: false,
      }).addTo(this.map);
    } else {
      this.buildingCircle.setLatLng([latitudeDeg, longitudeDeg]);
      this.buildingCircle.setRadius(buildingRadiusM);
    }
  }

  clearBestSpots(): void {
    if (this.heatmap) {
      this.map.removeLayer(this.heatmap);
      this.heatmap = null;
    }
    for (const marker of this.resultMarkers) this.map.removeLayer(marker);
    this.resultMarkers = [];
  }

  /**
   * Heatmap is drawn at candidate-grid resolution and stretched by Leaflet.
   * Only the top results get clickable markers, which keeps the DOM small.
   */
  setBestSpots(summary: BestSpotSummary, grid: TerrainGrid): void {
    this.clearBestSpots();
    if (summary.candidates.length === 0) return;
    const radius = summary.radiusM;
    const spacing = summary.spacingM;
    const size = Math.max(2, Math.round((radius * 2) / spacing) + 1);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      for (const candidate of summary.candidates) {
        const px = Math.round((candidate.eastM + radius) / spacing);
        const py = Math.round((radius - candidate.northM) / spacing);
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        ctx.fillStyle = heatmapColor(candidate.scorePessimistic);
        ctx.fillRect(px, py, 1, 1);
      }
      const sw = enuToLatLon(-radius, -radius, grid.originLatDeg, grid.originLonDeg);
      const ne = enuToLatLon(radius, radius, grid.originLatDeg, grid.originLonDeg);
      const bounds: L.LatLngBoundsExpression = [
        [sw.latitudeDeg, sw.longitudeDeg],
        [ne.latitudeDeg, ne.longitudeDeg],
      ];
      this.heatmap = L.imageOverlay(canvas.toDataURL('image/png'), bounds, {
        opacity: 0.62,
        interactive: false,
        className: 'tw-heatmap-image',
      }).addTo(this.map);
    }

    summary.top.forEach((result, index) => {
      const marker = L.circleMarker([result.latitudeDeg, result.longitudeDeg], {
        radius: 9,
        color: '#ffffff',
        weight: 2,
        fillColor: heatmapColor(result.scorePessimistic),
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      })
        .bindTooltip(
          t('map.resultTooltip', {
            rank: index + 1,
            percent: (result.scorePessimistic * 100).toFixed(0),
          }),
          { direction: 'top' },
        )
        .addTo(this.map);
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        this.viewpointMarker?.setLatLng([result.latitudeDeg, result.longitudeDeg]);
        this.map.setView([result.latitudeDeg, result.longitudeDeg], 17, {
          animate: false,
        });
        this.options.onResultPick?.(result.index);
      });
      this.resultMarkers.push(marker);
    });
    const sw = enuToLatLon(-radius, -radius, grid.originLatDeg, grid.originLonDeg);
    const ne = enuToLatLon(radius, radius, grid.originLatDeg, grid.originLonDeg);
    this.map.fitBounds(
      [
        [sw.latitudeDeg, sw.longitudeDeg],
        [ne.latitudeDeg, ne.longitudeDeg],
      ],
      { animate: false, padding: [18, 18] },
    );
  }

  /** Online OSM raster tiles are never kept for offline use. */
  setOfflineMode(offline: boolean): void {
    if (this.disposed || this.offlineMode === offline) return;
    this.offlineMode = offline;
    if (offline) {
      if (this.tileLayer) {
        this.tileLayer.remove();
        this.tileLayer = null;
      }
      this.map.attributionControl.addAttribution(OFFLINE_ATTRIBUTION);
    } else {
      this.clearOfflineBaseMap();
      if (!this.tileLayer) {
        this.tileLayer = L.tileLayer(OSM_URL, {
          maxZoom: 19,
          attribution: OSM_ATTRIBUTION,
        }).addTo(this.map);
      }
      this.map.attributionControl.removeAttribution(OFFLINE_ATTRIBUTION);
    }
  }

  /**
   * Show a locally rendered hillshade image. `dataUrl` comes from cached DEM
   * tiles plus OSM building footprints, not from map-tile downloads.
   */
  setOfflineBaseMap(
    dataUrl: string,
    bbox: { south: number; west: number; north: number; east: number },
  ): void {
    if (this.disposed) return;
    this.clearOfflineBaseMap();
    this.offlineOverlay = L.imageOverlay(dataUrl, [
      [bbox.south, bbox.west],
      [bbox.north, bbox.east],
    ], {
      opacity: 1,
      interactive: false,
      className: 'tw-offline-basemap',
    }).addTo(this.map);
  }

  clearOfflineBaseMap(): void {
    if (this.offlineOverlay) {
      this.offlineOverlay.remove();
      this.offlineOverlay = null;
    }
  }

  setNightMode(night: boolean): void {
    this.container.classList.toggle('tw-night', night);
  }

  invalidateSize(): void {
    if (this.disposed) return;
    this.map.invalidateSize();
  }

  dispose(): void {
    this.disposed = true;
    this.clearBestSpots();
    this.clearOfflineBaseMap();
    this.tileLayer?.off();
    this.tileLayer = null;
    this.map.remove();
  }
}
