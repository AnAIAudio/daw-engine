import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";

/**
 * Panning algorithm type.
 */
export enum PannerType {
  /** Simple left/right balance control. */
  STEREO_BALANCE = "stereo_balance",
  /** Stereo width (MS mid-side encoding). */
  STEREO_WIDTH = "stereo_width",
  /** Equal-power panning law (cosine/sine). */
  EQUAL_POWER = "equal_power",
  /** Linear panning law. */
  LINEAR = "linear",
}

/**
 * Pan law compensation applied at center position.
 *
 * When a mono signal is panned to center, both speakers reproduce the full
 * signal, causing an apparent loudness increase.  Pan laws attenuate the
 * center position to compensate.
 */
export enum PanLaw {
  /** -3 dB center attenuation (equal power, default). */
  MINUS_3DB = "-3dB",
  /** -4.5 dB center attenuation (compromise). */
  MINUS_4_5DB = "-4.5dB",
  /** -6 dB center attenuation (linear). */
  MINUS_6DB = "-6dB",
  /** 0 dB center — no compensation. */
  ZERO_DB = "0dB",
}

/**
 * Map from PanLaw to the linear gain factor applied at dead center.
 */
function panLawCenterGain(law: PanLaw): number {
  switch (law) {
    case PanLaw.MINUS_3DB:
      return Math.pow(10, -3.0 / 20); // ~0.7071
    case PanLaw.MINUS_4_5DB:
      return Math.pow(10, -4.5 / 20); // ~0.5957
    case PanLaw.MINUS_6DB:
      return Math.pow(10, -6.0 / 20); // ~0.5012
    case PanLaw.ZERO_DB:
      return 1.0;
  }
}

/**
 * Full-featured stereo panner.
 *
 * Supports multiple panning algorithms ({@link PannerType}), configurable
 * pan laws ({@link PanLaw}), stereo width control, and a future-proof
 * elevation parameter for 3-D panning.
 *
 * Signal chain position (inside {@link Route}):
 *   … -> [Post-fader plugins] -> **Panner** -> Output
 */
export class Panner extends Processor {
  private _type: PannerType;
  private _panLaw: PanLaw;

  /** Azimuth position: -1.0 (hard left) to 1.0 (hard right). */
  private _azimuth: number = 0;
  /** Stereo width: 0.0 (mono) to 1.0 (normal) to 2.0 (extra wide). */
  private _width: number = 1.0;
  /** Elevation: -1.0 to 1.0 (reserved for future 3-D / Atmos support). */
  private _elevation: number = 0;

  // ── Signals ─────────────────────────────────────────────────────────────
  public readonly azimuthChanged = new Signal<number>();
  public readonly widthChanged = new Signal<number>();
  public readonly typeChanged = new Signal<PannerType>();

