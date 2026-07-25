/**
 * Professional metering DSP algorithms implementing broadcast standards.
 *
 * Supported meter types:
 *   - Peak (simple sample-peak detection)
 *   - IEC 60268-10 Type I (DIN, Nordic)
 *   - IEC 60268-10 Type II (BBC PPM, EBU)
 *   - K-system (K-12, K-14, K-20)
 *   - VU (300ms RMS integration)
 *   - LUFS / EBU R128 (momentary, short-term, integrated, loudness range)
 *   - ITU-R BS.1770 true peak (4x oversampling)
 */

// ---------------------------------------------------------------------------
// Enums & Interfaces
// ---------------------------------------------------------------------------

export enum MeterType {
  PEAK = "peak",
  IEC1_DIN = "iec1_din",
  IEC1_NORDIC = "iec1_nordic",
  IEC2_BBC = "iec2_bbc",
  IEC2_EBU = "iec2_ebu",
  K_12 = "k12",
  K_14 = "k14",
  K_20 = "k20",
  VU = "vu",
  LUFS = "lufs",
  TRUE_PEAK = "true_peak",
}

export interface MeterReading {
  peak: number; // Current peak in dB
  rms: number; // Current RMS in dB
  peakHold: number; // Peak hold value in dB
  overCount: number; // Number of consecutive samples over 0 dBFS
}

