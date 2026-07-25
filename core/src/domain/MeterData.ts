/**
 * Metering data for a single channel or bus.
 * All levels are in dBFS (decibels relative to full scale).
 */
export interface MeterData {
  /** Peak level in dBFS */
  peak: number;
  /** RMS level in dBFS */
  rms: number;
  /** Peak hold value (decays slowly over time) */
  peakHold: number;
  /** True if signal clips (peak >= 0 dBFS) */
  clipping: boolean;
  /** Short-term LUFS (ITU-R BS.1770) */
  lufs?: number;
}

/**
 * Stereo metering data with separate left and right channels.
 */
export interface StereoMeterData {
  left: MeterData;
  right: MeterData;
}