  constructor(
    id: ProcessorId,
    name: string = "Panner",
    type: PannerType = PannerType.EQUAL_POWER,
    panLaw: PanLaw = PanLaw.MINUS_3DB,
  ) {
    super(id, name);
    this._type = type;
    this._panLaw = panLaw;
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  public get type(): PannerType {
    return this._type;
  }
  public get panLaw(): PanLaw {
    return this._panLaw;
  }
  public get azimuth(): number {
    return this._azimuth;
  }
  public get width(): number {
    return this._width;
  }
  public get elevation(): number {
    return this._elevation;
  }

  // ── Setters ─────────────────────────────────────────────────────────────

  /**
   * Set the pan position (azimuth).
   * @param value -1.0 (hard left) to 1.0 (hard right).
   */
  public setAzimuth(value: number): void {
    const clamped = Math.max(-1, Math.min(1, value));
    if (this._azimuth !== clamped) {
      this._azimuth = clamped;
      this.azimuthChanged.emit(clamped);
      this.stateChanged.emit();
    }
  }

  /**
   * Set the stereo width.
   * @param value 0.0 (mono) through 1.0 (normal) to 2.0 (extra wide).
   */
  public setWidth(value: number): void {
    const clamped = Math.max(0, Math.min(2, value));
    if (this._width !== clamped) {
      this._width = clamped;
      this.widthChanged.emit(clamped);
      this.stateChanged.emit();
    }
  }

  /**
   * Set the elevation (reserved for 3-D panning).
   * @param value -1.0 to 1.0.
   */
  public setElevation(value: number): void {
    const clamped = Math.max(-1, Math.min(1, value));
    this._elevation = clamped;
  }

  /**
   * Set the pan law.
   */
  public setPanLaw(law: PanLaw): void {
    this._panLaw = law;
    this.stateChanged.emit();
  }

  /**
   * Set the panner type (algorithm).
   */
  public setType(type: PannerType): void {
    if (this._type !== type) {
      this._type = type;
      this.typeChanged.emit(type);
      this.stateChanged.emit();
    }
  }

  // ── Core computation ────────────────────────────────────────────────────

  /**
   * Compute the left and right gain coefficients for the current pan
   * position, width, type and pan law.
   *
   * @returns `[leftGain, rightGain]` — linear gain values.
   */
  public computeGains(): [number, number] {
    switch (this._type) {
      case PannerType.EQUAL_POWER:
        return this._computeEqualPower();
      case PannerType.LINEAR:
        return this._computeLinear();
      case PannerType.STEREO_BALANCE:
        return this._computeStereoBalance();
      case PannerType.STEREO_WIDTH:
        return this._computeStereoWidth();
    }
  }

  /**
   * Equal-power panning: left = cos(theta), right = sin(theta)
   * where theta = normalizedPan * PI/2.
   */
  private _computeEqualPower(): [number, number] {
    const normalized = (this._azimuth + 1) / 2; // 0..1
    const angle = (normalized * Math.PI) / 2;
    let leftGain = Math.cos(angle);
    let rightGain = Math.sin(angle);

    // Apply pan-law compensation at center.
    // At center (normalized = 0.5) the raw equal-power gains are both
    // ~0.7071 (-3 dB).  To map to a different pan law we scale so that
    // the center level matches the chosen law.
    const compensation = this._centerCompensation(PanLaw.MINUS_3DB);
    leftGain *= compensation;
    rightGain *= compensation;

    return [leftGain, rightGain];
  }

  /**
   * Linear panning: left = 1 - pan, right = pan (pan 0..1).
   */
  private _computeLinear(): [number, number] {
    const normalized = (this._azimuth + 1) / 2; // 0..1
    let leftGain = 1 - normalized;
    let rightGain = normalized;

    // Raw linear center is 0.5 each (-6 dB).
    const compensation = this._centerCompensation(PanLaw.MINUS_6DB);
    leftGain *= compensation;
    rightGain *= compensation;

    return [leftGain, rightGain];
  }

  /**
   * Stereo balance: attenuates the opposite channel rather than boosting.
   * At center both channels pass at unity; panning left attenuates right.
   */
  private _computeStereoBalance(): [number, number] {
    // normalized: 0 = hard left, 0.5 = center, 1 = hard right
    const normalized = (this._azimuth + 1) / 2;
    let leftGain: number;
    let rightGain: number;

    if (normalized <= 0.5) {
      // Panned left — attenuate right channel
      leftGain = 1.0;
      rightGain = normalized * 2; // 0..1
    } else {
      // Panned right — attenuate left channel
      leftGain = (1 - normalized) * 2; // 1..0
      rightGain = 1.0;
    }

    return [leftGain, rightGain];
  }

  /**
   * Stereo width via mid/side (MS) encoding.
   *
   * Mid  = (L + R) / 2
   * Side = (L - R) / 2
   *
   * Recombine with width factor w:
   *   L' = Mid + w * Side
   *   R' = Mid - w * Side
   *
   * width = 0 -> mono, 1 -> normal stereo, 2 -> extra wide.
   *
   * Azimuth is applied on top as equal-power balance of the result.
   */
  private _computeStereoWidth(): [number, number] {
    // Start with equal-power base for the azimuth component
    const normalized = (this._azimuth + 1) / 2;
    const angle = (normalized * Math.PI) / 2;
    let leftGain = Math.cos(angle);
    let rightGain = Math.sin(angle);

    // Apply width via MS transform coefficients.
    // For a mono input treated as mid-only (side = 0):
    //   L = mid, R = mid  ->  both get equal-power panned gains.
    // For a stereo signal with width:
    //   The width scales the side component.  We express this as
    //   gain adjustments that can be applied per-channel.
    const mid = 1.0;
    const side = this._width;
    const lScale = (mid + side) / 2;
    const rScale = (mid + side) / 2;

    leftGain *= lScale;
    rightGain *= rScale;

    const compensation = this._centerCompensation(PanLaw.MINUS_3DB);
    leftGain *= compensation;
    rightGain *= compensation;

    return [leftGain, rightGain];
  }

  /**
   * Compute the gain multiplier that compensates between the raw algorithm's
   * inherent center level and the user-selected pan law.
   *
   * @param rawLaw The pan law inherent to the raw algorithm.
   * @returns A linear gain multiplier (>= 1 if boosting center, <= 1 if cutting).
   */
  private _centerCompensation(rawLaw: PanLaw): number {
    const rawCenter = panLawCenterGain(rawLaw);
    const targetCenter = panLawCenterGain(this._panLaw);
    // Scale so that at center, the actual level matches `targetCenter`.
    return targetCenter / rawCenter;
  }

  // ── Normalized / automation helpers ──────────────────────────────────────

  /**
   * Get the azimuth as a normalized 0..1 value (for automation lanes).
   * 0 = hard left, 0.5 = center, 1 = hard right.
   */
  public getNormalizedAzimuth(): number {
    return (this._azimuth + 1) / 2;
  }

  /**
   * Set azimuth from a normalized 0..1 value.
   */
  public setNormalizedAzimuth(normalized: number): void {
    const clamped = Math.max(0, Math.min(1, normalized));
    this.setAzimuth(clamped * 2 - 1);
  }

  // ── Display ─────────────────────────────────────────────────────────────

  /**
   * Human-readable string for the current pan position.
   *
   * Examples: `"L 30"`, `"C"`, `"R 45"`, `"L 100"`.
   */
  public valueAsString(): string {
    if (this._azimuth === 0) {
      return "C";
    }

    // Convert -1..1 to percentage-like 0..100
    const pct = Math.round(Math.abs(this._azimuth) * 100);
    const dir = this._azimuth < 0 ? "L" : "R";
    return `${dir} ${pct}`;
  }
}
