import { Signal } from "../../lib/Signal";
import { SidechainConfig } from "../../domain/SidechainConfig";
import { TrackId } from "../../domain/types";

/**
 * SidechainRouter manages the actual audio signal routing for sidechain connections.
 *
 * In the Web Audio context, sidechain routing works by:
 * 1. Tapping the source track's audio output (pre or post fader)
 * 2. Optionally applying a high-pass filter
 * 3. Feeding it into the target processor's sidechain input
 *
 * The router maintains a buffer-per-config that holds the latest audio block
 * from the source track, available for the target processor to read.
 */
export class SidechainRouter {
  private _configs: Map<string, SidechainConfig> = new Map();

  /** Buffer storage: configId -> latest audio block from source */
  private _sidechainBuffers: Map<string, SidechainBuffer> = new Map();

  /** HPF filter state per config (one state per channel, keyed by configId) */
  private _filterStates: Map<string, BiquadFilterState[]> = new Map();

  /** Sample rate used for HPF coefficient computation */
  private _sampleRate: number;

  public readonly routingChanged = new Signal<void>();

  /**
   * @param sampleRate - The audio sample rate (e.g. 44100, 48000)
   */
  constructor(sampleRate: number = 44100) {
    this._sampleRate = sampleRate;
  }

  // ─── Configuration Management ──────────────────────────────────────────────

  /**
   * Register a sidechain configuration.
   * Initialises the buffer and filter state for the new config.
   */
  addConfig(config: SidechainConfig): void {
    this._configs.set(config.id, config);

    // Initialise an empty buffer
    this._sidechainBuffers.set(config.id, {
      data: [],
      blockSize: 0,
      valid: false,
    });

    // Initialise filter states (start with 2 channels; will resize as needed)
    this._rebuildFilterState(config);

    // Listen for filter parameter changes so we can recompute coefficients
    config.filterChanged.connect(() => {
      this._rebuildFilterState(config);
    });

    this.routingChanged.emit();
  }

  /**
   * Remove a sidechain configuration and clean up its resources.
   */
  removeConfig(configId: string): void {
    if (!this._configs.has(configId)) {
      return;
    }
    this._configs.delete(configId);
    this._sidechainBuffers.delete(configId);
    this._filterStates.delete(configId);
    this.routingChanged.emit();
  }

  /**
   * Get config by ID.
   */
  getConfig(configId: string): SidechainConfig | undefined {
    return this._configs.get(configId);
  }

  /**
   * Get all configs targeting a specific track.
   */
  getConfigsForTarget(trackId: TrackId): SidechainConfig[] {
    const result: SidechainConfig[] = [];
    for (const config of this._configs.values()) {
      if (config.targetTrackId === trackId) {
        result.push(config);
      }
    }
    return result;
  }

  /**
   * Get all configs sourcing from a specific track.
   */
  getConfigsForSource(trackId: TrackId): SidechainConfig[] {
    const result: SidechainConfig[] = [];
    for (const config of this._configs.values()) {
      if (config.sourceTrackId === trackId) {
        result.push(config);
      }
    }
    return result;
  }

  // ─── Audio Routing ─────────────────────────────────────────────────────────

  /**
   * Called by the audio engine when a source track produces audio.
   * Stores the audio block for later retrieval by target processors.
   *
   * For every config that sources from the given trackId, we copy the
   * audio data into the config's sidechain buffer.
   *
   * @param trackId - The source track that just produced audio
   * @param audioData - Per-channel audio data (e.g. [leftChannel, rightChannel])
   * @param blockSize - Number of samples per channel in this block
   */
  feedSourceAudio(
    trackId: TrackId,
    audioData: Float32Array[],
    blockSize: number,
  ): void {
    for (const config of this._configs.values()) {
      if (config.sourceTrackId !== trackId || !config.enabled) {
        continue;
      }

      const numChannels = audioData.length;
      let buffer = this._sidechainBuffers.get(config.id);

      // Allocate or resize the buffer if needed
      if (
        !buffer ||
        buffer.data.length !== numChannels ||
        buffer.blockSize !== blockSize
      ) {
        buffer = {
          data: new Array(numChannels)
            .fill(null)
            .map(() => new Float32Array(blockSize)),
          blockSize,
          valid: false,
        };
        this._sidechainBuffers.set(config.id, buffer);
      }

      // Copy source audio into the sidechain buffer
      for (let ch = 0; ch < numChannels; ch++) {
        buffer.data[ch].set(audioData[ch].subarray(0, blockSize));
      }
      buffer.valid = true;
    }
  }

  /**
   * Called by the target processor to get the sidechain input.
   * Returns the latest audio block from the source track (with optional HPF applied),
   * or null if no valid data is available.
   *
   * @param configId - The sidechain configuration ID
   * @returns Per-channel audio data, or null if unavailable
   */
  getSidechainInput(configId: string): Float32Array[] | null {
    const config = this._configs.get(configId);
    if (!config || !config.enabled) {
      return null;
    }

    const buffer = this._sidechainBuffers.get(configId);
    if (!buffer || !buffer.valid || buffer.data.length === 0) {
      return null;
    }

    // If HPF is enabled, apply it to a copy of the buffer
    if (config.sidechainFilterEnabled) {
      return this._applyHPF(configId, buffer.data);
    }

    // Return copies so the caller can't mutate our internal buffers
    return buffer.data.map((ch) => new Float32Array(ch));
  }

  // ─── HPF (High-Pass Filter) ────────────────────────────────────────────────

