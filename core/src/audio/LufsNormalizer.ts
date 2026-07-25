/**
 * LUFS Normalizer — ITU-R BS.1770-4 compliant gated loudness measurement.
 *
 * Implements:
 *   1. K-weighting filter (high shelf + high pass)
 *   2. 400ms block mean square computation
 *   3. Absolute gate at -70 LUFS
 *   4. Relative gate at -10 dB below ungated mean
 *   5. Integrated loudness from gated blocks
 */

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Pre-filter (high shelf ~+4 dB at ~1681 Hz) for K-weighting.
 * ITU-R BS.1770-4 Table 1, Stage 1.
 */
function highShelfCoeffs(sampleRate: number): BiquadCoeffs {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
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
 * High-pass filter (~38 Hz) for K-weighting.
 * ITU-R BS.1770-4 Table 1, Stage 2.
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
 * Apply a biquad filter to samples, returning a new array.
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
 * Channel weight per ITU-R BS.1770-4:
 * L, R, C = 1.0; Ls, Rs (surround) = 1.41 (~+1.5 dB)
 * LFE = 0 (excluded)
 */
function getChannelWeight(channelIndex: number, totalChannels: number): number {
  if (totalChannels <= 2) return 1.0;
  // 5.1: L=0, R=1, C=2, LFE=3, Ls=4, Rs=5
  if (totalChannels >= 6 && channelIndex === 3) return 0; // LFE
  if (totalChannels >= 6 && (channelIndex === 4 || channelIndex === 5))
    return 1.41;
  return 1.0;
}

export interface LufsResult {
  /** Integrated loudness in LUFS */
  integrated: number;
  /** Short-term loudness (3s window) values */
  shortTerm: number[];
  /** Momentary loudness (400ms window) values */
  momentary: number[];
  /** True peak in dBFS (per channel) */
  truePeaks: number[];
  /** Loudness range (LRA) in LU */
  range: number;
}

/**
 * Measure integrated LUFS of an AudioBuffer using the BS.1770-4 gated algorithm.
 */
export function measureLUFS(buffer: AudioBuffer): LufsResult {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;

  // 400ms block size
  const blockSize = Math.round(sampleRate * 0.4);
  // 75% overlap → step = 100ms
  const stepSize = Math.round(sampleRate * 0.1);

  // Pre-compute K-weighting filter coefficients
  const shelf = highShelfCoeffs(sampleRate);
  const hp = highPassCoeffs(sampleRate);

  // K-weight all channels
  const kWeighted: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const raw = buffer.getChannelData(ch);
    const stage1 = applyBiquad(raw, shelf);
    const stage2 = applyBiquad(stage1, hp);
    kWeighted.push(stage2);
  }

  // Compute mean square per block, per channel, then sum with channel weights
  const blockLoudnesses: number[] = [];
  const numBlocks = Math.floor((buffer.length - blockSize) / stepSize) + 1;

  for (let b = 0; b < numBlocks; b++) {
    const start = b * stepSize;
    const end = start + blockSize;
    if (end > buffer.length) break;

    let sumWeightedMeanSquare = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const weight = getChannelWeight(ch, numChannels);
      if (weight === 0) continue;

      const data = kWeighted[ch];
      let sumSq = 0;
      for (let i = start; i < end; i++) {
        sumSq += data[i] * data[i];
      }
      sumWeightedMeanSquare += weight * (sumSq / blockSize);
    }

    // LUFS for this block
    const blockLufs =
      sumWeightedMeanSquare > 0
        ? -0.691 + 10 * Math.log10(sumWeightedMeanSquare)
        : -Infinity;

    blockLoudnesses.push(blockLufs);
  }

  // === Gated measurement ===

  // Step 1: Absolute gate at -70 LUFS
  const ABSOLUTE_GATE = -70;
  const aboveAbsoluteGate = blockLoudnesses.filter((l) => l > ABSOLUTE_GATE);

  if (aboveAbsoluteGate.length === 0) {
    return {
      integrated: -Infinity,
      shortTerm: [],
      momentary: blockLoudnesses,
      truePeaks: [],
      range: 0,
    };
  }

  // Step 2: Compute mean of blocks above absolute gate
  const ungatedMeanPower =
    aboveAbsoluteGate.reduce((sum, l) => {
      return sum + Math.pow(10, l / 10);
    }, 0) / aboveAbsoluteGate.length;
  const ungatedMeanLufs = -0.691 + 10 * Math.log10(ungatedMeanPower);

  // Step 3: Relative gate at -10 dB below ungated mean
  const relativeGate = ungatedMeanLufs - 10;

  // Step 4: Compute mean of blocks above both gates
  const aboveBothGates = blockLoudnesses.filter(
    (l) => l > ABSOLUTE_GATE && l > relativeGate,
  );

  let integrated = -Infinity;
  if (aboveBothGates.length > 0) {
    const gatedMeanPower =
      aboveBothGates.reduce((sum, l) => {
        return sum + Math.pow(10, l / 10);
      }, 0) / aboveBothGates.length;
    integrated = -0.691 + 10 * Math.log10(gatedMeanPower);
  }

  // Short-term loudness (3s window)
  const shortTermBlockSize = Math.round(sampleRate * 3);
  const shortTermStep = Math.round(sampleRate * 1);
  const shortTerm: number[] = [];
  for (
    let start = 0;
    start + shortTermBlockSize <= buffer.length;
    start += shortTermStep
  ) {
    let sumWeightedMS = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const weight = getChannelWeight(ch, numChannels);
      if (weight === 0) continue;
      const data = kWeighted[ch];
      let sumSq = 0;
      for (let i = start; i < start + shortTermBlockSize; i++) {
        sumSq += data[i] * data[i];
      }
      sumWeightedMS += weight * (sumSq / shortTermBlockSize);
    }
    shortTerm.push(
      sumWeightedMS > 0 ? -0.691 + 10 * Math.log10(sumWeightedMS) : -Infinity,
    );
  }

  // True peak detection (simple — for full spec, 4x oversample in TruePeakLimiter)
  const truePeaks: number[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    truePeaks.push(peak > 0 ? 20 * Math.log10(peak) : -Infinity);
  }

  // LRA (Loudness Range) — simplified: difference between 10th and 95th percentile of short-term
  let range = 0;
  const validShortTerm = shortTerm
    .filter((l) => l > ABSOLUTE_GATE && l > relativeGate)
    .sort((a, b) => a - b);
  if (validShortTerm.length >= 2) {
    const p10 = validShortTerm[Math.floor(validShortTerm.length * 0.1)];
    const p95 = validShortTerm[Math.floor(validShortTerm.length * 0.95)];
    range = p95 - p10;
  }

  return {
    integrated,
    shortTerm,
    momentary: blockLoudnesses,
    truePeaks,
    range,
  };
}

/**
 * Normalize an AudioBuffer to a target LUFS level.
 * Modifies the buffer in-place.
 *
 * @param buffer Audio buffer to normalize
 * @param targetLufs Target integrated loudness (default: -14 LUFS)
 * @returns The gain applied in dB, or 0 if silence
 */
export function normalizeLUFS(
  buffer: AudioBuffer,
  targetLufs: number = -14,
): number {
  const result = measureLUFS(buffer);

  if (result.integrated === -Infinity || !isFinite(result.integrated)) {
    return 0; // silence — no gain to apply
  }

  const gainDb = targetLufs - result.integrated;
  const gainLinear = Math.pow(10, gainDb / 20);

  // Apply gain to all channels
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] *= gainLinear;
    }
  }

  return gainDb;
}
