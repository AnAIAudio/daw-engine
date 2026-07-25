import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";

/**
 * SurroundPanner supports multichannel panning beyond stereo.
 *
 * Supported layouts:
 * - Stereo (2.0): L, R
 * - Quad (4.0): FL, FR, RL, RR
 * - 5.1: FL, FR, C, LFE, RL, RR
 * - 7.1: FL, FR, C, LFE, RL, RR, SL, SR
 * - Atmos/3D: adds height channels
 *
 * Uses VBAP (Vector Base Amplitude Panning) algorithm for
 * arbitrary speaker configurations.
 */

export enum SpeakerLayout {
  STEREO = "STEREO",
  QUAD = "QUAD",
  SURROUND_5_1 = "5.1",
  SURROUND_7_1 = "7.1",
}

export interface SpeakerPosition {
  azimuth: number; // Horizontal angle in degrees (-180 to 180)
  elevation: number; // Vertical angle in degrees (-90 to 90)
  distance: number; // Distance (normalized, 1.0 = reference)
  label: string;
}

export interface SurroundPannerSnapshot {
  id: ProcessorId;
  name: string;
  azimuth: number;
  elevation: number;
  spread: number;
  lfeLevel: number;
  layout: SpeakerLayout;
  active: boolean;
}

export class SurroundPanner extends Processor {
  private _azimuth: number = 0; // Source horizontal angle in degrees
  private _elevation: number = 0; // Source vertical angle in degrees
  private _spread: number = 0; // Source spread (0 = point, 1 = omni)
  private _lfeLevel: number = 0; // LFE send level (0-1)
  private _layout: SpeakerLayout = SpeakerLayout.STEREO;
  private _speakers: SpeakerPosition[] = [];
  private _gains: Float32Array = new Float32Array(0);

  public readonly positionChanged = new Signal<{
    azimuth: number;
    elevation: number;
  }>();
  public readonly layoutChanged = new Signal<SpeakerLayout>();

  constructor(id: ProcessorId, layout?: SpeakerLayout) {
    super(id, "Surround Panner");
    const initialLayout = layout ?? SpeakerLayout.STEREO;
    this._speakers = this.setupSpeakers(initialLayout);
    this._layout = initialLayout;
    this._gains = new Float32Array(this._speakers.length);
    this.computeGains();
  }

  // ── Position control ────────────────────────────────────────────────────

  /**
   * Set the source position.
   * @param azimuth  Horizontal angle in degrees (-180 to 180).
   * @param elevation Vertical angle in degrees (-90 to 90). Defaults to current.
   */
  public setPosition(azimuth: number, elevation?: number): void {
    const clampedAz = Math.max(-180, Math.min(180, azimuth));
    const clampedEl =
      elevation !== undefined
        ? Math.max(-90, Math.min(90, elevation))
        : this._elevation;

    if (this._azimuth !== clampedAz || this._elevation !== clampedEl) {
      this._azimuth = clampedAz;
      this._elevation = clampedEl;
      this.computeGains();
      this.positionChanged.emit({
        azimuth: this._azimuth,
        elevation: this._elevation,
      });
      this.stateChanged.emit();
    }
  }

  /**
   * Set the source spread.
   * @param spread 0 = point source, 1 = omnidirectional.
   */
  public setSpread(spread: number): void {
    const clamped = Math.max(0, Math.min(1, spread));
    if (this._spread !== clamped) {
      this._spread = clamped;
      this.computeGains();
      this.stateChanged.emit();
    }
  }

  /**
   * Set the LFE send level.
   * @param level 0 to 1.
   */
  public setLFELevel(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    if (this._lfeLevel !== clamped) {
      this._lfeLevel = clamped;
      this.stateChanged.emit();
    }
  }

  public get azimuth(): number {
    return this._azimuth;
  }
  public get elevation(): number {
    return this._elevation;
  }
  public get spread(): number {
    return this._spread;
  }
  public get lfeLevel(): number {
    return this._lfeLevel;
  }

