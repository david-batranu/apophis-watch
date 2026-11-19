import { jdTdbFromDate, SEC_PER_DAY } from '../core/time';
import { add, scale, vec3, type Vec3 } from '../core/vec3';
import type { ApophisDataFile, EphemerisProvider, GeocentricState } from './types';

const FIELD_COUNT = 7;

/**
 * Cubic Hermite interpolation of position using both position and velocity.
 * For a step h and endpoint states (p0,v0), (p1,v1):
 *
 *   p(s) = h00 p0 + h10 h v0 + h01 p1 + h11 h v1
 *
 * with s in [0,1]. Velocity is the exact derivative dp/dt.
 */
export function hermiteState(
  jd0: number,
  position0: Vec3,
  velocity0: Vec3,
  jd1: number,
  position1: Vec3,
  velocity1: Vec3,
  jd: number,
): GeocentricState {
  const hDays = jd1 - jd0;
  if (!(hDays > 0)) throw new Error(`invalid Hermite interval: ${jd0}..${jd1}`);
  const s = (jd - jd0) / hDays;
  const s2 = s * s;
  const s3 = s2 * s;

  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  const h = hDays * SEC_PER_DAY; // seconds
  const position = add(
    add(scale(position0, h00), scale(velocity0, h10 * h)),
    add(scale(position1, h01), scale(velocity1, h11 * h)),
  );

  const dh00 = 6 * s2 - 6 * s;
  const dh10 = 3 * s2 - 4 * s + 1;
  const dh01 = -6 * s2 + 6 * s;
  const dh11 = 3 * s2 - 2 * s;
  const velocity = add(
    add(scale(position0, dh00 / h), scale(velocity0, dh10)),
    add(scale(position1, dh01 / h), scale(velocity1, dh11)),
  );

  return { jdTdb: jd, positionKm: position, velocityKmS: velocity };
}

/** Immutable, validated ephemeris table loaded from the committed JSON file. */
export class TableEphemeris implements EphemerisProvider {
  readonly startJdTdb: number;
  readonly endJdTdb: number;
  readonly stepSeconds: number;
  readonly targetRadiusKm: number;
  readonly absoluteMagnitudeH: number;
  readonly slopeG: number;

  private readonly jd: Float64Array;
  private readonly xyz: Float64Array;
  private readonly vel: Float64Array;

  constructor(data: ApophisDataFile) {
    if (data.schemaVersion !== 1) {
      throw new Error(`unsupported ephemeris schema ${data.schemaVersion}`);
    }
    if (data.time.scale !== 'TDB' || data.time.interpolation !== 'cubic-hermite') {
      throw new Error('ephemeris must be TDB cubic-Hermite data');
    }
    if (!Array.isArray(data.vectors) || data.vectors.length < 2) {
      throw new Error('ephemeris has fewer than two state vectors');
    }
    const n = data.vectors.length;
    this.jd = new Float64Array(n);
    this.xyz = new Float64Array(n * 3);
    this.vel = new Float64Array(n * 3);

    let previous = -Infinity;
    for (let i = 0; i < n; i++) {
      const row = data.vectors[i];
      if (!row || row.length !== FIELD_COUNT || row.some((v) => !Number.isFinite(v))) {
        throw new Error(`malformed ephemeris row ${i}`);
      }
      const jd = row[0];
      if (jd <= previous) throw new Error(`ephemeris times not increasing at row ${i}`);
      previous = jd;
      this.jd[i] = jd;
      this.xyz[i * 3] = row[1];
      this.xyz[i * 3 + 1] = row[2];
      this.xyz[i * 3 + 2] = row[3];
      this.vel[i * 3] = row[4];
      this.vel[i * 3 + 1] = row[5];
      this.vel[i * 3 + 2] = row[6];
    }
    this.startJdTdb = this.jd[0];
    this.endJdTdb = this.jd[n - 1];
    this.stepSeconds = data.time.stepSeconds;
    this.targetRadiusKm = data.target.radiusKm;
    this.absoluteMagnitudeH = data.target.absoluteMagnitudeH;
    this.slopeG = data.target.slopeG;
  }

  static fromJson(text: string): TableEphemeris {
    return new TableEphemeris(JSON.parse(text) as ApophisDataFile);
  }

  private indexFor(jd: number): number {
    const n = this.jd.length;
    if (jd < this.startJdTdb || jd > this.endJdTdb) {
      throw new RangeError(
        `time ${jd} outside ephemeris ${this.startJdTdb}..${this.endJdTdb}`,
      );
    }
    if (jd === this.endJdTdb) return n - 2;
    let lo = 0;
    let hi = n - 1;
    // Invariant: jd[lo] <= jd < jd[hi]
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (this.jd[mid] <= jd) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  stateAtJdTdb(jd: number): GeocentricState {
    const i = this.indexFor(jd);
    const p0 = vec3(this.xyz[i * 3], this.xyz[i * 3 + 1], this.xyz[i * 3 + 2]);
    const v0 = vec3(this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2]);
    const p1 = vec3(
      this.xyz[(i + 1) * 3],
      this.xyz[(i + 1) * 3 + 1],
      this.xyz[(i + 1) * 3 + 2],
    );
    const v1 = vec3(
      this.vel[(i + 1) * 3],
      this.vel[(i + 1) * 3 + 1],
      this.vel[(i + 1) * 3 + 2],
    );
    return hermiteState(this.jd[i], p0, v0, this.jd[i + 1], p1, v1, jd);
  }

  stateAtUtc(date: Date): GeocentricState {
    return this.stateAtJdTdb(jdTdbFromDate(date));
  }
}
