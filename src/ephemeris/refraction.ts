/**
 * Atmospheric refraction models for display only.
 *
 * Bennett (1982), as reproduced in Meeus, Astronomical Algorithms, 2nd ed.,
 * gives the refraction angle in arcminutes for apparent altitude h (degrees):
 *
 *   R = 1.02 / tan(h + 10.3/(h + 5.11))
 *
 * This is a standard-atmosphere approximation, not a local weather model.
 * It is never enabled in the Horizons validation path.
 */
export function bennettRefractionArcmin(apparentAltitudeDeg: number): number {
  if (apparentAltitudeDeg > 90 || apparentAltitudeDeg < -2) return 0;
  const h = Math.max(apparentAltitudeDeg, -1);
  const r = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * (Math.PI / 180));
  return Math.max(0, r);
}

/**
 * Convert a geometric (airless) elevation to a refracted apparent elevation.
 * Bennett's formula takes apparent altitude, so invert by fixed-point
 * iteration. Returns degrees.
 */
export function refractedElevationDeg(geometricElevationDeg: number): number {
  if (geometricElevationDeg < -2 || geometricElevationDeg > 90) {
    return geometricElevationDeg;
  }
  let apparent = geometricElevationDeg;
  for (let i = 0; i < 4; i++) {
    const r = bennettRefractionArcmin(apparent) / 60;
    apparent = geometricElevationDeg + r;
  }
  return apparent;
}