  // ── Layout ──────────────────────────────────────────────────────────────

  /**
   * Set the speaker layout. Recomputes speaker positions and gains.
   */
  public setLayout(layout: SpeakerLayout): void {
    if (this._layout !== layout) {
      this._layout = layout;
      this._speakers = this.setupSpeakers(layout);
      this._gains = new Float32Array(this._speakers.length);
      this.computeGains();
      this.layoutChanged.emit(layout);
      this.stateChanged.emit();
    }
  }

  public get layout(): SpeakerLayout {
    return this._layout;
  }

  /** Number of output channels for the current layout. */
  public get channelCount(): number {
    return this._speakers.length;
  }

  /** Speaker positions for the current layout. */
  public get speakers(): ReadonlyArray<SpeakerPosition> {
    return this._speakers;
  }

  // ── Gain computation ────────────────────────────────────────────────────

  /**
   * Compute per-channel gains based on the current source position,
   * spread, and layout using VBAP.
   *
   * @returns Float32Array of linear gains, one per speaker/channel.
   */
  public computeGains(): Float32Array {
    const hasElevation = this._elevation !== 0;
    let rawGains: Float32Array;

    if (hasElevation) {
      rawGains = this.vbap3D(this._azimuth, this._elevation);
    } else {
      rawGains = this.vbap2D(this._azimuth);
    }

    // Apply spread: interpolate between point-source gains and uniform (omni)
    if (this._spread > 0) {
      const uniformGain = 1.0 / Math.sqrt(this._speakers.length);
      for (let i = 0; i < rawGains.length; i++) {
        rawGains[i] =
          rawGains[i] * (1 - this._spread) + uniformGain * this._spread;
      }
    }

    // For 5.1 and 7.1 layouts, apply LFE level to the LFE channel
    if (
      this._layout === SpeakerLayout.SURROUND_5_1 ||
      this._layout === SpeakerLayout.SURROUND_7_1
    ) {
      const lfeIndex = this.getLFEChannelIndex();
      if (lfeIndex >= 0 && lfeIndex < rawGains.length) {
        rawGains[lfeIndex] = this._lfeLevel;
      }
    }

    // Store and return
    this._gains = rawGains;
    return new Float32Array(rawGains);
  }

  // ── VBAP algorithms ─────────────────────────────────────────────────────

