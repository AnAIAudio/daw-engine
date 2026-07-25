/**
 * Utility functions for audio metering.
 * Operates on raw Float32Array time-domain data from AnalyserNode.
 */

/**
 * Convert a linear amplitude value to decibels (dBFS).
 * Returns -Infinity for zero or negative input.
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * Convert a decibel value to linear amplitude.
 * Returns 0 for -Infinity input.
 */
export function dbToLinear(db: number): number {
  if (db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Calculate peak level in dBFS from an AnalyserNode's time-domain data.
 */
export function calculatePeakDb(analyser: AnalyserNode): number {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  let peak = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > peak) {
      peak = abs;
    }
  }

  return linearToDb(peak);
}

/**
 * Calculate RMS level in dBFS from an AnalyserNode's time-domain data.
 */
export function calculateRmsDb(analyser: AnalyserNode): number {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    sumSquares += buffer[i] * buffer[i];
  }

  const rms = Math.sqrt(sumSquares / buffer.length);
  return linearToDb(rms);
}

/**
 * K-Metering (Item 7)
 * K-System meters offset dBFS so that the reference level sits at 0 on the scale.
 * K-14: 0 on scale = -14 dBFS (mastering/broadcast)
 * K-20: 0 on scale = -20 dBFS (film/large-venue)
 */

/** Apply K-14 offset: dBFS + 14 */
export function kMeter14(dbfs: number): number {
  return dbfs + 14;
}

/** Apply K-20 offset: dBFS + 20 */
export function kMeter20(dbfs: number): number {
  return dbfs + 20;
}

/** Generic K-meter offset */
export function kMeter(dbfs: number, kLevel: 14 | 20): number {
  return dbfs + kLevel;
}
