import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdTdbFromDate } from '../core/time';
import type { SkyPosition } from '../ephemeris/types';
import type { SimulationSession } from '../state/session';
import type { UiState } from '../state/store';

const KM_PER_UNIT = 1000;
const EARTH_RADIUS_KM = 6378.137;
const MOON_RADIUS_KM = 1737.4;
const GEO_RADIUS_KM = 42_164;
const AU_KM = 149_597_870.7;

interface Palette {
  bg: number;
  earth: number;
  earthWire: number;
  moon: number;
  orbit: number;
  geo: number;
  trail: number;
  ruler: number;
  marker: number;
  warning: number;
  label: string;
}

function palette(night: boolean): Palette {
  return night
    ? {
        bg: 0x000000,
        earth: 0x5a0a08,
        earthWire: 0xff3b30,
        moon: 0x7a1510,
        orbit: 0x8a1a12,
        geo: 0x7a1510,
        trail: 0xff2a1a,
        ruler: 0xb02a20,
        marker: 0xff0000,
        warning: 0xff5a00,
        label: '#ff8a7a',
      }
    : {
        bg: 0x05070d,
        earth: 0x16324f,
        earthWire: 0x4f8fc4,
        moon: 0x8a8f99,
        orbit: 0x3d5f80,
        geo: 0x2b4a63,
        trail: 0xff5a5f,
        ruler: 0x4f6782,
        marker: 0xff5a5f,
        warning: 0xffb347,
        label: '#c9d6e8',
      };
}

function toThree(v: { x: number; y: number; z: number }): THREE.Vector3 {
  // ICRF z is the Earth's north pole; Three.js is Y-up.
  return new THREE.Vector3(v.x, v.z, -v.y);
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 512;
  canvas.height = 96;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
  // Draw white and tint through SpriteMaterial.color so night mode can
  // recolour labels without recreating textures.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    color: new THREE.Color(color),
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(28, 5.25, 1);
  return sprite;
}

function circleLine(radius: number, color: number, segments = 128): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(
      new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
    );
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.65 }),
  );
}

