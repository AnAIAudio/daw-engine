/**
 * Meter Type
 */
export enum MeterType {
  PEAK = "peak",
  RMS = "rms",
  K14 = "k14",
  K20 = "k20",
  VU = "vu",
}

/**
 * Meter Point - where in the signal chain metering occurs
 */
export enum MeterPoint {
  INPUT = "input",
  PRE_FADER = "pre_fader",
  POST_FADER = "post_fader",
  OUTPUT = "output",
}
