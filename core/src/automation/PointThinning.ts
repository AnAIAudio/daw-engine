import { AutomationPoint } from "./types";

/**
 * Triangle area-based point thinning for automation data.
 *
 * After a write pass records many densely-packed automation points, this
 * algorithm removes points that contribute minimal visual/audible difference.
 * It computes the triangle area formed by each interior point with its
 * neighbours; points whose triangle area falls below the given factor are
 * removed. First and last points are always preserved.
 *
 * This is inspired by the Visvalingam-Whyatt line simplification algorithm.
 */

/**
 * Computes the area of the triangle formed by three automation points
 * using the shoelace formula.
 * @param a First point
 * @param b Middle point (candidate for removal)
 * @param c Third point
 * @returns The absolute area of the triangle
 */
function triangleArea(
  a: AutomationPoint,
  b: AutomationPoint,
  c: AutomationPoint,
): number {
  return Math.abs(
    (a.time * (b.value - c.value) +
      b.time * (c.value - a.value) +
      c.time * (a.value - b.value)) /
      2,
  );
}

/**
 * Thins an array of automation points by removing those with minimal
 * contribution (small triangle area with neighbours).
 *
 * @param points The automation points to thin (must be sorted by time)
 * @param factor The area threshold below which points are removed.
 *               Higher values thin more aggressively. A value of 0 removes
 *               no points (only exact collinear points).
 * @returns A new array with insignificant points removed.
 *          First and last points are always preserved.
 */
export function thinPoints(
  points: AutomationPoint[],
  factor: number,
): AutomationPoint[] {
  if (points.length <= 2) return [...points];

  const result: AutomationPoint[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    const area = triangleArea(prev, curr, next);
    if (area >= factor) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}
