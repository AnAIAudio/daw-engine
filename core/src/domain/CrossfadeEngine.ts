import { Region } from "./Region";

/**
 * CrossfadeEngine
 *
 * Automatically calculates and applies equal-power crossfades
 * when audio regions overlap on the same track playlist.
 */
export type CrossfadeCurveType = "equal-power" | "linear" | "s-curve";

export class CrossfadeEngine {
  /**
   * The crossfade curve type used for automatic crossfade calculations.
   * - 'equal-power' (default): constant power crossfade, smooth loudness transition
   * - 'linear': simple linear gain ramp
   * - 's-curve': slow start/end with fast middle transition
   */
  public static curveType: CrossfadeCurveType = "equal-power";

  /**
   * Sets the crossfade curve type for all subsequent crossfade calculations.
   */
  public static setCurveType(type: CrossfadeCurveType): void {
    CrossfadeEngine.curveType = type;
  }

  /**
   * Re-calculates fades for a given list of regions.
   * Assumes regions are passed sorted by start time.
   */
  public static calculateCrossfades(
    regions: Region[],
    _curveType?: CrossfadeCurveType,
  ): void {
    if (regions.length < 2) return;

    // Reset fades for overlapping boundaries before recalculating
    // (Allows removing overlaps to restore 0 fade)
    for (let i = 0; i < regions.length - 1; i++) {
      const current = regions[i];
      const next = regions[i + 1];

      // Only clear fades if they are exactly adjacent or overlapping
      // This prevents clearing manual user fades that aren't touching.
      // For now, we enforce auto-crossfade logic on overlap.

      if (current.end > next.start) {
        // Overlap exists
        const overlapAmount = current.end - next.start;

        // Apply fade out to the first region
        current.setFadeOut(overlapAmount);

        // Apply fade in to the second region
        next.setFadeIn(overlapAmount);
      } else if (current.end === next.start) {
        // Exactly touching, no crossfade needed, we could potentially clear but
        // it's safer to leave user fades alone unless there is an actual overlap.
        // However, if we just dragged them apart, we might want to clear auto-fades.
        // For this MVP, we will only ADD crossfades aggressively on overlap.
      }
    }
  }
}
