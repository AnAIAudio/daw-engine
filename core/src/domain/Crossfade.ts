import { FrameCount, RegionId } from "./types";
import { Region } from "./Region";
import { Signal } from "../lib/Signal";

// ─── Crossfade Types ─────────────────────────────────────────────────────────

export type CrossfadeId = string;

export enum CrossfadeType {
  FULL = "full", // Equal-power crossfade
  SHORT = "short", // Quick transition
  CUSTOM = "custom", // User-defined curves
}

export enum FadeCurve {
  LINEAR = "linear",
  EQUAL_POWER = "equal_power",
  S_CURVE = "s_curve",
  EXPONENTIAL = "exponential",
  LOGARITHMIC = "logarithmic",
  CONSTANT_POWER = "constant_power",
}

// ─── Gain Calculation Helpers ────────────────────────────────────────────────

/**
 * Compute the fade-in gain for a normalised position t (0..1) given a curve.
 * t = 0 means silence, t = 1 means full gain.
 */
function computeFadeInGain(t: number, curve: FadeCurve): number {
  const s = Math.max(0, Math.min(1, t));

  switch (curve) {
    case FadeCurve.LINEAR:
      return s;
    case FadeCurve.EQUAL_POWER:
      return Math.sqrt(s);
    case FadeCurve.S_CURVE:
      return s * s * (3 - 2 * s);
    case FadeCurve.EXPONENTIAL:
      // Exponential rise: slow start, fast finish
      return s === 0 ? 0 : Math.pow(2, 10 * (s - 1));
    case FadeCurve.LOGARITHMIC:
      // Logarithmic rise: fast start, slow finish
      return Math.log1p(s * (Math.E - 1)) / Math.log(Math.E);
    case FadeCurve.CONSTANT_POWER:
      // sine-based constant power (complementary with fade-out)
      return Math.sin(s * Math.PI * 0.5);
    default:
      return s;
  }
}

/**
 * Compute the fade-out gain for a normalised position t (0..1) given a curve.
 * t = 0 means full gain (beginning of crossfade), t = 1 means silence.
 */
function computeFadeOutGain(t: number, curve: FadeCurve): number {
  const s = Math.max(0, Math.min(1, t));

  switch (curve) {
    case FadeCurve.LINEAR:
      return 1 - s;
    case FadeCurve.EQUAL_POWER:
      return Math.sqrt(1 - s);
    case FadeCurve.S_CURVE: {
      const inv = 1 - s;
      return inv * inv * (3 - 2 * inv);
    }
    case FadeCurve.EXPONENTIAL:
      // Exponential decay: fast start, slow tail
      return s >= 1 ? 0 : Math.pow(2, -10 * s);
    case FadeCurve.LOGARITHMIC:
      // Logarithmic decay: slow start, fast tail
      return 1 - Math.log1p(s * (Math.E - 1)) / Math.log(Math.E);
    case FadeCurve.CONSTANT_POWER:
      // cosine-based constant power (complementary with fade-in)
      return Math.cos(s * Math.PI * 0.5);
    default:
      return 1 - s;
  }
}

// ─── Crossfade Class ─────────────────────────────────────────────────────────

export class Crossfade {
  public readonly id: CrossfadeId;

  private _inRegionId: RegionId; // region being faded IN (gaining volume)
  private _outRegionId: RegionId; // region being faded OUT (losing volume)
  private _length: FrameCount; // crossfade length in frames
  private _position: FrameCount; // start frame of crossfade on timeline
  private _fadeInCurve: FadeCurve;
  private _fadeOutCurve: FadeCurve;
  private _type: CrossfadeType;
  private _active: boolean;

  // Signals
  public readonly changed = new Signal<void>();

