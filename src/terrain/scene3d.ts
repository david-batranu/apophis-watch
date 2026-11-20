/**
 * Three.js eye-height local scene.
 *
 * The terrain mesh and building extrusions are in a metric ENU frame with
 * Earth curvature. The horizon profile and the Apophis trail are drawn on a
 * far dome, depth-tested against the terrain/buildings, so occlusion is
 * visible directly rather than faked with a 2D mask.
 */

import * as THREE from 'three';
import { curvatureDropM, normalizeAzimuth } from './geo';
import { horizonElevationAtAzimuth } from './horizon';
import { interpolatePathAt } from './path';
import { sceneGroundElevationM } from './terrainGrid';
import { buildBuildingMesh, buildTerrainMesh } from './terrainMesh';
import type {
  ApophisPathInfo,
  HorizonProfile,
  PreparedBuilding,
  TerrainGrid,
} from './types';

export interface SceneViewpoint {
  eastM: number;
  northM: number;
  groundElevationM: number;
}

export interface SceneState {
  grid: TerrainGrid | null;
  buildings: PreparedBuilding[];
  horizon: HorizonProfile | null;
  path: ApophisPathInfo | null;
  utcMs: number | null;
  eyeHeightM: number;
  viewpoint: SceneViewpoint | null;
  nightMode: boolean;
}

export interface SceneReadout {
  cameraAzimuthDeg: number;
  cameraElevationDeg: number;
  fovDeg: number;
  markerAzimuthDeg: number | null;
  markerElevationDeg: number | null;
  horizonAtMarkerDeg: number | null;
  markerOccluded: boolean;
  markerBelowHorizon: boolean;
}

const SKY_RADIUS_MIN_M = 12_000;
const HORIZON_RADIUS_MIN_M = 10_000;


