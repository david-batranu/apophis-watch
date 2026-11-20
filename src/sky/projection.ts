import { clamp, DEG, RAD, vec3, type Vec3 } from '../core/vec3';

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
  /** Angular distance from the projection centre, degrees. */
  angularDistanceDeg: number;
}

export interface SkyViewState {
  centerAzDeg: number;
  centerElDeg: number;
  zoom: number;
}

/**
 * Stereographic projection of the local sky dome.
 *
 * The centre direction C and tangent basis (right, up) are built in the local
 * ENU frame: x=east, y=north, z=up. A sky direction P at angular distance θ
 * from C maps to radius `2 * scale * tan(θ/2)`, which is conformal and keeps
 * the horizon a circle when looking at the zenith. `scale` is pixels per
 * radian at the centre.
 */
export class SkyProjection {
  width: number;
  height: number;
  centerAzDeg: number;
  centerElDeg: number;
  zoom: number;
  /** Maximum angular distance drawn; beyond this the point is culled. */
  maxAngularDistanceDeg = 118;

  private center: Vec3 = vec3(0, 0, 1);
  private right: Vec3 = vec3(1, 0, 0);
  private up: Vec3 = vec3(0, 1, 0);
  private baseScale = 1;

  constructor(
    width: number,
    height: number,
    view: SkyViewState = { centerAzDeg: 0, centerElDeg: 90, zoom: 1 },
  ) {
    this.width = width;
    this.height = height;
    this.centerAzDeg = view.centerAzDeg;
    this.centerElDeg = view.centerElDeg;
    this.zoom = view.zoom;
    this.rebuild();
  }

  get scale(): number {
    return this.baseScale * this.zoom;
  }

  get horizonRadiusPx(): number {
    return 2 * this.scale;
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.rebuild();
  }

  setView(view: Partial<SkyViewState>): void {
    if (view.centerAzDeg !== undefined) this.centerAzDeg = view.centerAzDeg;
    if (view.centerElDeg !== undefined) this.centerElDeg = view.centerElDeg;
    if (view.zoom !== undefined) this.zoom = view.zoom;
    this.rebuild();
  }

  private rebuild(): void {
    const az = this.centerAzDeg * DEG;
    const el = this.centerElDeg * DEG;
    this.center = vec3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));

    // Tangent basis. `right` is east and `up` is toward increasing elevation.
    // Near the zenith the azimuth is degenerate, so fall back to east/north;
    // the projection remains continuous under small tilts.
    const zenith = vec3(0, 0, 1);
    if (1 - this.center.z < 1e-9) {
      // Looking straight up: east is right, north is up.
      this.right = vec3(1, 0, 0);
      this.up = vec3(0, 1, 0);
    } else {
      this.right = normalizeVec(crossVec(this.center, zenith));
      this.up = normalizeVec(crossVec(this.right, this.center));
    }

    const minSide = Math.max(1, Math.min(this.width, this.height));
    // Put the horizon (θ=90°, stereographic radius 2) near the short edge.
    this.baseScale = (0.46 * minSide) / 2;
  }

  project(azDeg: number, elDeg: number): ProjectedPoint {
    const az = azDeg * DEG;
    const el = elDeg * DEG;
    const p = vec3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
    return this.projectVector(p);
  }

  projectVector(p: Vec3): ProjectedPoint {
    const z = dotVec(p, this.center);
    const angularDistanceDeg = Math.acos(clamp(z, -1, 1)) * RAD;
    if (z <= -0.999999 || angularDistanceDeg > this.maxAngularDistanceDeg) {
      return { x: Number.NaN, y: Number.NaN, visible: false, angularDistanceDeg };
    }
    const x = dotVec(p, this.right);
    const y = dotVec(p, this.up);
    const k = (2 * this.scale) / (1 + z);
    const px = this.width / 2 + k * x;
    const py = this.height / 2 - k * y;
    return {
      x: px,
      y: py,
      visible:
        Number.isFinite(px) &&
        Number.isFinite(py) &&
        px >= -32 &&
        px <= this.width + 32 &&
        py >= -32 &&
        py <= this.height + 32,
      angularDistanceDeg,
    };
  }

  unproject(x: number, y: number): { azDeg: number; elDeg: number; angularDistanceDeg: number } {
    const dx = (x - this.width / 2) / this.scale;
    const dy = -(y - this.height / 2) / this.scale;
    const r = Math.hypot(dx, dy);
    if (r < 1e-12) {
      return {
        azDeg: (this.centerAzDeg + 360) % 360,
        elDeg: this.centerElDeg,
        angularDistanceDeg: 0,
      };
    }
    const theta = 2 * Math.atan(r / 2);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const dir = vec3(
      this.center.x * cosTheta + ((this.right.x * dx + this.up.x * dy) / r) * sinTheta,
      this.center.y * cosTheta + ((this.right.y * dx + this.up.y * dy) / r) * sinTheta,
      this.center.z * cosTheta + ((this.right.z * dx + this.up.z * dy) / r) * sinTheta,
    );
    const n = normalizeVec(dir);
    const elDeg = Math.asin(clamp(n.z, -1, 1)) * RAD;
    const azDeg = (Math.atan2(n.x, n.y) * RAD + 360) % 360;
    return { azDeg, elDeg, angularDistanceDeg: theta * RAD };
  }

  /** Drag the view in screen pixels (content follows the pointer). */
  panByPixels(dx: number, dy: number): void {
    const radiansPerPixel = 1 / Math.max(1, this.scale);
    const cosEl = Math.max(0.15, Math.cos(this.centerElDeg * DEG));
    this.centerAzDeg =
      (this.centerAzDeg - (dx * radiansPerPixel * RAD) / cosEl + 360) % 360;
    this.centerElDeg = clamp(
      this.centerElDeg - dy * radiansPerPixel * RAD,
      -15,
      90,
    );
    this.rebuild();
  }

  zoomBy(factor: number): void {
    this.zoom = clamp(this.zoom * factor, 0.5, 5);
    this.rebuild();
  }
}

function dotVec(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function crossVec(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
function normalizeVec(a: Vec3): Vec3 {
  const n = Math.hypot(a.x, a.y, a.z);
  return vec3(a.x / n, a.y / n, a.z / n);
}