  /**
   * Apply a 2nd-order Butterworth high-pass filter to the sidechain signal.
   * Processes in-place on copies of the input channels.
   *
   * The Butterworth HPF transfer function is implemented as a Direct Form I
   * biquad filter: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
   */
  private _applyHPF(
    configId: string,
    inputChannels: Float32Array[],
  ): Float32Array[] {
    const numChannels = inputChannels.length;
    let states = this._filterStates.get(configId);

    // Ensure we have a filter state per channel
    if (!states || states.length !== numChannels) {
      const config = this._configs.get(configId);
      if (!config) {
        return inputChannels.map((ch) => new Float32Array(ch));
      }
      states = new Array(numChannels)
        .fill(null)
        .map(() =>
          computeHPFCoefficients(
            config.sidechainFilterFrequency,
            this._sampleRate,
          ),
        );
      this._filterStates.set(configId, states);
    }

    const output: Float32Array[] = [];

    for (let ch = 0; ch < numChannels; ch++) {
      const input = inputChannels[ch];
      const out = new Float32Array(input.length);
      const state = states[ch];

      for (let i = 0; i < input.length; i++) {
        const x = input[i];

        // Direct Form I biquad
        const y =
          state.b0 * x +
          state.b1 * state.x1 +
          state.b2 * state.x2 -
          state.a1 * state.y1 -
          state.a2 * state.y2;

        // Shift delay line
        state.x2 = state.x1;
        state.x1 = x;
        state.y2 = state.y1;
        state.y1 = y;

        out[i] = y;
      }

      output.push(out);
    }

    return output;
  }

  /**
   * Rebuild the filter state for a given config.
   * Called when the config is added or its filter parameters change.
   */
  private _rebuildFilterState(config: SidechainConfig): void {
    const buffer = this._sidechainBuffers.get(config.id);
    const numChannels = buffer ? Math.max(buffer.data.length, 2) : 2;

    const states = new Array(numChannels)
      .fill(null)
      .map(() =>
        computeHPFCoefficients(
          config.sidechainFilterFrequency,
          this._sampleRate,
        ),
      );

    this._filterStates.set(config.id, states);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Reset all buffers and filter states.
   * Typically called when transport stops or seeks.
   */
  reset(): void {
    for (const [configId, buffer] of this._sidechainBuffers.entries()) {
      for (const ch of buffer.data) {
        ch.fill(0);
      }
      buffer.valid = false;

      // Reset filter delay lines while preserving coefficients
      const states = this._filterStates.get(configId);
      if (states) {
        for (const state of states) {
          state.x1 = 0;
          state.x2 = 0;
          state.y1 = 0;
          state.y2 = 0;
        }
      }
    }
  }

  /**
   * Update the sample rate. Recomputes all HPF filter coefficients.
   */
  setSampleRate(sampleRate: number): void {
    this._sampleRate = sampleRate;
    for (const config of this._configs.values()) {
      this._rebuildFilterState(config);
    }
  }
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

/** Simple buffer to hold a single block of audio per sidechain connection. */
interface SidechainBuffer {
  /** Per-channel audio data */
  data: Float32Array[];
  /** Number of samples per channel */
  blockSize: number;
  /** Whether this buffer contains valid audio from the current processing cycle */
  valid: boolean;
}

/**
 * Biquad HPF state for the sidechain filter (Direct Form I).
 * Stores both the filter coefficients and the delay-line state.
 */
interface BiquadFilterState {
  /** Input delay line */
  x1: number;
  x2: number;
  /** Output delay line */
  y1: number;
  y2: number;
  /** Numerator (feedforward) coefficients */
  b0: number;
  b1: number;
  b2: number;
  /** Denominator (feedback) coefficients (negated convention: y = ... - a1*y1 - a2*y2) */
  a1: number;
  a2: number;
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Compute the biquad filter coefficients for a 2nd-order Butterworth high-pass filter.
 *
 * Derivation from the analogue Butterworth prototype:
 *   H(s) = s^2 / (s^2 + sqrt(2)*s + 1)
 *
 * Bilinear transform with pre-warping:
 *   omega_c = 2 * pi * frequency / sampleRate
 *   K = tan(omega_c / 2)
 *   norm = 1 / (1 + sqrt(2)*K + K^2)
 *
 *   b0 = norm
 *   b1 = -2 * norm
 *   b2 = norm
 *   a1 = 2 * (K^2 - 1) * norm
 *   a2 = (1 - sqrt(2)*K + K^2) * norm
 *
 * The returned state has zeroed delay lines, ready for immediate use.
 *
 * @param frequency - HPF cutoff frequency in Hz
 * @param sampleRate - Audio sample rate in Hz
 * @returns A BiquadFilterState with computed coefficients and zeroed state
 */
export function computeHPFCoefficients(
  frequency: number,
  sampleRate: number,
): BiquadFilterState {
  // Clamp frequency to a safe range: above 0 and below Nyquist
  const nyquist = sampleRate / 2;
  const freq = Math.max(1, Math.min(frequency, nyquist * 0.99));

  const omega = (2 * Math.PI * freq) / sampleRate;
  const K = Math.tan(omega / 2);
  const K2 = K * K;
  const sqrt2 = Math.SQRT2;

  const norm = 1 / (1 + sqrt2 * K + K2);

  return {
    // Delay line state (zeroed)
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
    // Coefficients
    b0: norm,
    b1: -2 * norm,
    b2: norm,
    a1: 2 * (K2 - 1) * norm,
    a2: (1 - sqrt2 * K + K2) * norm,
  };
}
