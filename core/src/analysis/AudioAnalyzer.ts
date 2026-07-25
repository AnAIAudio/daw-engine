/**
 * AudioAnalyzer provides audio analysis algorithms.
 *
 * Algorithms:
 * - Transient detection: Find percussive onsets in audio
 * - Onset detection: Find note beginnings
 * - BPM detection: Estimate tempo from audio
 * - Peak analysis: Find loudest points
 * - RMS analysis: Compute loudness over time
 * - Zero-crossing rate: Tonal vs percussive analysis
 *
 * All DSP is implemented in pure TypeScript with no external dependencies.
 * FFT uses a radix-2 Cooley-Tukey implementation.
 */

export interface TransientResult {
  positions: number[]; // Frame positions of detected transients
  strengths: number[]; // Relative strength of each transient (0-1)
}

export interface OnsetResult {
  positions: number[];
  types: ("percussive" | "tonal" | "mixed")[];
}

export interface BPMResult {
  bpm: number;
  confidence: number; // 0-1
  alternatives: { bpm: number; confidence: number }[];
}

export interface PeakAnalysis {
  peaks: { frame: number; amplitude: number }[];
  truePeak: number;
  peakFrame: number;
}

export interface LoudnessProfile {
  rms: Float32Array; // RMS values per analysis window
  windowSize: number; // Analysis window in frames
  hopSize: number; // Hop between windows
  integratedLUFS: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_HOP_SIZE = 512;
const DEFAULT_TRANSIENT_THRESHOLD = 1.4;
const DEFAULT_ONSET_THRESHOLD = 1.3;
const MEDIAN_FILTER_SIZE = 11;
const MIN_ONSET_SPACING_MS = 50; // Minimum ms between detected onsets

export class AudioAnalyzer {
  private sampleRate: number;

  constructor(sampleRate: number = 44100) {
    this.sampleRate = sampleRate;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Transient Detection — spectral flux with adaptive threshold
  // ════════════════════════════════════════════════════════════════════════

  detectTransients(
    audioData: Float32Array,
    options: { threshold?: number; windowSize?: number } = {},
  ): TransientResult {
    const windowSize = options.windowSize ?? 1024;
    const fftSize = this.nextPow2(windowSize);
    const hopSize = windowSize >>> 1;
    const threshold = options.threshold ?? DEFAULT_TRANSIENT_THRESHOLD;

    if (audioData.length < fftSize) {
      return { positions: [], strengths: [] };
    }

    const hannWin = this.hannWindow(fftSize);
    const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1;
    const fluxValues = new Float32Array(numFrames);

    let prevMag: Float32Array = new Float32Array(fftSize / 2 + 1);

    // Pass 1: compute spectral flux for each frame
    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;
      const windowed = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        windowed[i] =
          offset + i < audioData.length
            ? audioData[offset + i] * hannWin[i]
            : 0;
      }

      const { magnitude } = this.computeFFT(windowed, fftSize);

      // Spectral flux = sum of positive magnitude differences
      let flux = 0;
      for (let k = 0; k <= fftSize / 2; k++) {
        const diff = magnitude[k] - prevMag[k];
        if (diff > 0) flux += diff;
      }
      fluxValues[f] = flux;
      prevMag = magnitude;
    }

    // Pass 2: adaptive peak-picking with median threshold
    const positions: number[] = [];
    const strengths: number[] = [];
    const halfMedian = (MEDIAN_FILTER_SIZE - 1) >>> 1;
    const minSpacingFrames = Math.floor(
      ((MIN_ONSET_SPACING_MS / 1000) * this.sampleRate) / hopSize,
    );

    // Find maximum flux for normalisation
    let maxFlux = 0;
    for (let f = 0; f < numFrames; f++) {
      if (fluxValues[f] > maxFlux) maxFlux = fluxValues[f];
    }
    if (maxFlux === 0) return { positions: [], strengths: [] };

    let lastPickedFrame = -minSpacingFrames - 1;

    for (let f = 0; f < numFrames; f++) {
      // Gather neighbourhood for median
      const start = Math.max(0, f - halfMedian);
      const end = Math.min(numFrames - 1, f + halfMedian);
      const neighbourhood: number[] = [];
      for (let j = start; j <= end; j++) {
        neighbourhood.push(fluxValues[j]);
      }
      neighbourhood.sort((a, b) => a - b);
      const median = neighbourhood[neighbourhood.length >>> 1];

      if (
        fluxValues[f] > median * threshold &&
        fluxValues[f] > 0 &&
        f - lastPickedFrame >= minSpacingFrames
      ) {
        const samplePos = f * hopSize + (fftSize >>> 1);
        positions.push(samplePos);
        strengths.push(fluxValues[f] / maxFlux);
        lastPickedFrame = f;
      }
    }