  /**
   * 2D VBAP: Vector Base Amplitude Panning in the horizontal plane.
   *
   * For each adjacent speaker pair, computes the amplitude split
   * based on the angular position of the source relative to both speakers.
   *
   * @param azimuth Source azimuth in degrees (-180 to 180).
   */
  private vbap2D(azimuth: number): Float32Array {
    const gains = new Float32Array(this._speakers.length);
    const speakerCount = this._speakers.length;

    if (speakerCount === 0) return gains;

    // Special case: stereo uses simple equal-power panning
    if (this._layout === SpeakerLayout.STEREO) {
      // Normalize azimuth: -180..180 -> -1..1 for L/R
      const normalized = Math.max(-1, Math.min(1, azimuth / 180));
      const pan01 = (normalized + 1) / 2; // 0 = left, 1 = right
      const angle = (pan01 * Math.PI) / 2;
      gains[0] = Math.cos(angle); // Left
      gains[1] = Math.sin(angle); // Right
      return gains;
    }

    // Convert source azimuth to radians
    const sourceRad = (azimuth * Math.PI) / 180;

    // Get non-LFE speaker indices and their azimuths
    const activeSpeakers: { index: number; azimuthRad: number }[] = [];
    for (let i = 0; i < speakerCount; i++) {
      // Skip LFE channel in VBAP calculations
      if (this._speakers[i].label === "LFE") continue;
      activeSpeakers.push({
        index: i,
        azimuthRad: (this._speakers[i].azimuth * Math.PI) / 180,
      });
    }

    // Sort speakers by azimuth
    activeSpeakers.sort((a, b) => a.azimuthRad - b.azimuthRad);

    if (activeSpeakers.length === 0) return gains;
    if (activeSpeakers.length === 1) {
      gains[activeSpeakers[0].index] = 1.0;
      return gains;
    }

    // Find the two speakers that bracket the source angle
    let found = false;
    for (let i = 0; i < activeSpeakers.length; i++) {
      const next = (i + 1) % activeSpeakers.length;
      let az1 = activeSpeakers[i].azimuthRad;
      let az2 = activeSpeakers[next].azimuthRad;

      // Handle wrap-around
      let span = az2 - az1;
      if (span <= 0) span += 2 * Math.PI;

      let sourceOffset = sourceRad - az1;
      if (sourceOffset < 0) sourceOffset += 2 * Math.PI;

      if (sourceOffset <= span) {
        // Source is between speakers i and next
        const t = span > 0 ? sourceOffset / span : 0;

        // Equal-power crossfade between the two speakers
        const angle = (t * Math.PI) / 2;
        const g2 = Math.sin(angle);
        const g1 = Math.cos(angle);

        gains[activeSpeakers[i].index] = g1;
        gains[activeSpeakers[next].index] = g2;
        found = true;
        break;
      }
    }

    // Fallback: if no pair found, use closest speaker
    if (!found) {
      let minDist = Infinity;
      let closest = 0;
      for (const sp of activeSpeakers) {
        let dist = Math.abs(sourceRad - sp.azimuthRad);
        if (dist > Math.PI) dist = 2 * Math.PI - dist;
        if (dist < minDist) {
          minDist = dist;
          closest = sp.index;
        }
      }
      gains[closest] = 1.0;
    }

    return gains;
  }

  /**
   * 3D VBAP: Vector Base Amplitude Panning with elevation.
   *
   * Extends 2D VBAP by considering the vertical angle to distribute
   * energy across speakers at different elevations.
   *
   * @param azimuth Source azimuth in degrees.
   * @param elevation Source elevation in degrees.
   */
  private vbap3D(azimuth: number, elevation: number): Float32Array {
    const gains = new Float32Array(this._speakers.length);
    const speakerCount = this._speakers.length;

    if (speakerCount === 0) return gains;

    // Convert source position to Cartesian unit vector
    const srcAzRad = (azimuth * Math.PI) / 180;
    const srcElRad = (elevation * Math.PI) / 180;
    const srcX = Math.cos(srcElRad) * Math.cos(srcAzRad);
    const srcY = Math.cos(srcElRad) * Math.sin(srcAzRad);
    const srcZ = Math.sin(srcElRad);

    // Compute dot product with each speaker's direction vector.
    // This gives a measure of how "close" the source is to each speaker.
    const dotProducts: number[] = [];
    let totalWeight = 0;

    for (let i = 0; i < speakerCount; i++) {
      if (this._speakers[i].label === "LFE") {
        dotProducts.push(0);
        continue;
      }

      const spAzRad = (this._speakers[i].azimuth * Math.PI) / 180;
      const spElRad = (this._speakers[i].elevation * Math.PI) / 180;
      const spX = Math.cos(spElRad) * Math.cos(spAzRad);
      const spY = Math.cos(spElRad) * Math.sin(spAzRad);
      const spZ = Math.sin(spElRad);

      // Dot product (cosine of angle between source and speaker)
      let dot = srcX * spX + srcY * spY + srcZ * spZ;

      // Clamp to [0, 1] - speakers behind the source get no signal
      dot = Math.max(0, dot);

      // Square the dot product for sharper localization
      dot = dot * dot;

      dotProducts.push(dot);
      totalWeight += dot;
    }

    // Normalize and apply
    if (totalWeight > 0) {
      for (let i = 0; i < speakerCount; i++) {
        // Use sqrt for energy preservation (VBAP convention)
        gains[i] = Math.sqrt(dotProducts[i] / totalWeight);
      }
    } else {
      // Fallback: equal distribution across all non-LFE speakers
      let nonLfeCount = 0;
      for (let i = 0; i < speakerCount; i++) {
        if (this._speakers[i].label !== "LFE") nonLfeCount++;
      }
      if (nonLfeCount > 0) {
        const equalGain = 1.0 / Math.sqrt(nonLfeCount);
        for (let i = 0; i < speakerCount; i++) {
          if (this._speakers[i].label !== "LFE") {
            gains[i] = equalGain;
          }
        }
      }
    }

    return gains;
  }