function makeLabelTexture(text: string, colour: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 56px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, 130, 66);
    ctx.fillStyle = colour;
    ctx.fillText(text, 128, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class LocalScene3D {
  private readonly renderer: THREE.WebGLRenderer | null = null;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private buildingMesh: THREE.Mesh | null = null;
  private horizonLine: THREE.Line | null = null;
  private pathLine: THREE.Line | null = null;
  private markerOutline: THREE.Points | null = null;
  private marker: THREE.Points | null = null;
  private markerLabel: THREE.Sprite | null = null;
  private cardinalSprites: THREE.Sprite[] = [];
  private readonly labelTexture: THREE.CanvasTexture;

  private state: SceneState = {
    grid: null,
    buildings: [],
    horizon: null,
    path: null,
    utcMs: null,
    eyeHeightM: 1.7,
    viewpoint: null,
    nightMode: false,
  };
  private terrainKey = '';
  private buildingsKey = '';
  private buildingRevision = 0;
  private horizonKey = '';
  private pathKey = '';
  private markerKey = '';
  private cameraAzimuthDeg = 180;
  private cameraElevationDeg = 12;
  private fovDeg = 62;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private rafId: number | null = null;
  private dirty = true;
  private disposed = false;

  readonly available: boolean;
  onReadout: ((readout: SceneReadout) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 250_000);
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setClearColor(0x070b14, 1);
      this.renderer.domElement.className = 'tw-scene-canvas';
      container.appendChild(this.renderer.domElement);
      this.available = true;
    } catch (error) {
      console.warn('WebGL local scene unavailable:', error);
      this.renderer = null;
      this.available = false;
      const fallback = document.createElement('div');
      fallback.className = 'tw-scene-fallback';
      fallback.textContent =
        'WebGL is unavailable in this browser, so the local 3D view cannot be shown. The horizon chart and best-spot list still work.';
      container.appendChild(fallback);
    }

    const hemisphere = new THREE.HemisphereLight(0xa9c4ff, 0x1c241c, 0.85);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(-4000, 7000, 5000);
    this.scene.add(sun);

    this.labelTexture = makeLabelTexture('Apophis', '#9fe7b0');

    if (this.renderer) {
      this.bindPointer();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
      }
      this.resize();
      this.scheduleRender();
    }
  }

  private bindPointer(): void {
    const el = this.renderer?.domElement;
    if (!el) return;
    el.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastPointerX;
      const dy = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.cameraAzimuthDeg = normalizeAzimuth(this.cameraAzimuthDeg + dx * 0.18);
      this.cameraElevationDeg = Math.max(
        -80,
        Math.min(85, this.cameraElevationDeg - dy * 0.18),
      );
      this.applyCameraOrientation();
      this.dirty = true;
      this.scheduleRender();
      this.emitReadout();
    });
    const end = (event: PointerEvent): void => {
      this.dragging = false;
      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.fovDeg = Math.max(
          28,
          Math.min(88, this.fovDeg + Math.sign(event.deltaY) * 3),
        );
        this.camera.fov = this.fovDeg;
        this.camera.updateProjectionMatrix();
        this.dirty = true;
        this.scheduleRender();
        this.emitReadout();
      },
      { passive: false },
    );
  }

  setState(patch: Partial<SceneState>): void {
    const previous = this.state;
    const next = { ...previous, ...patch };
    this.state = next;
    if (this.renderer) {
      const gridChanged = patch.grid !== undefined && patch.grid !== previous.grid;
      const buildingsChanged =
        patch.buildings !== undefined && patch.buildings !== previous.buildings;
      const pathChanged = patch.path !== undefined && patch.path !== previous.path;
      const horizonChanged =
        patch.horizon !== undefined && patch.horizon !== previous.horizon;
      const viewpointChanged =
        patch.viewpoint !== undefined &&
        (patch.viewpoint === null ||
          previous.viewpoint === null ||
          patch.viewpoint.eastM !== previous.viewpoint.eastM ||
          patch.viewpoint.northM !== previous.viewpoint.northM ||
          patch.viewpoint.groundElevationM !== previous.viewpoint.groundElevationM);
      const eyeChanged =
        patch.eyeHeightM !== undefined && patch.eyeHeightM !== previous.eyeHeightM;
      const nightChanged =
        patch.nightMode !== undefined && patch.nightMode !== previous.nightMode;
      const timeChanged =
        patch.utcMs !== undefined && patch.utcMs !== previous.utcMs;
      if (buildingsChanged) this.buildingRevision++;
      if (gridChanged || buildingsChanged) this.rebuildTerrain();
      if (nightChanged || gridChanged || buildingsChanged) this.applyNightMode();
      const cameraChanged = gridChanged || eyeChanged || viewpointChanged;
      if (cameraChanged) this.updateCameraPosition();
      if (cameraChanged || horizonChanged || nightChanged) {
        this.rebuildHorizonLine();
        this.rebuildCardinals();
      }
      if (cameraChanged || horizonChanged || pathChanged || nightChanged) {
        this.rebuildPathLine();
        this.updateMarker();
      } else if (timeChanged) {
        this.updateMarker();
      }
    }
    this.emitReadout();
    this.dirty = true;
    this.scheduleRender();
  }

  setViewpoint(viewpoint: SceneViewpoint): void {
    this.cameraAzimuthDeg = this.state.path
      ? (interpolatePathAt(this.state.path.samples, this.state.utcMs ?? 0)
          ?.azimuthDeg ?? 180)
      : 180;
    const marker = this.state.path
      ? interpolatePathAt(this.state.path.samples, this.state.utcMs ?? 0)
      : null;
    this.cameraElevationDeg = marker
      ? Math.max(2, Math.min(70, marker.elevationDeg))
      : 12;
    this.applyCameraOrientation();
    this.setState({ viewpoint });
  }

  lookAtApophis(): void {
    const marker = this.state.path
      ? interpolatePathAt(this.state.path.samples, this.state.utcMs ?? 0)
      : null;
    if (!marker) return;
    this.cameraAzimuthDeg = marker.azimuthDeg;
    this.cameraElevationDeg = Math.max(-10, Math.min(85, marker.elevationDeg));
    this.applyCameraOrientation();
    this.dirty = true;
    this.scheduleRender();
    this.emitReadout();
  }

  lookAtAzimuth(azimuthDeg: number, elevationDeg = 8): void {
    this.cameraAzimuthDeg = normalizeAzimuth(azimuthDeg);
    this.cameraElevationDeg = elevationDeg;
    this.applyCameraOrientation();
    this.dirty = true;
    this.scheduleRender();
    this.emitReadout();
  }

  private applyCameraOrientation(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = -this.cameraAzimuthDeg * (Math.PI / 180);
    this.camera.rotation.x = this.cameraElevationDeg * (Math.PI / 180);
  }

  private rebuildTerrain(): void {
    const grid = this.state.grid;
    if (!grid) {
      this.disposeMesh(this.terrainMesh);
      this.terrainMesh = null;
      this.disposeMesh(this.buildingMesh);
      this.buildingMesh = null;
      return;
    }
    const key = `${grid.createdAt}|${grid.zoom}|${grid.width}x${grid.height}|${grid.originLatDeg},${grid.originLonDeg}`;
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      const data = buildTerrainMesh(grid, {
        maxDimension: 512,
        observerGroundElevationM: sceneGroundElevationM(grid),
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(data.positions, 3),
      );
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      this.disposeMesh(this.terrainMesh);
      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
      });
      this.terrainMesh = new THREE.Mesh(geometry, material);
      this.terrainMesh.frustumCulled = false;
      this.scene.add(this.terrainMesh);
    }

    const buildingKey = `${key}|${this.state.buildings.length}|${this.buildingRevision}|${
      grid.createdAt
    }`;
    if (buildingKey !== this.buildingsKey) {
      this.buildingsKey = buildingKey;
      this.disposeMesh(this.buildingMesh);
      this.buildingMesh = null;
      if (this.state.buildings.length > 0) {
        const data = buildBuildingMesh(this.state.buildings, grid, {
          observerGroundElevationM: sceneGroundElevationM(grid),
        });
        if (data.vertexCount > 0) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(data.positions, 3),
          );
          geometry.setAttribute(
            'color',
            new THREE.BufferAttribute(data.colors, 3),
          );
          geometry.computeVertexNormals();
          geometry.computeBoundingSphere();
          const material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
          });
          this.buildingMesh = new THREE.Mesh(geometry, material);
          this.buildingMesh.frustumCulled = false;
          this.scene.add(this.buildingMesh);
        }
      }
    }
  }

  private disposeMesh(mesh: THREE.Mesh | THREE.Line | THREE.Points | null): void {
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else {
      material.dispose();
    }
  }

  private viewpointEnu(): { eastM: number; northM: number; groundElevationM: number } {
    if (this.state.viewpoint) return this.state.viewpoint;
    const grid = this.state.grid;
    return {
      eastM: 0,
      northM: 0,
      groundElevationM: grid ? sceneGroundElevationM(grid) : 0,
    };
  }

  private updateCameraPosition(): void {
    const grid = this.state.grid;
    const viewpoint = this.viewpointEnu();
    const reference = grid ? sceneGroundElevationM(grid) : 0;
    const ground = Number.isFinite(viewpoint.groundElevationM)
      ? viewpoint.groundElevationM
      : reference;
    const drop = curvatureDropM(
      Math.hypot(viewpoint.eastM, viewpoint.northM),
    );
    this.camera.position.set(
      viewpoint.eastM,
      ground - reference - drop + this.state.eyeHeightM,
      -viewpoint.northM,
    );
    this.camera.fov = this.fovDeg;
    this.camera.updateProjectionMatrix();
    this.applyCameraOrientation();
  }

  private skyRadius(): number {
    const grid = this.state.grid;
    if (!grid) return SKY_RADIUS_MIN_M;
    const radius = Math.hypot(
      grid.width * grid.spacingEastM,
      grid.height * grid.spacingNorthM,
    );
    return Math.max(SKY_RADIUS_MIN_M, radius * 0.9);
  }

  private rebuildHorizonLine(): void {
    const profile = this.state.horizon;
    const grid = this.state.grid;
    if (!profile || !grid) {
      if (this.horizonLine) {
        this.disposeMesh(this.horizonLine);
        this.horizonLine = null;
      }
      return;
    }
    const key = `${profile.generatedAt}|${profile.pointLatDeg},${profile.pointLonDeg}|${profile.eyeHeightM}|${this.state.nightMode}|${this.camera.position.x.toFixed(2)},${this.camera.position.y.toFixed(2)},${this.camera.position.z.toFixed(2)}`;
    if (key === this.horizonKey && this.horizonLine) return;
    this.horizonKey = key;
    const radius = Math.max(
      HORIZON_RADIUS_MIN_M,
      this.skyRadius() * 0.8,
    );
    const positions: number[] = [];
    const centre = this.camera.position;
    for (const sample of profile.samples) {
      const az = sample.azimuthDeg * (Math.PI / 180);
      const el = sample.elevationDeg * (Math.PI / 180);
      const horizontal = radius * Math.cos(el);
      positions.push(
        centre.x + Math.sin(az) * horizontal,
        centre.y + radius * Math.sin(el),
        centre.z - Math.cos(az) * horizontal,
      );
    }
    // Close the ring.
    if (profile.samples.length > 0) {
      positions.push(positions[0], positions[1], positions[2]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.disposeMesh(this.horizonLine);
    this.horizonLine = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: this.state.nightMode ? 0xff4a3a : 0x9fd0ff,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
      }),
    );
    this.horizonLine.frustumCulled = false;
    this.scene.add(this.horizonLine);
  }

  private rebuildPathLine(): void {
    this.disposeMesh(this.pathLine);
    this.pathLine = null;
    const path = this.state.path;
    const grid = this.state.grid;
    if (!path || !grid) return;
    const radius = this.skyRadius();
    const centre = this.camera.position;
    const positions: number[] = [];
    const colours: number[] = [];
    const horizon = this.state.horizon;
    const visible = this.state.nightMode ? [1, 0.35, 0.28] : [0.4, 1, 0.6];
    const blocked = [1, 0.25, 0.2];
    for (const sample of path.samples) {
      const az = sample.azimuthDeg * (Math.PI / 180);
      const el = sample.elevationDeg * (Math.PI / 180);
      const horizontal = radius * Math.cos(el);
      positions.push(
        centre.x + Math.sin(az) * horizontal,
        centre.y + radius * Math.sin(el),
        centre.z - Math.cos(az) * horizontal,
      );
      const horizonDeg = horizon
        ? horizonElevationAtAzimuth(horizon, sample.azimuthDeg)
        : null;
      const clear =
        horizonDeg === null || sample.elevationDeg >= horizonDeg;
      const colour = clear ? visible : blocked;
      colours.push(colour[0], colour[1], colour[2]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colours, 3),
    );
    this.pathLine = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
      }),
    );
    this.pathLine.frustumCulled = false;
    this.scene.add(this.pathLine);
  }

  private updateMarker(): void {
    const path = this.state.path;
    if (!path || !this.state.grid || this.state.utcMs === null) {
      this.disposeMesh(this.marker);
      this.marker = null;
      this.disposeMesh(this.markerOutline);
      this.markerOutline = null;
      if (this.markerLabel) {
        this.scene.remove(this.markerLabel);
        this.markerLabel.material.dispose();
        this.markerLabel = null;
      }
      return;
    }
    const marker = interpolatePathAt(path.samples, this.state.utcMs);
    if (!marker) return;
    const radius = this.skyRadius();
    const centre = this.camera.position;
    const markerAz = marker.azimuthDeg * (Math.PI / 180);
    const markerEl = marker.elevationDeg * (Math.PI / 180);
    const markerHorizontal = radius * Math.cos(markerEl);
    const x = centre.x + Math.sin(markerAz) * markerHorizontal;
    const y = centre.y + radius * Math.sin(markerEl);
    const z = centre.z - Math.cos(markerAz) * markerHorizontal;
    const horizon = this.state.horizon;
    const horizonDeg = horizon
      ? horizonElevationAtAzimuth(horizon, marker.azimuthDeg)
      : null;
    const occluded =
      marker.elevationDeg <= 0 ||
      (horizonDeg !== null && marker.elevationDeg < horizonDeg);
    const markerColour = occluded
      ? 0xff4a3a
      : this.state.nightMode
        ? 0xffb0a0
        : 0xa8ffbe;

    if (this.marker && this.markerOutline) {
      const position = this.marker.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      position.setXYZ(0, x, y, z);
      position.needsUpdate = true;
      const outlinePosition = this.markerOutline.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      outlinePosition.setXYZ(0, x, y, z);
      outlinePosition.needsUpdate = true;
      const markerMaterial = this.marker.material as THREE.PointsMaterial;
      markerMaterial.color.setHex(markerColour);
      markerMaterial.opacity = occluded ? 0.55 : 1;
      if (this.markerLabel) {
        this.markerLabel.position.set(x, y, z);
        (this.markerLabel.material as THREE.SpriteMaterial).color.setHex(
          occluded ? 0xff9a8a : 0xffffff,
        );
      }
      return;
    }

    this.disposeMesh(this.marker);
    this.marker = null;
    this.disposeMesh(this.markerOutline);
    this.markerOutline = null;
    if (this.markerLabel) {
      this.scene.remove(this.markerLabel);
      this.markerLabel.material.dispose();
      this.markerLabel = null;
    }

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([x, y, z], 3),
    );
    this.markerOutline = new THREE.Points(
      outlineGeometry,
      new THREE.PointsMaterial({
        color: 0x000000,
        size: 17,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.8,
        depthTest: true,
      }),
    );
    this.markerOutline.frustumCulled = false;
    this.scene.add(this.markerOutline);

    const markerGeometry = new THREE.BufferGeometry();
    markerGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([x, y, z], 3),
    );
    this.marker = new THREE.Points(
      markerGeometry,
      new THREE.PointsMaterial({
        color: markerColour,
        size: 10,
        sizeAttenuation: false,
        transparent: true,
        opacity: occluded ? 0.55 : 1,
        depthTest: true,
      }),
    );
    this.marker.frustumCulled = false;
    this.scene.add(this.marker);

    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.labelTexture,
        transparent: true,
        depthTest: true,
        color: occluded ? 0xff9a8a : 0xffffff,
      }),
    );
    label.position.set(x, y, z);
    const scale = Math.max(90, radius * 0.012);
    label.scale.set(scale * 2, scale, 1);
    this.markerLabel = label;
    this.scene.add(label);
  }

  private rebuildCardinals(): void {
    for (const sprite of this.cardinalSprites) {
      this.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.cardinalSprites = [];
    if (!this.renderer) return;
    const labels: Array<[string, number]> = [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ];
    const centre = this.camera.position;
    for (const [text, azDeg] of labels) {
      const texture = makeLabelTexture(
        text,
        this.state.nightMode ? '#ff8a7a' : '#cfe3ff',
      );
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: true,
        }),
      );
      const az = azDeg * (Math.PI / 180);
      const radius = 5000;
      sprite.position.set(
        centre.x + Math.sin(az) * radius,
        centre.y,
        centre.z - Math.cos(az) * radius,
      );
      const scale = 260;
      sprite.scale.set(scale * 1.3, scale * 0.65, 1);
      this.cardinalSprites.push(sprite);
      this.scene.add(sprite);
    }
  }

  private applyNightMode(): void {
    if (!this.renderer) return;
    this.renderer.setClearColor(
      this.state.nightMode ? 0x000000 : 0x070b14,
      1,
    );
    if (this.terrainMesh) {
      const material = this.terrainMesh.material as THREE.MeshLambertMaterial;
      material.color.setHex(this.state.nightMode ? 0x9a2b20 : 0x9aa89a);
    }
    if (this.buildingMesh) {
      const material = this.buildingMesh.material as THREE.MeshLambertMaterial;
      material.color.setHex(this.state.nightMode ? 0xa83a2a : 0xc8c8c8);
    }
  }

  private emitReadout(): void {
    if (!this.onReadout) return;
    const path = this.state.path;
    const marker = path
      ? interpolatePathAt(path.samples, this.state.utcMs ?? 0)
      : null;
    const horizon = this.state.horizon;
    const horizonAtMarkerDeg =
      marker && horizon ? horizonElevationAtAzimuth(horizon, marker.azimuthDeg) : null;
    const markerOccluded =
      marker !== null &&
      horizonAtMarkerDeg !== null &&
      (marker.elevationDeg < horizonAtMarkerDeg ||
        marker.elevationDeg < 0);
    this.onReadout({
      cameraAzimuthDeg: this.cameraAzimuthDeg,
      cameraElevationDeg: this.cameraElevationDeg,
      fovDeg: this.fovDeg,
      markerAzimuthDeg: marker?.azimuthDeg ?? null,
      markerElevationDeg: marker?.elevationDeg ?? null,
      horizonAtMarkerDeg,
      markerOccluded,
      markerBelowHorizon: marker !== null && marker.elevationDeg < 0,
    });
  }

  private resize(): void {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (!this.renderer || this.disposed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.dirty || !this.renderer) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.disposeMesh(this.terrainMesh);
    this.disposeMesh(this.buildingMesh);
    this.disposeMesh(this.horizonLine);
    this.disposeMesh(this.pathLine);
    this.disposeMesh(this.marker);
    this.disposeMesh(this.markerOutline);
    this.terrainMesh = null;
    this.buildingMesh = null;
    this.horizonLine = null;
    this.pathLine = null;
    this.marker = null;
    this.markerOutline = null;
    if (this.markerLabel) {
      this.scene.remove(this.markerLabel);
      this.markerLabel.material.dispose();
      this.markerLabel = null;
    }
    this.labelTexture.dispose();
    for (const sprite of this.cardinalSprites) {
      this.scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.cardinalSprites = [];
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
