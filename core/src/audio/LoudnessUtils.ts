/**
 * Simplified ITU-R BS.1770 LUFS calculation.
 *
 * Applies a K-weighting approximation (high shelf at ~1500 Hz + high pass at ~38 Hz)
 * and computes the mean square loudness expressed as LUFS.
 */

/**
 * Second-order biquad filter coefficients.
 */
interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Pre-filter (high shelf ~+4 dB at 1500 Hz) coefficients for K-weighting.
 * This is a simplified design derived from the ITU-R BS.1770-4 specification.
 */
function highShelfCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347; // dB
  const Q = 0.7071752369554196;

  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);

  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/**
 * High-pass filter (~38 Hz) coefficients for K-weighting.
 */
function highPassCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;

  const K = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + K / Q + K * K;

  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/**
 * Apply a biquad filter in-place to a sample buffer.
 */
function applyBiquad(
  samples: Float32Array,
  coeffs: BiquadCoeffs,
): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 =
      coeffs.b0 * x0 +
      coeffs.b1 * x1 +
      coeffs.b2 * x2 -
      coeffs.a1 * y1 -
      coeffs.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return out;
}

/**
 * Calculate short-term LUFS from a mono sample buffer.
 *
 * Applies a simplified K-weighting filter (high shelf + high pass) and
 * returns the integrated loudness in LUFS.
 *
 * @param samples - PCM audio samples (mono, -1 to 1 range)
 * @param sampleRate - Sample rate in Hz
 * @returns LUFS value, or -Infinity for silence
 */
export function calculateLUFS(
  samples: Float32Array,
  sampleRate: number,
): number {
  if (samples.length === 0) return -Infinity;

  // Stage 1: High shelf filter (pre-filter)
  const shelf = highShelfCoeffs(sampleRate);
  const stage1 = applyBiquad(samples, shelf);

  // Stage 2: High-pass filter
  const hp = highPassCoeffs(sampleRate);
  const stage2 = applyBiquad(stage1, hp);

  // Stage 3: Mean square
  let sumSquares = 0;
  for (let i = 0; i < stage2.length; i++) {
    sumSquares += stage2[i] * stage2[i];
  }
  const meanSquare = sumSquares / stage2.length;

  if (meanSquare <= 0) return -Infinity;

  // LUFS = -0.691 + 10 * log10(meanSquare)
  return -0.691 + 10 * Math.log10(meanSquare);
}