  constructor(
    id: CrossfadeId,
    inRegionId: RegionId,
    outRegionId: RegionId,
    position: FrameCount,
    length: FrameCount,
    type: CrossfadeType = CrossfadeType.FULL,
    fadeInCurve: FadeCurve = FadeCurve.EQUAL_POWER,
    fadeOutCurve: FadeCurve = FadeCurve.EQUAL_POWER,
  ) {
    this.id = id;
    this._inRegionId = inRegionId;
    this._outRegionId = outRegionId;
    this._position = position;
    this._length = length;
    this._type = type;
    this._fadeInCurve = fadeInCurve;
    this._fadeOutCurve = fadeOutCurve;
    this._active = true;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  get inRegionId(): RegionId {
    return this._inRegionId;
  }

  get outRegionId(): RegionId {
    return this._outRegionId;
  }

  get length(): FrameCount {
    return this._length;
  }

  get position(): FrameCount {
    return this._position;
  }

  get end(): FrameCount {
    return this._position + this._length;
  }

  get fadeInCurve(): FadeCurve {
    return this._fadeInCurve;
  }

  get fadeOutCurve(): FadeCurve {
    return this._fadeOutCurve;
  }

  get type(): CrossfadeType {
    return this._type;
  }

  get active(): boolean {
    return this._active;
  }

  // ─── Setters / Mutators ──────────────────────────────────────────────────

  public setLength(length: FrameCount): void {
    if (length < 0) length = 0;
    this._length = length;
    this.changed.emit();
  }

  public setPosition(position: FrameCount): void {
    if (position < 0) position = 0;
    this._position = position;
    this.changed.emit();
  }

  public setCurves(fadeIn: FadeCurve, fadeOut: FadeCurve): void {
    this._fadeInCurve = fadeIn;
    this._fadeOutCurve = fadeOut;
    this.changed.emit();
  }

  public setType(type: CrossfadeType): void {
    this._type = type;
    this.changed.emit();
  }

  public setActive(active: boolean): void {
    this._active = active;
    this.changed.emit();
  }

  // ─── Gain Calculation ────────────────────────────────────────────────────

  /**
   * Calculate the gain value at a given frame for either the fade-in or
   * fade-out side of the crossfade.
   *
   * @param frame  The absolute timeline frame.
   * @param isIn   True for the fade-in region, false for the fade-out region.
   * @returns Gain value in the range [0, 1]. Returns 1 if the frame is
   *          outside the crossfade range (no attenuation).
   */
  public getGainAt(frame: FrameCount, isIn: boolean): number {
    if (!this._active || this._length === 0) return 1;

    // Frame is before or after the crossfade zone
    if (frame < this._position || frame >= this.end) {
      return 1;
    }

    // Normalised position within the crossfade (0..1)
    const t = (frame - this._position) / this._length;

    if (isIn) {
      return computeFadeInGain(t, this._fadeInCurve);
    } else {
      return computeFadeOutGain(t, this._fadeOutCurve);
    }
  }

  // ─── Bulk Gain Computation ───────────────────────────────────────────────

  /**
   * Pre-compute gain curves for efficient real-time use.
   *
   * @param numSamples  Number of samples to compute (typically the crossfade
   *                    length, but can be any resolution).
   * @returns An object containing Float32Arrays for both curves.
   */
  public computeGainCurve(numSamples: number): {
    fadeIn: Float32Array;
    fadeOut: Float32Array;
  } {
    const fadeIn = new Float32Array(numSamples);
    const fadeOut = new Float32Array(numSamples);

    if (numSamples <= 1) {
      if (numSamples === 1) {
        fadeIn[0] = 0.5;
        fadeOut[0] = 0.5;
      }
      return { fadeIn, fadeOut };
    }

    for (let i = 0; i < numSamples; i++) {
      const t = i / (numSamples - 1);
      fadeIn[i] = computeFadeInGain(t, this._fadeInCurve);
      fadeOut[i] = computeFadeOutGain(t, this._fadeOutCurve);
    }

    return { fadeIn, fadeOut };
  }

  // ─── Static Helpers ──────────────────────────────────────────────────────

  /**
   * Calculate the overlap between two regions. Returns null if there is no
   * overlap. The convention is that regionA is the earlier (fade-out) region
   * and regionB is the later (fade-in) region, but the method handles
   * either ordering.
   */
  public static calculateOverlap(
    regionA: Region,
    regionB: Region,
  ): {
    position: FrameCount;
    length: FrameCount;
    outRegionId: RegionId;
    inRegionId: RegionId;
  } | null {
    const overlapStart = Math.max(regionA.start, regionB.start);
    const overlapEnd = Math.min(regionA.end, regionB.end);

    if (overlapStart >= overlapEnd) {
      return null; // No overlap
    }

    // Determine which region comes first (fade-out) and which comes second (fade-in)
    const outRegionId =
      regionA.start <= regionB.start ? regionA.id : regionB.id;
    const inRegionId = regionA.start <= regionB.start ? regionB.id : regionA.id;

    return {
      position: overlapStart,
      length: overlapEnd - overlapStart,
      outRegionId,
      inRegionId,
    };
  }
}