    return { positions, strengths };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Onset Detection — high-frequency content + spectral flux
  // ════════════════════════════════════════════════════════════════════════

  detectOnsets(
    audioData: Float32Array,
    options: { threshold?: number; windowSize?: number } = {},
  ): OnsetResult {
    const windowSize = options.windowSize ?? 1024;
    const fftSize = this.nextPow2(windowSize);
    const hopSize = windowSize >>> 1;
    const threshold = options.threshold ?? DEFAULT_ONSET_THRESHOLD;

    if (audioData.length < fftSize) {
      return { positions: [], types: [] };
    }

    const hannWin = this.hannWindow(fftSize);
    const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1;

    const hfcValues = new Float32Array(numFrames); // High-frequency content
    const fluxValues = new Float32Array(numFrames); // Spectral flux
    const zcrValues = new Float32Array(numFrames); // Zero-crossing rate per frame

    let prevMag: Float32Array = new Float32Array(fftSize / 2 + 1);
    const halfSpec = fftSize / 2;

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;

      // Windowed frame for FFT
      const windowed = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        windowed[i] =
          offset + i < audioData.length
            ? audioData[offset + i] * hannWin[i]
            : 0;
      }

      const { magnitude } = this.computeFFT(windowed, fftSize);

      // HFC = sum(k * |X[k]|^2) — emphasises high-frequency energy
      let hfc = 0;
      let flux = 0;
      for (let k = 0; k <= halfSpec; k++) {
        hfc += k * magnitude[k] * magnitude[k];
        const diff = magnitude[k] - prevMag[k];
        if (diff > 0) flux += diff;
      }
      hfcValues[f] = hfc;
      fluxValues[f] = flux;
      prevMag = magnitude;

      // Per-frame ZCR (in the time domain)
      let zcr = 0;
      for (let i = 1; i < fftSize && offset + i < audioData.length; i++) {
        if (audioData[offset + i] >= 0 !== audioData[offset + i - 1] >= 0) {
          zcr++;
        }
      }
      zcrValues[f] = zcr / fftSize;
    }

    // Combine HFC and spectral flux into a single onset detection function
    // Normalise each to 0-1 range
    let maxHfc = 0;
    let maxFlux = 0;
    for (let f = 0; f < numFrames; f++) {
      if (hfcValues[f] > maxHfc) maxHfc = hfcValues[f];
      if (fluxValues[f] > maxFlux) maxFlux = fluxValues[f];
    }
    if (maxHfc === 0 && maxFlux === 0) {
      return { positions: [], types: [] };
    }

