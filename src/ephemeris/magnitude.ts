/**
 * IAU H-G phase-function magnitude model.
 *
 * Bowell et al. (1989), as used by JPL Horizons and the Minor Planet Center:
 *   m = H + 5 log10(r * delta) - 2.5 log10((1-G) Phi1 + G Phi2)
 *   Phi1 = exp(-3.33 tan(beta/2)^0.63)
 *   Phi2 = exp(-1.87 tan(beta/2)^1.22)
 *
 * H and G come from the Horizons object data (H=19.09, G=0.24 for Apophis,
 * JPL solution #220). This is an estimate: real brightness depends on the
 * unknown rotation phase, aspect, and opposition surge.
 */
export function hgMagnitude(
  absoluteMagnitudeH: number,
  slopeG: number,
  phaseAngleDeg: number,
  heliocentricDistanceAu: number,
  observerDistanceAu: number,
): number {
  if (
    !Number.isFinite(phaseAngleDeg) ||
    !Number.isFinite(heliocentricDistanceAu) ||
    !Number.isFinite(observerDistanceAu) ||
    phaseAngleDeg < 0 ||
    phaseAngleDeg > 180 ||
    heliocentricDistanceAu <= 0 ||
    observerDistanceAu <= 0
  ) {
    throw new RangeError('invalid H-G magnitude inputs');
  }
  const half = (phaseAngleDeg * Math.PI) / 360;
  const tanHalf = Math.tan(half);
  const phi1 = Math.exp(-3.33 * Math.pow(tanHalf, 0.63));
  const phi2 = Math.exp(-1.87 * Math.pow(tanHalf, 1.22));
  const phaseTerm = (1 - slopeG) * phi1 + slopeG * phi2;
  return (
    absoluteMagnitudeH +
    5 * Math.log10(heliocentricDistanceAu * observerDistanceAu) -
    2.5 * Math.log10(phaseTerm)
  );
}