export interface LUFSReading {
  momentary: number; // 400ms window  (M)
  shortTerm: number; // 3s window     (S)
  integrated: number; // Full program  (I)
  range: number; // Loudness range (LRA)
  truePeak: number; // Maximum true peak across all channels (dBTP)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEG_INF = -Infinity;
const LOG10_20 = 20 / Math.LN10; // pre-computed multiplier for 20*log10

/**
 * 4x oversampling polyphase FIR coefficients for ITU-R BS.1770 true peak.
 * 12 taps per phase, 4 phases = 48 total coefficients.
 * These approximate a half-band windowed-sinc interpolation filter.
 */
const TP_FIR_PHASES: Float64Array[] = [
  // Phase 0 (original samples, shifted by filter delay)
  new Float64Array([
    0.001708984375, 0.0, -0.0189208984375, 0.0, 0.3031005859375, 0.4736328125,
    0.3031005859375, 0.0, -0.0189208984375, 0.0, 0.001708984375, 0.0,
  ]),
  // Phase 1
  new Float64Array([
    0.0013427734375, -0.0117797851562, -0.0245361328125, 0.052734375,
    0.2926025390625, 0.4694213867188, 0.2926025390625, 0.052734375,
    -0.0245361328125, -0.0117797851562, 0.0013427734375, 0.0,
  ]),
  // Phase 2
  new Float64Array([
    0.0008544921875, -0.0200805664062, -0.021728515625, 0.0896606445312,
    0.2593994140625, 0.4530029296875, 0.3236083984375, 0.0896606445312,
    -0.021728515625, -0.0200805664062, 0.0008544921875, 0.0,
  ]),
  // Phase 3
  new Float64Array([
    0.0004272460938, -0.0254516601562, -0.0128173828125, 0.1141357421875,
    0.21533203125, 0.430908203125, 0.3472900390625, 0.1141357421875,
    -0.0128173828125, -0.0254516601562, 0.0004272460938, 0.0,
  ]),
];
const TP_FIR_LEN = 12; // taps per phase

// ---------------------------------------------------------------------------
// K-weighting biquad coefficients (ITU-R BS.1770-4)
// Pre-computed for 48 kHz; recalculated at runtime for other rates.
// ---------------------------------------------------------------------------

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/**
 * Design the K-weighting high shelf filter (stage 1).
 * f0 = 1681.97 Hz, gain = +3.999 dB, Q = 0.7071968
 */
function designKWeightShelf(sr: number): BiquadCoeffs {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347; // dB
  const Q = 0.7071752369554196;

  const A = Math.pow(10, G / 40); // sqrt of linear gain
  const w0 = (2 * Math.PI * f0) / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const Ap1 = A + 1;
  const Am1 = A - 1;
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  const a0 = Ap1 - Am1 * cosw0 + twoSqrtAAlpha;

  return {
    b0: (A * (Ap1 + Am1 * cosw0 + twoSqrtAAlpha)) / a0,
    b1: (-2 * A * (Am1 + Ap1 * cosw0)) / a0,
    b2: (A * (Ap1 + Am1 * cosw0 - twoSqrtAAlpha)) / a0,
    a1: (2 * (Am1 - Ap1 * cosw0)) / a0,
    a2: (Ap1 - Am1 * cosw0 - twoSqrtAAlpha) / a0,
  };
}

/**
 * Design the K-weighting high-pass filter (stage 2).
 * f0 = 38.13547087602444 Hz, Q = 0.5003270373238773
 */
function designKWeightHP(sr: number): BiquadCoeffs {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;

  const w0 = (2 * Math.PI * f0) / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const a0 = 1 + alpha;

  return {
    b0: (1 + cosw0) / 2 / a0,
    b1: -(1 + cosw0) / a0,
    b2: (1 + cosw0) / 2 / a0,
    a1: (-2 * cosw0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function makeBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

function biquadProcess(c: BiquadCoeffs, s: BiquadState, x: number): number {
  const y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
  s.x2 = s.x1;
  s.x1 = x;
  s.y2 = s.y1;
  s.y1 = y;
  return y;
}

// ---------------------------------------------------------------------------
// MeterDSP
// ---------------------------------------------------------------------------

export class MeterDSP {
  private _type: MeterType;
  private _sampleRate: number;
  private _channelCount: number;

  // Per-channel peak/rms state ------------------------------------------
  private _peaks: Float64Array;
  private _rms: Float64Array;
  private _peakHold: Float64Array;
  private _peakHoldDecay: number; // dB/s
  private _peakHoldTime: number; // frames until peak-hold starts decaying
  private _peakHoldCounter: Float64Array; // remaining hold frames per channel
  private _overCount: Int32Array;

  // IEC integrator state ------------------------------------------------
  private _iecIntegrator: Float64Array;

  // VU integrator state -------------------------------------------------
  private _vuIntegrator: Float64Array;

  // LUFS state (ITU-R BS.1770) ------------------------------------------
  private _kShelfCoeffs!: BiquadCoeffs;
  private _kHPCoeffs!: BiquadCoeffs;
  private _kWeightingState: Float64Array[]; // interleaved biquad state per ch
  private _kShelfStates: BiquadState[];
  private _kHPStates: BiquadState[];

  // Ring buffers for momentary (400ms) and short-term (3s) windows
  private _momentaryBuffer: Float64Array[]; // per-channel ring buffer (squared sums)
  private _shortTermBuffer: Float64Array[];
  private _momentaryLen: number; // number of 100ms blocks in 400ms
  private _shortTermLen: number; // number of 100ms blocks in 3s
  private _blockSize100ms: number; // samples in 100ms
  private _lufsBlockAccum: Float64Array; // accumulator per channel for current 100ms block
  private _lufsBlockSampleCount: number;
  private _momentaryWriteIdx: number;
  private _shortTermWriteIdx: number;
  private _momentaryFilled: number; // how many blocks have been written
  private _shortTermFilled: number;

  // Integrated loudness (gated)
  private _integratedSum: number;
  private _integratedCount: number;
  private _gatingBlocks: number[]; // loudness of each 100ms block for gating

  // True peak state
  private _truePeakMax: number; // running max across all channels (linear)
  private _tpHistory: Float64Array[]; // per-channel FIR history buffer

  // ── Constructor ─────────────────────────────────────────────────────

  constructor(type: MeterType, sampleRate: number, channelCount: number = 2) {
    this._type = type;
    this._sampleRate = sampleRate;
    this._channelCount = channelCount;

    // Per-channel arrays
    this._peaks = new Float64Array(channelCount);
    this._rms = new Float64Array(channelCount);
    this._peakHold = new Float64Array(channelCount).fill(-Infinity);
    this._peakHoldDecay = 20; // dB/s default
    this._peakHoldTime = Math.round(sampleRate * 2); // 2s hold
    this._peakHoldCounter = new Float64Array(channelCount);
    this._overCount = new Int32Array(channelCount);

    // IEC integrator
    this._iecIntegrator = new Float64Array(channelCount);

    // VU integrator
    this._vuIntegrator = new Float64Array(channelCount);

    // LUFS - K-weighting
    this._kWeightingState = [];
    this._kShelfStates = [];
    this._kHPStates = [];
    for (let ch = 0; ch < channelCount; ch++) {
      this._kWeightingState.push(new Float64Array(4)); // unused legacy slot
      this._kShelfStates.push(makeBiquadState());
      this._kHPStates.push(makeBiquadState());
    }
    this._initKWeighting();

    // LUFS ring buffers (100ms blocks)
    this._blockSize100ms = Math.round(sampleRate * 0.1);
    this._momentaryLen = 4; // 400ms = 4 * 100ms
    this._shortTermLen = 30; // 3s    = 30 * 100ms

    this._momentaryBuffer = [];
    this._shortTermBuffer = [];
    this._lufsBlockAccum = new Float64Array(channelCount);
    for (let ch = 0; ch < channelCount; ch++) {
      this._momentaryBuffer.push(new Float64Array(this._momentaryLen));
      this._shortTermBuffer.push(new Float64Array(this._shortTermLen));
    }
    this._lufsBlockSampleCount = 0;
    this._momentaryWriteIdx = 0;
    this._shortTermWriteIdx = 0;
    this._momentaryFilled = 0;
    this._shortTermFilled = 0;

    // Integrated loudness
    this._integratedSum = 0;
    this._integratedCount = 0;
    this._gatingBlocks = [];

    // True peak
    this._truePeakMax = 0;
    this._tpHistory = [];
    for (let ch = 0; ch < channelCount; ch++) {
      this._tpHistory.push(new Float64Array(TP_FIR_LEN));
    }
  }

  // ── K-weighting initialisation ──────────────────────────────────────

  private _initKWeighting(): void {
    this._kShelfCoeffs = designKWeightShelf(this._sampleRate);
    this._kHPCoeffs = designKWeightHP(this._sampleRate);
  }

  // ── IEC coefficient helpers ─────────────────────────────────────────

  /**
   * Compute a single-pole IIR coefficient from an integration time.
   * coeff = exp(-2.2 / (time * sampleRate))
   *
   * A coefficient of ~1 means very slow response (long integration);
   * a coefficient close to 0 means instantaneous tracking.
   */
  private _iecCoeff(timeSec: number): number {
    if (timeSec <= 0) return 0;
    return Math.exp(-2.2 / (timeSec * this._sampleRate));
  }

  /**
   * Return rise and fall coefficients for the current IEC type.
   */
  private _getIecCoeffs(): { rise: number; fall: number } {
    switch (this._type) {
      case MeterType.IEC1_DIN:
        // DIN standard: 1.7s rise, 1.7s fall
        return {
          rise: this._iecCoeff(1.7),
          fall: this._iecCoeff(1.7),
        };
      case MeterType.IEC1_NORDIC:
        // Nordic: ~5ms rise, 1.7s fall
        return {
          rise: this._iecCoeff(0.005),
          fall: this._iecCoeff(1.7),
        };
      case MeterType.IEC2_BBC:
        // BBC PPM: 10ms integration, 2.8s return
        return {
          rise: this._iecCoeff(0.01),
          fall: this._iecCoeff(2.8),
        };
      case MeterType.IEC2_EBU:
        // EBU: 10ms integration, 3.0s return (slightly slower fall)
        return {
          rise: this._iecCoeff(0.01),
          fall: this._iecCoeff(3.0),
        };
      default:
        return { rise: 0, fall: 0 };
    }
  }

  // ── Core Processing ─────────────────────────────────────────────────

  /**
   * Process a single channel of audio samples.
   */
  process(samples: Float32Array, channel: number): void {
    if (channel < 0 || channel >= this._channelCount) return;
    const n = samples.length;
    if (n === 0) return;

    // ---- Sample peak & RMS & over count ----------------------------
    let peak = 0;
    let sumSq = 0;
    let overs = 0;
    let consecutiveOver = 0;

    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
      sumSq += s * s;
      if (abs >= 1.0) {
        consecutiveOver++;
      } else {
        if (consecutiveOver > overs) overs = consecutiveOver;
        consecutiveOver = 0;
      }
    }
    if (consecutiveOver > overs) overs = consecutiveOver;

    const rmsLinear = Math.sqrt(sumSq / n);
    const peakDb = peak > 0 ? LOG10_20 * Math.log(peak) : NEG_INF;
    const rmsDb = rmsLinear > 0 ? LOG10_20 * Math.log(rmsLinear) : NEG_INF;

    this._peaks[channel] = peakDb;
    this._rms[channel] = rmsDb;
    this._overCount[channel] = overs;

    // ---- Peak hold -------------------------------------------------
    if (peakDb > this._peakHold[channel]) {
      this._peakHold[channel] = peakDb;
      this._peakHoldCounter[channel] = this._peakHoldTime;
    } else {
      if (this._peakHoldCounter[channel] > 0) {
        this._peakHoldCounter[channel] -= n;
      } else {
        // Decay
        const decayAmount = this._peakHoldDecay * (n / this._sampleRate);
        this._peakHold[channel] -= decayAmount;
        if (this._peakHold[channel] < NEG_INF) {
          this._peakHold[channel] = NEG_INF;
        }
      }
    }

    // ---- IEC integration -------------------------------------------
    if (
      this._type === MeterType.IEC1_DIN ||
      this._type === MeterType.IEC1_NORDIC ||
      this._type === MeterType.IEC2_BBC ||
      this._type === MeterType.IEC2_EBU
    ) {
      const { rise, fall } = this._getIecCoeffs();
      // IEC meters track the absolute value through a single-pole filter
      let integrator = this._iecIntegrator[channel];
      for (let i = 0; i < n; i++) {
        const abs = Math.abs(samples[i]);
        const coeff = abs > integrator ? rise : fall;
        integrator = (1 - coeff) * abs + coeff * integrator;
      }
      this._iecIntegrator[channel] = integrator;

      // Override peak with IEC-filtered value
      const iecDb = integrator > 0 ? LOG10_20 * Math.log(integrator) : NEG_INF;
      this._peaks[channel] = iecDb;
    }

    // ---- VU integration (300ms RMS) --------------------------------
    if (this._type === MeterType.VU) {
      // Single-pole IIR on the squared signal ≈ exponential RMS
      const vuCoeff = Math.exp(-2.2 / (0.3 * this._sampleRate));
      let vuInt = this._vuIntegrator[channel];
      for (let i = 0; i < n; i++) {
        const sq = samples[i] * samples[i];
        vuInt = (1 - vuCoeff) * sq + vuCoeff * vuInt;
      }
      this._vuIntegrator[channel] = vuInt;

      const vuRms = Math.sqrt(vuInt);
      // VU meter: overshoot on transients (~1.5%)
      // Modelled by letting peak slightly bleed into the RMS reading
      const vuLevel = vuRms + 0.015 * (peak - vuRms);
      const vuDb = vuLevel > 0 ? LOG10_20 * Math.log(vuLevel) : NEG_INF;
      this._rms[channel] = vuDb;
      this._peaks[channel] = vuDb; // VU uses unified reading
    }

    // ---- K-metering ------------------------------------------------
    if (
      this._type === MeterType.K_12 ||
      this._type === MeterType.K_14 ||
      this._type === MeterType.K_20
    ) {
      const ref = this.getKReference();
      // Offset the RMS reading by the K reference
      if (rmsDb > NEG_INF) {
        this._rms[channel] = rmsDb - ref;
      }
      if (peakDb > NEG_INF) {
        this._peaks[channel] = peakDb - ref;
      }
    }

    // ---- LUFS accumulation -----------------------------------------
    if (this._type === MeterType.LUFS) {
      this._processLufsChannel(samples, channel);
    }

    // ---- True peak -------------------------------------------------
    if (this._type === MeterType.TRUE_PEAK || this._type === MeterType.LUFS) {
      this._processTruePeak(samples, channel);
    }
  }

  /**
   * Process a multi-channel block at once.
   * buffer[ch] must contain at least blockSize samples.
   */
  processBlock(buffer: Float32Array[], blockSize: number): void {
    const numCh = Math.min(buffer.length, this._channelCount);
    for (let ch = 0; ch < numCh; ch++) {
      const data = buffer[ch];
      // Slice or use directly depending on length
      if (data.length === blockSize) {
        this.process(data, ch);
      } else {
        this.process(data.subarray(0, blockSize), ch);
      }
    }
  }

  // ── LUFS Processing (ITU-R BS.1770-4) ──────────────────────────────

  /**
   * Accumulate K-weighted power for one channel into the 100ms block
   * accumulator. When a full 100ms block is completed, push it into
   * the momentary and short-term ring buffers and perform gating.
   */
  private _processLufsChannel(samples: Float32Array, channel: number): void {
    const shelfC = this._kShelfCoeffs;
    const hpC = this._kHPCoeffs;
    const shelfS = this._kShelfStates[channel];
    const hpS = this._kHPStates[channel];

    let remaining = samples.length;
    let offset = 0;

    while (remaining > 0) {
      const spaceInBlock = this._blockSize100ms - this._lufsBlockSampleCount;
      const toProcess = Math.min(remaining, spaceInBlock);

      let sumSq = 0;
      for (let i = 0; i < toProcess; i++) {
        // K-weighting: high shelf then high-pass
        let s = samples[offset + i] as number;
        s = biquadProcess(shelfC, shelfS, s);
        s = biquadProcess(hpC, hpS, s);
        sumSq += s * s;
      }
      this._lufsBlockAccum[channel] += sumSq;

      offset += toProcess;
      remaining -= toProcess;

      // Only advance the block counter on channel 0 to keep channels in sync
      if (channel === 0) {
        this._lufsBlockSampleCount += toProcess;
      }

      // If this is the last channel and the block is full, commit
      if (
        channel === this._channelCount - 1 &&
        this._lufsBlockSampleCount >= this._blockSize100ms
      ) {
        this._commitLufsBlock();
      }
    }
  }

  /**
   * Commit a completed 100ms block into the ring buffers and perform gating.
   */
  private _commitLufsBlock(): void {
    const numCh = this._channelCount;

    // Write per-channel mean-square into ring buffers
    for (let ch = 0; ch < numCh; ch++) {
      const meanSq = this._lufsBlockAccum[ch] / this._blockSize100ms;
      this._momentaryBuffer[ch][this._momentaryWriteIdx] = meanSq;
      this._shortTermBuffer[ch][this._shortTermWriteIdx] = meanSq;
    }

    this._momentaryWriteIdx =
      (this._momentaryWriteIdx + 1) % this._momentaryLen;
    this._shortTermWriteIdx =
      (this._shortTermWriteIdx + 1) % this._shortTermLen;
    if (this._momentaryFilled < this._momentaryLen) this._momentaryFilled++;
    if (this._shortTermFilled < this._shortTermLen) this._shortTermFilled++;

    // Compute this block's loudness for gating
    let blockPower = 0;
    for (let ch = 0; ch < numCh; ch++) {
      const w = this._channelWeight(ch);
      blockPower += w * (this._lufsBlockAccum[ch] / this._blockSize100ms);
    }
    const blockLoudness =
      blockPower > 0 ? -0.691 + 10 * Math.log10(blockPower) : -Infinity;
    this._gatingBlocks.push(blockLoudness);

    // Reset accumulators
    this._lufsBlockAccum.fill(0);
    this._lufsBlockSampleCount = 0;
  }

  /**
   * ITU-R BS.1770 channel weighting.
   * Front channels = 1.0, surround channels (index >= 3) = 1.41 (~+1.5 dB).
   * For stereo (2 channels) everything is 1.0.
   */
  private _channelWeight(ch: number): number {
    if (this._channelCount <= 3) return 1.0;
    // For 5.1 layout: 0=L 1=R 2=C 3=Ls 4=Rs (5=LFE excluded)
    return ch >= 3 ? 1.41 : 1.0;
  }

  // ── True Peak (ITU-R BS.1770, 4x oversampling) ─────────────────────

  private _processTruePeak(samples: Float32Array, channel: number): void {
    const history = this._tpHistory[channel];
    let maxPeak = 0;

    for (let i = 0; i < samples.length; i++) {
      // Shift history buffer
      for (let t = TP_FIR_LEN - 1; t > 0; t--) {
        history[t] = history[t - 1];
      }
      history[0] = samples[i];

      // Evaluate 4 polyphase sub-filters
      for (let phase = 0; phase < 4; phase++) {
        const taps = TP_FIR_PHASES[phase];
        let sum = 0;
        for (let t = 0; t < TP_FIR_LEN; t++) {
          sum += history[t] * taps[t];
        }
        const abs = Math.abs(sum);
        if (abs > maxPeak) maxPeak = abs;
      }
    }

    if (maxPeak > this._truePeakMax) {
      this._truePeakMax = maxPeak;
    }
  }

  // ── Readings ────────────────────────────────────────────────────────

  getReading(channel: number): MeterReading {
    if (channel < 0 || channel >= this._channelCount) {
      return { peak: NEG_INF, rms: NEG_INF, peakHold: NEG_INF, overCount: 0 };
    }
    return {
      peak: this._peaks[channel],
      rms: this._rms[channel],
      peakHold: this._peakHold[channel],
      overCount: this._overCount[channel],
    };
  }

  getLUFSReading(): LUFSReading {
    const momentary = this._computeLufsWindow(
      this._momentaryBuffer,
      this._momentaryLen,
      this._momentaryFilled,
      this._momentaryWriteIdx,
    );
    const shortTerm = this._computeLufsWindow(
      this._shortTermBuffer,
      this._shortTermLen,
      this._shortTermFilled,
      this._shortTermWriteIdx,
    );
    const integrated = this._computeIntegratedLoudness();
    const range = this._computeLoudnessRange();
    const truePeak =
      this._truePeakMax > 0 ? LOG10_20 * Math.log(this._truePeakMax) : NEG_INF;

    return { momentary, shortTerm, integrated, range, truePeak };
  }

  getAllChannelReadings(): MeterReading[] {
    const readings: MeterReading[] = [];
    for (let ch = 0; ch < this._channelCount; ch++) {
      readings.push(this.getReading(ch));
    }
    return readings;
  }

  // ── LUFS computation helpers ────────────────────────────────────────

  /**
   * Compute the loudness of a sliding window from ring-buffer data.
   */
  private _computeLufsWindow(
    buffers: Float64Array[],
    windowLen: number,
    filled: number,
    writeIdx: number,
  ): number {
    if (filled === 0) return NEG_INF;
    const numBlocks = Math.min(filled, windowLen);
    let totalPower = 0;

    for (let ch = 0; ch < this._channelCount; ch++) {
      const w = this._channelWeight(ch);
      const buf = buffers[ch];
      let chSum = 0;

      for (let b = 0; b < numBlocks; b++) {
        const idx = (writeIdx - 1 - b + windowLen) % windowLen;
        chSum += buf[idx];
      }
      totalPower += w * (chSum / numBlocks);
    }

    return totalPower > 0 ? -0.691 + 10 * Math.log10(totalPower) : NEG_INF;
  }

  /**
   * ITU-R BS.1770-4 gated integrated loudness.
   * 1. Absolute gate at -70 LUFS
   * 2. Relative gate at -10 LU below the absolute-gated mean
   */
  private _computeIntegratedLoudness(): number {
    const blocks = this._gatingBlocks;
    if (blocks.length === 0) return NEG_INF;

    // Step 1: Absolute gate (-70 LUFS)
    const absThreshold = -70;
    let absGatedSum = 0;
    let absGatedCount = 0;

    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] > absThreshold) {
        absGatedSum += Math.pow(10, blocks[i] / 10);
        absGatedCount++;
      }
    }

    if (absGatedCount === 0) return NEG_INF;

    const absGatedMean = -0.691 + 10 * Math.log10(absGatedSum / absGatedCount);

    // Step 2: Relative gate (-10 LU below absolute-gated mean)
    const relThreshold = absGatedMean - 10;
    let relGatedSum = 0;
    let relGatedCount = 0;

    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] > relThreshold) {
        relGatedSum += Math.pow(10, blocks[i] / 10);
        relGatedCount++;
      }
    }

    if (relGatedCount === 0) return NEG_INF;

    return -0.691 + 10 * Math.log10(relGatedSum / relGatedCount);
  }

  /**
   * EBU R128 Loudness Range (LRA).
   * Computed as the difference between the 95th and 10th percentiles
   * of the short-term loudness distribution (after gating).
   */
  private _computeLoudnessRange(): number {
    if (this._gatingBlocks.length < 2) return 0;

    // We need short-term loudness values (3s window).
    // Approximate by using overlapping 30-block windows over the gating blocks.
    const stBlocks: number[] = [];
    const stLen = this._shortTermLen; // 30 blocks = 3s

    for (let i = stLen - 1; i < this._gatingBlocks.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = i - stLen + 1; j <= i; j++) {
        sum += Math.pow(10, this._gatingBlocks[j] / 10);
        count++;
      }
      const loudness =
        count > 0 ? -0.691 + 10 * Math.log10(sum / count) : NEG_INF;
      stBlocks.push(loudness);
    }

    if (stBlocks.length < 2) return 0;

    // Absolute gate at -70 LUFS
    const absGated = stBlocks.filter((l) => l > -70);
    if (absGated.length < 2) return 0;

    // Relative gate: mean of absolute-gated, then -20 LU
    let absSum = 0;
    for (const l of absGated) absSum += Math.pow(10, l / 10);
    const absMean = -0.691 + 10 * Math.log10(absSum / absGated.length);
    const relThreshold = absMean - 20;

    const relGated = absGated.filter((l) => l > relThreshold);
    if (relGated.length < 2) return 0;

    relGated.sort((a, b) => a - b);

    // 10th and 95th percentile
    const lo = relGated[Math.floor(relGated.length * 0.1)];
    const hi = relGated[Math.floor(relGated.length * 0.95)];

    return hi - lo;
  }

  // ── Reset ───────────────────────────────────────────────────────────

  reset(): void {
    this._peaks.fill(0);
    this._rms.fill(0);
    this._peakHold.fill(NEG_INF);
    this._peakHoldCounter.fill(0);
    this._overCount.fill(0);
    this._iecIntegrator.fill(0);
    this._vuIntegrator.fill(0);
    this._truePeakMax = 0;

    for (let ch = 0; ch < this._channelCount; ch++) {
      this._kShelfStates[ch] = makeBiquadState();
      this._kHPStates[ch] = makeBiquadState();
      this._momentaryBuffer[ch].fill(0);
      this._shortTermBuffer[ch].fill(0);
      this._lufsBlockAccum[ch] = 0;
      this._tpHistory[ch].fill(0);
    }

    this._lufsBlockSampleCount = 0;
    this._momentaryWriteIdx = 0;
    this._shortTermWriteIdx = 0;
    this._momentaryFilled = 0;
    this._shortTermFilled = 0;
    this._integratedSum = 0;
    this._integratedCount = 0;
    this._gatingBlocks = [];
  }

  resetPeakHold(): void {
    this._peakHold.fill(NEG_INF);
    this._peakHoldCounter.fill(0);
  }

  // ── Configuration ───────────────────────────────────────────────────

  setType(type: MeterType): void {
    if (this._type !== type) {
      this._type = type;
      this.reset();
    }
  }

  setPeakHoldTime(seconds: number): void {
    this._peakHoldTime = Math.round(this._sampleRate * Math.max(0, seconds));
  }

  setPeakHoldDecay(dbPerSecond: number): void {
    this._peakHoldDecay = Math.max(0, dbPerSecond);
  }

  // ── K-meter helpers ─────────────────────────────────────────────────

  /**
   * Returns the reference level offset (in dB) for the current K-type.
   * K-12 => -12, K-14 => -14, K-20 => -20.
   * Non-K types return 0.
   */
  getKReference(): number {
    switch (this._type) {
      case MeterType.K_12:
        return -12;
      case MeterType.K_14:
        return -14;
      case MeterType.K_20:
        return -20;
      default:
        return 0;
    }
  }

  // ── Static Utilities ────────────────────────────────────────────────

  static linearToDb(linear: number): number {
    return linear > 0 ? LOG10_20 * Math.log(linear) : NEG_INF;
  }

  static dbToLinear(db: number): number {
    if (db === NEG_INF) return 0;
    return Math.exp(db / LOG10_20);
  }

  /**
   * IEC 60268-10 scale mapping: converts a dB value to a 0-1 range
   * suitable for drawing meter graphics.
   *
   * The piecewise curve is defined by the standard breakpoints:
   *   -70 dB = 0.0
   *   -60 dB = 0.05
   *   -50 dB = 0.075
   *   -40 dB = 0.15
   *   -30 dB = 0.3
   *   -20 dB = 0.5
   *   -10 dB = 0.75
   *    -5 dB = 0.875
   *     0 dB = 1.0
   *
   * The meterType parameter is accepted for future per-type customisation
   * but currently all IEC types share the same display curve.
   */
  static iecScale(dbValue: number, _meterType: MeterType): number {
    if (dbValue < -70.0) return 0.0;
    if (dbValue > 0.0) return 1.0;

    // Breakpoints: [dB, displayValue]
    const bp: [number, number][] = [
      [-70, 0.0],
      [-60, 0.05],
      [-50, 0.075],
      [-40, 0.15],
      [-30, 0.3],
      [-20, 0.5],
      [-10, 0.75],
      [-5, 0.875],
      [0, 1.0],
    ];

    // Find the two surrounding breakpoints and linearly interpolate
    for (let i = 1; i < bp.length; i++) {
      if (dbValue <= bp[i][0]) {
        const [db0, v0] = bp[i - 1];
        const [db1, v1] = bp[i];
        const t = (dbValue - db0) / (db1 - db0);
        return v0 + t * (v1 - v0);
      }
    }

    return 1.0;
  }
}
