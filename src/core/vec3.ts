export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  if (n === 0) throw new Error('cannot normalize zero vector');
  return scale(a, 1 / n);
};

export const angleBetweenRad = (a: Vec3, b: Vec3): number => {
  const denom = norm(a) * norm(b);
  if (denom === 0) throw new Error('angle between zero vectors');
  // atan2 form is accurate for both small and near-180-degree angles.
  return Math.atan2(norm(cross(a, b)), dot(a, b));
};

export const subset = (a: Vec3, b: Vec3): Vec3 => sub(a, b);

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
