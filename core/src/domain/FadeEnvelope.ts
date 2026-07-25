import { FrameCount } from "./types";

/**
 * Fade curve shapes available for region fade-in and fade-out envelopes.
 */
export enum FadeShape {
  LINEAR,
  EQUAL_POWER,
  S_CURVE,
  FAST,
  SLOW,
  CUSTOM,
}

/**
 * Describes a fade envelope with a length (in frames) and a curve shape.
 */
export interface FadeEnvelope {
  length: FrameCount;
  shape: FadeShape;
}

/**
 * Compute the gain value for a given fade shape at normalised position t (0..1).
 *
 * For a fade-in the caller passes t increasing from 0 to 1.
 * For a fade-out the caller should pass (1 - t) or invert the result.
 *
 * @param t  Normalised position in the fade, clamped to [0, 1].
 * @param shape  The curve shape to apply.
 * @returns  Gain value in the range [0, 1].
 */
export function computeFadeGain(t: number, shape: FadeShape): number {
  // Clamp to [0, 1] for safety
  const s = Math.max(0, Math.min(1, t));

  switch (shape) {
    case FadeShape.LINEAR:
      return s;
    case FadeShape.EQUAL_POWER:
      return Math.sqrt(s);
    case FadeShape.S_CURVE:
      return s * s * (3 - 2 * s);
    case FadeShape.FAST:
      return s * s * s;
    case FadeShape.SLOW:
      return 1 - (1 - s) ** 3;
    case FadeShape.CUSTOM:
      // Custom falls back to linear until a user-defined envelope is supplied
      return s;
    default:
      return s;
  }
}