    const odf = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      const normHfc = maxHfc > 0 ? hfcValues[f] / maxHfc : 0;
      const normFlux = maxFlux > 0 ? fluxValues[f] / maxFlux : 0;
      odf[f] = 0.5 * normHfc + 0.5 * normFlux;
    }

    // Adaptive peak-picking
    const positions: number[] = [];
    const types: ("percussive" | "tonal" | "mixed")[] = [];
    const halfMedian = (MEDIAN_FILTER_SIZE - 1) >>> 1;
    const minSpacingFrames = Math.floor(
      ((MIN_ONSET_SPACING_MS / 1000) * this.sampleRate) / hopSize,
    );
    let lastPicked = -minSpacingFrames - 1;

    for (let f = 0; f < numFrames; f++) {
      const start = Math.max(0, f - halfMedian);
      const end = Math.min(numFrames - 1, f + halfMedian);
      const neighbourhood: number[] = [];
      for (let j = start; j <= end; j++) {
        neighbourhood.push(odf[j]);
      }
      neighbourhood.sort((a, b) => a - b);
      const median = neighbourhood[neighbourhood.length >>> 1];

      if (
        odf[f] > median * threshold &&
        odf[f] > 0.01 &&
        f - lastPicked >= minSpacingFrames
      ) {
        const samplePos = f * hopSize + (fftSize >>> 1);
        positions.push(samplePos);

        // Classify onset type using ZCR:
        // High ZCR => percussive, Low ZCR => tonal
        const zcr = zcrValues[f];
        if (zcr > 0.15) {
          types.push("percussive");
        } else if (zcr < 0.05) {
          types.push("tonal");
        } else {
          types.push("mixed");
        }

        lastPicked = f;
      }
    }

    return { positions, types };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  BPM Detection — onset autocorrelation
  // ════════════════════════════════════════════════════════════════════════

  detectBPM(
    audioData: Float32Array,
    options: { minBPM?: number; maxBPM?: number } = {},
  ): BPMResult {
    const minBPM = options.minBPM ?? 60;
    const maxBPM = options.maxBPM ?? 200;

    // Step 1: Build an onset strength envelope
    const windowSize = 1024;
    const fftSize = this.nextPow2(windowSize);
    const hopSize = windowSize >>> 1;
    const hannWin = this.hannWindow(fftSize);
    const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1;

    if (numFrames < 4) {
      return { bpm: 0, confidence: 0, alternatives: [] };
    }

    const onsetEnvelope = new Float32Array(numFrames);
    let prevMag: Float32Array = new Float32Array(fftSize / 2 + 1);

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;
      const windowed = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        windowed[i] =
          offset + i < audioData.length
            ? audioData[offset + i] * hannWin[i]
            : 0;
      }

      const { magnitude } = this.computeFFT(windowed, fftSize);

      let flux = 0;
      for (let k = 0; k <= fftSize / 2; k++) {
        const diff = magnitude[k] - prevMag[k];
        if (diff > 0) flux += diff;
      }
      onsetEnvelope[f] = flux;
      prevMag = magnitude;
    }

    // Step 2: Convert BPM range to lag range (in onset-envelope frames)
    // lag = (60 / bpm) * (sampleRate / hopSize)
    const framesPerSecond = this.sampleRate / hopSize;
    const minLag = Math.floor((60 / maxBPM) * framesPerSecond);
    const maxLag = Math.ceil((60 / minBPM) * framesPerSecond);

    if (maxLag >= numFrames) {
      // Not enough audio for the requested BPM range
      return { bpm: 0, confidence: 0, alternatives: [] };
    }

    // Step 3: Autocorrelation of onset envelope
    const acf = this.autocorrelate(onsetEnvelope, minLag, maxLag);

    // Step 4: Find peaks in the autocorrelation function
    const candidates: { lag: number; value: number }[] = [];
    let acfMax = 0;
    for (let i = 0; i < acf.length; i++) {
      if (acf[i] > acfMax) acfMax = acf[i];
    }
    if (acfMax === 0) {
      return { bpm: 0, confidence: 0, alternatives: [] };
    }

    // Local maxima detection
    for (let i = 1; i < acf.length - 1; i++) {
      if (acf[i] > acf[i - 1] && acf[i] > acf[i + 1] && acf[i] > acfMax * 0.1) {
        const lag = minLag + i;
        candidates.push({ lag, value: acf[i] / acfMax });
      }
    }

    if (candidates.length === 0) {
      // Fallback: use the global maximum
      let bestIdx = 0;
      for (let i = 1; i < acf.length; i++) {
        if (acf[i] > acf[bestIdx]) bestIdx = i;
      }
      const lag = minLag + bestIdx;
      const bpm = (60 * framesPerSecond) / lag;
      return {
        bpm: Math.round(bpm * 10) / 10,
        confidence: acf[bestIdx] / acfMax,
        alternatives: [],
      };
    }

    // Sort by strength descending
    candidates.sort((a, b) => b.value - a.value);

    // Convert lag to BPM
    const results = candidates.map((c) => ({
      bpm: Math.round(((60 * framesPerSecond) / c.lag) * 10) / 10,
      confidence: c.value,
    }));

    // Deduplicate near-identical BPMs (within 1 BPM)
    const deduped: typeof results = [];
    for (const r of results) {
      const hasSimilar = deduped.some((d) => Math.abs(d.bpm - r.bpm) < 1);
      if (!hasSimilar) deduped.push(r);
    }

    return {
      bpm: deduped[0].bpm,
      confidence: deduped[0].confidence,
      alternatives: deduped.slice(1, 5),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Peak Analysis
  // ════════════════════════════════════════════════════════════════════════

  analyzePeaks(audioData: Float32Array, count: number = 10): PeakAnalysis {
    if (audioData.length === 0) {
      return { peaks: [], truePeak: 0, peakFrame: 0 };
    }

    // Find true peak
    let truePeak = 0;
    let peakFrame = 0;
    for (let i = 0; i < audioData.length; i++) {
      const abs = Math.abs(audioData[i]);
      if (abs > truePeak) {
        truePeak = abs;
        peakFrame = i;
      }
    }

    if (truePeak === 0) {
      return { peaks: [], truePeak: 0, peakFrame: 0 };
    }

    // Find local maxima using a window-based approach
    // Window size: ~10ms worth of samples
    const windowSamples = Math.max(Math.floor(this.sampleRate * 0.01), 16);
    const localPeaks: { frame: number; amplitude: number }[] = [];

    for (let i = windowSamples; i < audioData.length - windowSamples; i++) {
      const abs = Math.abs(audioData[i]);

      // Must be above a minimum level (1% of true peak)
      if (abs < truePeak * 0.01) continue;

      // Check if this is a local maximum
      let isMax = true;
      for (let j = -windowSamples; j <= windowSamples; j++) {
        if (j === 0) continue;
        if (Math.abs(audioData[i + j]) > abs) {
          isMax = false;
          break;
        }
      }

      if (isMax) {
        localPeaks.push({ frame: i, amplitude: abs });
      }
    }

    // Sort by amplitude descending and take top N
    localPeaks.sort((a, b) => b.amplitude - a.amplitude);
    const topPeaks = localPeaks.slice(0, count);

    // Sort final result by frame position for chronological order
    topPeaks.sort((a, b) => a.frame - b.frame);

    return {
      peaks: topPeaks,
      truePeak,
      peakFrame,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Loudness Profile (RMS + integrated LUFS)
  // ════════════════════════════════════════════════════════════════════════

  analyzeLoudness(
    audioData: Float32Array,
    windowSize?: number,
  ): LoudnessProfile {
    const winSize = windowSize ?? Math.floor(this.sampleRate * 0.4); // 400ms default (EBU R128)
    const hopSize = winSize >>> 1;
    const numWindows = Math.max(
      1,
      Math.floor((audioData.length - winSize) / hopSize) + 1,
    );

    const rms = new Float32Array(numWindows);

    // Also accumulate total mean square for integrated loudness
    let totalMeanSquare = 0;
    let totalSamples = 0;

    for (let w = 0; w < numWindows; w++) {
      const offset = w * hopSize;
      let sumOfSquares = 0;
      let count = 0;

      for (let i = 0; i < winSize && offset + i < audioData.length; i++) {
        const sample = audioData[offset + i];
        sumOfSquares += sample * sample;
        count++;
      }

      const windowRms = count > 0 ? Math.sqrt(sumOfSquares / count) : 0;
      rms[w] = windowRms;

      totalMeanSquare += sumOfSquares;
      totalSamples += count;
    }

    // Integrated LUFS approximation
    // True LUFS uses K-weighting and gating; this is a simplified version
    // using the mean square across the entire signal.
    // LUFS ~= -0.691 + 10 * log10(mean_square)
    const globalMeanSquare =
      totalSamples > 0 ? totalMeanSquare / totalSamples : 0;
    const integratedLUFS =
      globalMeanSquare > 0
        ? -0.691 + 10 * Math.log10(globalMeanSquare)
        : -Infinity;

    return {
      rms,
      windowSize: winSize,
      hopSize,
      integratedLUFS,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Zero-Crossing Rate
  // ════════════════════════════════════════════════════════════════════════

  computeZeroCrossingRate(
    audioData: Float32Array,
    windowSize?: number,
  ): Float32Array {
    const winSize = windowSize ?? 1024;
    const hopSize = winSize >>> 1;
    const numWindows = Math.max(
      1,
      Math.floor((audioData.length - winSize) / hopSize) + 1,
    );
    const zcr = new Float32Array(numWindows);

    for (let w = 0; w < numWindows; w++) {
      const offset = w * hopSize;
      let crossings = 0;

      for (let i = 1; i < winSize && offset + i < audioData.length; i++) {
        if (audioData[offset + i] >= 0 !== audioData[offset + i - 1] >= 0) {
          crossings++;
        }
      }

      // Normalise: crossings per sample
      zcr[w] = crossings / (winSize - 1);
    }

    return zcr;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Spectral Centroid
  // ════════════════════════════════════════════════════════════════════════

  computeSpectralCentroid(
    audioData: Float32Array,
    fftSize?: number,
  ): Float32Array {
    const fft = fftSize ?? DEFAULT_FFT_SIZE;
    const actualFftSize = this.nextPow2(fft);
    const hopSize = actualFftSize >>> 1;
    const hannWin = this.hannWindow(actualFftSize);
    const numFrames = Math.max(
      1,
      Math.floor((audioData.length - actualFftSize) / hopSize) + 1,
    );
    const centroids = new Float32Array(numFrames);

    const freqPerBin = this.sampleRate / actualFftSize;

    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;
      const windowed = new Float32Array(actualFftSize);
      for (let i = 0; i < actualFftSize; i++) {
        windowed[i] =
          offset + i < audioData.length
            ? audioData[offset + i] * hannWin[i]
            : 0;
      }

      const { magnitude } = this.computeFFT(windowed, actualFftSize);

      // Spectral centroid = sum(f_k * |X_k|) / sum(|X_k|)
      let numerator = 0;
      let denominator = 0;
      for (let k = 0; k <= actualFftSize / 2; k++) {
        const freq = k * freqPerBin;
        numerator += freq * magnitude[k];
        denominator += magnitude[k];
      }

      centroids[f] = denominator > 0 ? numerator / denominator : 0;
    }

    return centroids;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  FFT — Radix-2 Cooley-Tukey (in-place, decimation-in-time)
  // ════════════════════════════════════════════════════════════════════════

  private computeFFT(
    data: Float32Array,
    fftSize: number,
  ): { magnitude: Float32Array; phase: Float32Array } {
    const n = fftSize;

    // Copy real input into interleaved complex arrays
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      real[i] = data[i];
      // imag[i] is already 0
    }

    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        // Swap real
        let tmp = real[i];
        real[i] = real[j];
        real[j] = tmp;
        // Swap imag
        tmp = imag[i];
        imag[i] = imag[j];
        imag[j] = tmp;
      }
      let k = n >>> 1;
      while (k <= j) {
        j -= k;
        k >>>= 1;
      }
      j += k;
    }

    // Cooley-Tukey butterfly stages
    for (let stage = 1; stage < n; stage <<= 1) {
      const halfStage = stage;
      const fullStage = stage << 1;
      const angleIncrement = -Math.PI / halfStage;

      // Twiddle factors for this stage
      let twiddleReal = 1;
      let twiddleImag = 0;
      const wReal = Math.cos(angleIncrement);
      const wImag = Math.sin(angleIncrement);

      for (let k = 0; k < halfStage; k++) {
        for (let i = k; i < n; i += fullStage) {
          const partner = i + halfStage;

          // Butterfly
          const tReal =
            twiddleReal * real[partner] - twiddleImag * imag[partner];
          const tImag =
            twiddleReal * imag[partner] + twiddleImag * real[partner];

          real[partner] = real[i] - tReal;
          imag[partner] = imag[i] - tImag;
          real[i] += tReal;
          imag[i] += tImag;
        }

        // Rotate twiddle factor
        const nextTwiddleReal = twiddleReal * wReal - twiddleImag * wImag;
        const nextTwiddleImag = twiddleReal * wImag + twiddleImag * wReal;
        twiddleReal = nextTwiddleReal;
        twiddleImag = nextTwiddleImag;
      }
    }

    // Compute magnitude and phase for bins 0..N/2
    const halfN = n / 2;
    const magnitude = new Float32Array(halfN + 1);
    const phase = new Float32Array(halfN + 1);

    for (let k = 0; k <= halfN; k++) {
      magnitude[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
      phase[k] = Math.atan2(imag[k], real[k]);
    }

    return { magnitude, phase };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Hann Window
  // ════════════════════════════════════════════════════════════════════════

  private hannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Autocorrelation
  // ════════════════════════════════════════════════════════════════════════

  private autocorrelate(
    data: Float32Array,
    minLag: number,
    maxLag: number,
  ): Float32Array {
    const n = data.length;
    const resultLength = maxLag - minLag + 1;
    const result = new Float32Array(resultLength);

    // Subtract mean for better autocorrelation
    let mean = 0;
    for (let i = 0; i < n; i++) mean += data[i];
    mean /= n;

    // Compute unnormalised autocorrelation for each lag
    // R(lag) = sum_i( (x[i] - mean) * (x[i + lag] - mean) )
    let normFactor = 0;
    for (let i = 0; i < n; i++) {
      const centered = data[i] - mean;
      normFactor += centered * centered;
    }

    for (let lagIdx = 0; lagIdx < resultLength; lagIdx++) {
      const lag = minLag + lagIdx;
      let sum = 0;
      for (let i = 0; i < n - lag; i++) {
        sum += (data[i] - mean) * (data[i + lag] - mean);
      }
      // Normalise to [0,1]
      result[lagIdx] = normFactor > 0 ? sum / normFactor : 0;
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Utility
  // ════════════════════════════════════════════════════════════════════════

  private nextPow2(v: number): number {
    let p = 1;
    while (p < v) p <<= 1;
    return p;
  }
}
