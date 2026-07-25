import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";
import { MeterData } from "../domain/MeterData";
import { MeterPoint } from "../domain/MeterType";

/**
 * Metering DSP processor.
 *
 * Provides multi-channel peak, RMS, and peak-hold values along with
 * K-metering and VU calculation helpers.
 *
 * The meter can be positioned at different points in the signal chain
 * via the {@link MeterPoint} enum (input, pre-fader, post-fader, output).
 */
export class MeterProcessor extends Processor {
  /** Per-channel instantaneous peak levels in dBFS. */
  private peakValues: number[];
  /** Per-channel RMS levels in dBFS. */
  private rmsValues: number[];
  /** Per-channel peak-hold values in dBFS (decays slowly). */
  private peakHold: number[];
  /** Peak-hold decay rate in dB per frame callback. */
  private decayRate: number = 0.3;
  /** Number of audio channels this meter tracks. */
  private channelCount: number;

  /** Where in the signal chain this meter is placed. */
  private _meterPoint: MeterPoint;

  /** Emitted when meter data is updated. */
  public readonly meterUpdated = new Signal<MeterData>();
  /** Emitted when the meter point changes. */
  public readonly meterPointChanged = new Signal<MeterPoint>();

  /**
   * @param id          Unique processor identifier.
   * @param meterPoint  Initial placement in the signal chain.
   * @param channels    Number of audio channels (default 2 for stereo).
   */
  constructor(
    id: ProcessorId,
    meterPoint: MeterPoint = MeterPoint.POST_FADER,
    channels: number = 2,
  ) {
    super(id, "Meter");
    this._meterPoint = meterPoint;
    this.channelCount = channels;
    this.peakValues = new Array(channels).fill(-Infinity);
    this.rmsValues = new Array(channels).fill(-Infinity);
    this.peakHold = new Array(channels).fill(-Infinity);
  }

  // ── Meter Point ──────────────────────────────────────────────────────────

  /**
   * Set the meter position in the signal chain.
   * @param point The new meter point.
   */
  public setMeterPoint(point: MeterPoint): void {
    if (this._meterPoint !== point) {
      this._meterPoint = point;
      this.meterPointChanged.emit(point);
      this.stateChanged.emit();
    }
  }

  /** Get the current meter point. */
  public getMeterPoint(): MeterPoint {
    return this._meterPoint;
  }

  // ── DSP Helpers ──────────────────────────────────────────────────────────

  /**
   * Calculate a K-meter value from raw samples.
   *
   * K-metering (Bob Katz) applies a reference offset so that the meter's
   * 0 dB mark corresponds to the chosen reference level (e.g. -14 dBFS
   * for K-14, -20 dBFS for K-20).
   *
   * @param samples   Raw audio samples for a single channel.
   * @param reference Reference level in dBFS (e.g. -14 for K-14, -20 for K-20).
   * @returns The K-meter value in dB (relative to the reference).
   */
  public calculateKMeter(samples: Float32Array, reference: number): number {
    if (samples.length === 0) return -Infinity;

    let sumOfSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumOfSquares += samples[i] * samples[i];
    }

    const rmsLinear = Math.sqrt(sumOfSquares / samples.length);
    if (rmsLinear === 0) return -Infinity;

    const rmsDb = 20 * Math.log10(rmsLinear);
    // K-meter: shift so that `reference` dBFS reads as 0 on the scale
    return rmsDb - reference;
  }

  /**
   * Calculate a VU meter value from raw samples.
   *
   * A traditional VU meter has a 300 ms integration time (ballistic).
   * This method computes the RMS over the provided sample block, which
   * should ideally represent ~300 ms of audio for authentic behaviour.
   *
   * @param samples Raw audio samples for a single channel.
   * @returns VU level in dB (0 VU ~ -14 dBFS by convention, but we return
   *          raw dBFS here -- the UI layer can apply the VU offset).
   */
  public calculateVUMeter(samples: Float32Array): number {
    if (samples.length === 0) return -Infinity;

    let sumOfSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumOfSquares += samples[i] * samples[i];
    }

    const rmsLinear = Math.sqrt(sumOfSquares / samples.length);
    if (rmsLinear === 0) return -Infinity;

    return 20 * Math.log10(rmsLinear);
  }

  // ── State Update ─────────────────────────────────────────────────────────

  /**
   * Feed new sample data into the meter.
   *
   * Intended to be called by the audio backend once per process cycle.
   * Updates peak, RMS, and peak-hold values for each channel.
   *
   * @param channelData Array of Float32Array, one per channel.
   */
  public process(channelData: Float32Array[]): void {
    for (
      let ch = 0;
      ch < Math.min(channelData.length, this.channelCount);
      ch++
    ) {
      const samples = channelData[ch];

      // Peak
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
      }
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      this.peakValues[ch] = peakDb;

      // RMS
      let sumOfSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumOfSquares += samples[i] * samples[i];
      }
      const rmsLinear = Math.sqrt(sumOfSquares / samples.length);
      const rmsDb = rmsLinear > 0 ? 20 * Math.log10(rmsLinear) : -Infinity;
      this.rmsValues[ch] = rmsDb;

      // Peak hold with decay
      if (peakDb > this.peakHold[ch]) {
        this.peakHold[ch] = peakDb;
      } else {
        this.peakHold[ch] = Math.max(
          this.peakHold[ch] - this.decayRate,
          -Infinity,
        );
      }
    }

    this.meterUpdated.emit(this.getMeterData());
  }

  // ── Output ───────────────────────────────────────────────────────────────

  /**
   * Get the current aggregated meter data (stereo or mono).
   *
   * Returns the maximum peak/RMS across all channels, matching the
   * existing {@link MeterData} interface used throughout the application.
   */
  public getMeterData(): MeterData {
    let maxPeak = -Infinity;
    let maxRms = -Infinity;
    let maxPeakHold = -Infinity;

    for (let ch = 0; ch < this.channelCount; ch++) {
      if (this.peakValues[ch] > maxPeak) maxPeak = this.peakValues[ch];
      if (this.rmsValues[ch] > maxRms) maxRms = this.rmsValues[ch];
      if (this.peakHold[ch] > maxPeakHold) maxPeakHold = this.peakHold[ch];
    }

    return {
      peak: maxPeak,
      rms: maxRms,
      peakHold: maxPeakHold,
      clipping: maxPeak >= 0,
    };
  }

  /**
   * Get per-channel meter data.
   *
   * @returns An array of MeterData, one per channel.
   */
  public getChannelMeterData(): MeterData[] {
    const result: MeterData[] = [];
    for (let ch = 0; ch < this.channelCount; ch++) {
      result.push({
        peak: this.peakValues[ch],
        rms: this.rmsValues[ch],
        peakHold: this.peakHold[ch],
        clipping: this.peakValues[ch] >= 0,
      });
    }
    return result;
  }

  /**
   * Reset all peak-hold values to -Infinity.
   */
  public resetPeakHold(): void {
    this.peakHold.fill(-Infinity);
  }

  /**
   * Set the peak-hold decay rate.
   * @param rate Decay rate in dB per frame callback.
   */
  public setDecayRate(rate: number): void {
    this.decayRate = Math.max(0, rate);
  }
}