  // ── Speaker setup ───────────────────────────────────────────────────────

  /**
   * Setup default speaker positions for a given layout.
   * Angles follow the ITU-R BS.775 and ITU-R BS.2051 standards.
   */
  private setupSpeakers(layout: SpeakerLayout): SpeakerPosition[] {
    switch (layout) {
      case SpeakerLayout.STEREO:
        return [
          { azimuth: -30, elevation: 0, distance: 1, label: "L" },
          { azimuth: 30, elevation: 0, distance: 1, label: "R" },
        ];

      case SpeakerLayout.QUAD:
        return [
          { azimuth: -45, elevation: 0, distance: 1, label: "FL" },
          { azimuth: 45, elevation: 0, distance: 1, label: "FR" },
          { azimuth: -135, elevation: 0, distance: 1, label: "RL" },
          { azimuth: 135, elevation: 0, distance: 1, label: "RR" },
        ];

      case SpeakerLayout.SURROUND_5_1:
        return [
          { azimuth: -30, elevation: 0, distance: 1, label: "FL" },
          { azimuth: 30, elevation: 0, distance: 1, label: "FR" },
          { azimuth: 0, elevation: 0, distance: 1, label: "C" },
          { azimuth: 0, elevation: -90, distance: 1, label: "LFE" },
          { azimuth: -110, elevation: 0, distance: 1, label: "RL" },
          { azimuth: 110, elevation: 0, distance: 1, label: "RR" },
        ];

      case SpeakerLayout.SURROUND_7_1:
        return [
          { azimuth: -30, elevation: 0, distance: 1, label: "FL" },
          { azimuth: 30, elevation: 0, distance: 1, label: "FR" },
          { azimuth: 0, elevation: 0, distance: 1, label: "C" },
          { azimuth: 0, elevation: -90, distance: 1, label: "LFE" },
          { azimuth: -135, elevation: 0, distance: 1, label: "RL" },
          { azimuth: 135, elevation: 0, distance: 1, label: "RR" },
          { azimuth: -90, elevation: 0, distance: 1, label: "SL" },
          { azimuth: 90, elevation: 0, distance: 1, label: "SR" },
        ];

      default:
        return [
          { azimuth: -30, elevation: 0, distance: 1, label: "L" },
          { azimuth: 30, elevation: 0, distance: 1, label: "R" },
        ];
    }
  }

  /**
   * Get the index of the LFE channel in the current layout.
   * Returns -1 if the layout has no LFE channel.
   */
  private getLFEChannelIndex(): number {
    return this._speakers.findIndex((s) => s.label === "LFE");
  }

  // ── Serialization ───────────────────────────────────────────────────────

  public toJSON(): SurroundPannerSnapshot {
    return {
      id: this.id,
      name: this.name,
      azimuth: this._azimuth,
      elevation: this._elevation,
      spread: this._spread,
      lfeLevel: this._lfeLevel,
      layout: this._layout,
      active: this.active,
    };
  }

  public static fromJSON(data: SurroundPannerSnapshot): SurroundPanner {
    const panner = new SurroundPanner(data.id, data.layout);
    panner.name = data.name;
    panner._azimuth = data.azimuth;
    panner._elevation = data.elevation;
    panner._spread = data.spread;
    panner._lfeLevel = data.lfeLevel;
    panner.active = data.active;
    panner.computeGains();
    return panner;
  }
}