export class SpaceView {
  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly earthGroup = new THREE.Group();
  private readonly moonGroup = new THREE.Group();
  private readonly moonOrbit = new THREE.Group();
  private readonly geoRing = new THREE.Group();
  private readonly trailGroup = new THREE.Group();
  private readonly rulerGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly earthMesh: THREE.Mesh;
  private readonly earthWire: THREE.LineSegments;
  private readonly moonMesh: THREE.Mesh;
  private readonly moonLabel = labelSprite('Moon', '#c9d6e8');
  private readonly earthLabel = labelSprite('Earth', '#c9d6e8');
  private readonly geoLabel = labelSprite('GEO ring 42,164 km', '#c9d6e8');
  private readonly moonOrbitLabel = labelSprite('Moon orbit 384,400 km', '#c9d6e8');
  private readonly markerLabel = labelSprite('Apophis — true-scale point', '#ff8a7a');
  private readonly enlargedLabel = labelSprite('ENLARGED — NOT TO SCALE', '#ffb347');
  private readonly markerPoint: THREE.Points;
  private readonly enlargedRing: THREE.Sprite;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private lastKey = '';
  private lastState: Readonly<UiState> | null = null;
  private lastSession: SimulationSession | null = null;
  private lastSky: SkyPosition | null = null;
  private dark = false;
  private paletteRef = palette(false);

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 5000);
    this.camera.position.set(0, 55, 160);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 1800;
    this.controls.target.set(0, 0, 0);

    this.earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS_KM / KM_PER_UNIT, 48, 24),
      new THREE.MeshStandardMaterial({
        color: this.paletteRef.earth,
        roughness: 0.9,
        metalness: 0.05,
      }),
    );
    this.earthGroup.add(this.earthMesh);
    this.earthWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(
        new THREE.SphereGeometry(EARTH_RADIUS_KM / KM_PER_UNIT * 1.001, 18, 9),
      ),
      new THREE.LineBasicMaterial({
        color: this.paletteRef.earthWire,
        transparent: true,
        opacity: 0.25,
      }),
    );
    this.earthGroup.add(this.earthWire);
    this.scene.add(this.earthGroup);
    this.earthLabel.position.set(0, EARTH_RADIUS_KM / KM_PER_UNIT + 4, 0);
    this.scene.add(this.earthLabel);

    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS_KM / KM_PER_UNIT, 24, 12),
      new THREE.MeshStandardMaterial({
        color: this.paletteRef.moon,
        roughness: 1,
      }),
    );
    this.moonGroup.add(this.moonMesh);
    this.scene.add(this.moonGroup);
    this.scene.add(this.moonLabel);
    this.scene.add(this.moonOrbit);
    this.moonOrbitLabel.position.set(270, 4, 270);
    this.scene.add(this.moonOrbitLabel);
    this.scene.add(this.geoRing);
    this.scene.add(this.trailGroup);
    this.scene.add(this.rulerGroup);
    this.scene.add(this.markerGroup);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sunLight.position.set(100, 50, 50);
    this.scene.add(this.sunLight);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);

    this.markerPoint = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0)]),
      new THREE.PointsMaterial({
        color: this.paletteRef.marker,
        size: 5,
        sizeAttenuation: false,
        depthWrite: false,
      }),
    );
    this.markerGroup.add(this.markerPoint);
    this.markerLabel.position.set(0, 4, 0);
    this.markerGroup.add(this.markerLabel);

    this.enlargedRing = labelSprite('◯', '#ffb347');
    this.enlargedRing.scale.set(6, 6, 1);
    this.enlargedRing.visible = false;
    this.markerGroup.add(this.enlargedRing);
    this.enlargedLabel.position.set(0, 9, 0);
    this.enlargedLabel.visible = false;
    this.markerGroup.add(this.enlargedLabel);

    this.buildGeoRing();
    this.buildRuler();
    this.setCameraPreset('flyby');
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private buildGeoRing(): void {
    const ring = circleLine(GEO_RADIUS_KM / KM_PER_UNIT, this.paletteRef.geo, 160);
    this.geoRing.add(ring);
    const diagonal = GEO_RADIUS_KM / KM_PER_UNIT / Math.SQRT2;
    this.geoLabel.position.set(diagonal, 3, diagonal);
    this.scene.add(this.geoLabel);
  }

  private buildRuler(): void {
    // 1 unit = 1,000 km. Keep the ruler inside the mobile flyby framing.
    const start = 8;
    const end = 36;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start, 0, 0),
      new THREE.Vector3(end, 0, 0),
    ]);
    this.rulerGroup.add(
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: this.paletteRef.ruler }),
      ),
    );
    for (let km = 10; km <= 30; km += 10) {
      const x = km;
      const tick = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, 0),
        new THREE.Vector3(x, 3, 0),
      ]);
      this.rulerGroup.add(
        new THREE.Line(
          tick,
          new THREE.LineBasicMaterial({ color: this.paletteRef.ruler }),
        ),
      );
      const label = labelSprite(`${km},000 km`, this.paletteRef.label);
      label.position.set(x, 5, 0);
      label.scale.set(14, 2.6, 1);
      this.rulerGroup.add(label);
    }
  }

  private rebuildTrail(session: SimulationSession): void {
    this.trailGroup.clear();
    const caJd = session.geocentricCa.jdTdb;
    const points: THREE.Vector3[] = [];
    for (let minutes = -360; minutes <= 360; minutes += 2) {
      try {
        const jd = caJd + minutes / 1440;
        const state = session.ephem.stateAtJdTdb(jd);
        points.push(toThree(state.positionKm).multiplyScalar(1 / KM_PER_UNIT));
      } catch {
        // Skip points outside the committed table.
      }
    }
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.trailGroup.add(
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: this.paletteRef.trail,
          transparent: true,
          opacity: 0.85,
        }),
      ),
    );
  }

  private rebuildMoonOrbit(session: SimulationSession, utcMs: number): void {
    this.moonOrbit.clear();
    const time = new Astronomy.AstroTime(new Date(utcMs));
    const points: THREE.Vector3[] = [];
    for (let hours = -13.65 * 24; hours <= 13.65 * 24; hours += 6) {
      const moon = Astronomy.GeoVector(
        Astronomy.Body.Moon,
        time.AddDays(hours / 24),
        true,
      );
      points.push(
        toThree({
          x: moon.x * AU_KM,
          y: moon.y * AU_KM,
          z: moon.z * AU_KM,
        }).multiplyScalar(1 / KM_PER_UNIT),
      );
    }
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.moonOrbit.add(
      new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: this.paletteRef.orbit,
          transparent: true,
          opacity: 0.55,
        }),
      ),
    );
  }

  setInput(state: Readonly<UiState>, session: SimulationSession, sky: SkyPosition): void {
    const sessionChanged = session !== this.lastSession;
    this.lastState = state;
    this.lastSession = session;
    this.lastSky = sky;
    if (sessionChanged || this.lastKey === '') {
      this.rebuildTrail(session);
      this.rebuildMoonOrbit(session, state.utcMs ?? session.topocentricCa.utc.getTime());
    }
    const night = state.toggles.nightMode;
    if (night !== this.dark) {
      this.dark = night;
      this.applyPalette();
    }
    if (state.utcMs === null) return;
    const time = new Astronomy.AstroTime(new Date(state.utcMs));
    const moon = Astronomy.GeoVector(Astronomy.Body.Moon, time, true);
    const moonPos = toThree({
      x: moon.x * AU_KM,
      y: moon.y * AU_KM,
      z: moon.z * AU_KM,
    }).multiplyScalar(1 / KM_PER_UNIT);
    this.moonGroup.position.copy(moonPos);
    this.moonLabel.position.copy(moonPos).add(new THREE.Vector3(0, 4, 0));

    const sidereal = (Astronomy.SiderealTime(time) * 15 * Math.PI) / 180;
    this.earthGroup.rotation.y = sidereal;

    const apophisState = session.ephem.stateAtJdTdb(jdTdbFromDate(new Date(state.utcMs)));
    const apophis = toThree(apophisState.positionKm).multiplyScalar(1 / KM_PER_UNIT);
    this.markerGroup.position.copy(apophis);
    this.markerLabel.visible = true;
    this.markerLabel.position.set(0, 4, 0);
    this.markerLabel.scale.set(18, 3.4, 1);
    const markerNdc = apophis.clone().project(this.camera);
    this.markerLabel.center.set(markerNdc.x < 0 ? 0 : 1, 0.5);
    const showEnlarged = state.toggles.enlargedMarker;
    this.enlargedRing.visible = showEnlarged;
    this.enlargedLabel.visible = showEnlarged;
    this.enlargedRing.position.set(0, 0, 0);
    this.enlargedRing.scale.set(8, 8, 1);
    this.enlargedLabel.position.set(0, 9, 0);
    const pointMaterial = this.markerPoint.material as THREE.PointsMaterial;
    pointMaterial.size = showEnlarged ? 2 : 5;
    pointMaterial.color.setHex(
      showEnlarged ? this.paletteRef.warning : this.paletteRef.marker,
    );

    const sun = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
    const sunPos = toThree({
      x: sun.x * AU_KM,
      y: sun.y * AU_KM,
      z: sun.z * AU_KM,
    }).normalize().multiplyScalar(1000);
    this.sunLight.position.copy(sunPos);
    this.lastKey = [
      state.utcMs,
      night,
      showEnlarged,
      state.observer?.latitudeDeg,
      state.observer?.longitudeDeg,
    ].join('|');
    this.render();
  }

  private applyPalette(): void {
    this.paletteRef = palette(this.dark);
    this.renderer.setClearColor(this.paletteRef.bg, 1);
    const earthMaterial = this.earthMesh.material as THREE.MeshStandardMaterial;
    earthMaterial.color.setHex(this.paletteRef.earth);
    earthMaterial.emissive.setHex(this.dark ? 0x5a0a08 : 0x000000);
    earthMaterial.emissiveIntensity = this.dark ? 0.55 : 0;
    (this.earthWire.material as THREE.LineBasicMaterial).color.setHex(
      this.paletteRef.earthWire,
    );
    const moonMaterial = this.moonMesh.material as THREE.MeshStandardMaterial;
    moonMaterial.color.setHex(this.paletteRef.moon);
    moonMaterial.emissive.setHex(this.dark ? 0x3a0805 : 0x000000);
    moonMaterial.emissiveIntensity = this.dark ? 0.45 : 0;
    (this.markerPoint.material as THREE.PointsMaterial).color.setHex(
      this.paletteRef.marker,
    );
    this.trailGroup.traverse((o) => {
      if (o instanceof THREE.Line) {
        (o.material as THREE.LineBasicMaterial).color.setHex(this.paletteRef.trail);
      }
    });
    this.moonOrbit.traverse((o) => {
      if (o instanceof THREE.Line) {
        (o.material as THREE.LineBasicMaterial).color.setHex(this.paletteRef.orbit);
      }
    });
    this.geoRing.traverse((o) => {
      if (o instanceof THREE.Line) {
        (o.material as THREE.LineBasicMaterial).color.setHex(this.paletteRef.geo);
      }
    });
    this.rulerGroup.traverse((o) => {
      if (o instanceof THREE.Line) {
        (o.material as THREE.LineBasicMaterial).color.setHex(this.paletteRef.ruler);
      } else if (o instanceof THREE.Sprite) {
        (o.material as THREE.SpriteMaterial).color.set(this.paletteRef.label);
      }
    });
    const labelColor = new THREE.Color(this.paletteRef.label);
    for (const label of [
      this.earthLabel,
      this.moonLabel,
      this.moonOrbitLabel,
      this.geoLabel,
      this.markerLabel,
      this.enlargedLabel,
    ]) {
      (label.material as THREE.SpriteMaterial).color.copy(labelColor);
    }
    this.sunLight.color.setHex(this.dark ? 0xff6a5a : 0xffffff);
    this.ambient.color.setHex(this.dark ? 0xff3a2a : 0xffffff);
    this.render();
  }

  setCameraPreset(name: 'earth' | 'flyby' | 'moon' | 'top'): void {
    switch (name) {
      case 'earth':
        this.camera.position.set(0, 25, 65);
        this.controls.target.set(0, 0, 0);
        break;
      case 'flyby':
        this.camera.position.set(0, 55, 160);
        this.controls.target.set(0, 0, 0);
        break;
      case 'moon':
        // Both Earth and the 384,400 km lunar orbit should fit on a phone.
        this.camera.position.set(0, 850, 850);
        this.controls.target.set(0, 0, 0);
        break;
      case 'top':
        this.camera.position.set(0, 600, 0.01);
        this.controls.target.set(0, 0, 0);
        break;
    }
    this.controls.update();
    this.render();
  }

  private resize(): void {
    const width = Math.max(320, this.host.clientWidth);
    const height = Math.max(320, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}


