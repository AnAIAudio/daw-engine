/**
 * LatencyCompensator
 *
 * A per-channel ring-buffer delay line used to time-align audio routes.
 * When one route has higher processing latency than another, the lower-
 * latency route gets a LatencyCompensator inserted with the appropriate
 * delay so that both routes arrive at the summing point in phase.
 */
export class LatencyCompensator {
  private _delaySamples: number = 0;
  private _buffer: Float32Array[]; // per-channel ring buffers
  private _writePos: number = 0;
  private _channels: number;
  private _maxDelay: number;

  constructor(channels: number = 2, maxDelay: number = 8192) {
    this._channels = channels;
    this._maxDelay = maxDelay;

    // Allocate one ring buffer per channel.
    this._buffer = [];
    for (let ch = 0; ch < channels; ch++) {
      this._buffer.push(new Float32Array(maxDelay));
    }
  }

  /** Current delay in samples. */
  get delaySamples(): number {
    return this._delaySamples;
  }

  /**
   * Set the compensation delay.
   * @param samples Delay in samples (clamped to 0 .. maxDelay - 1).
   */
  setDelay(samples: number): void {
    this._delaySamples = Math.max(0, Math.min(samples, this._maxDelay - 1));
  }

  /**
   * Process a block of audio through the delay buffer.
   *
   * For each sample in the block the method writes the input into the ring
   * buffer at `_writePos` and reads the output from `_writePos - delay`
   * (wrapped).  This introduces an exact `_delaySamples` latency.
   *
   * If `_delaySamples` is 0 the input is copied directly to the output
   * with no ring-buffer overhead.
   *
   * @param input  Per-channel input arrays (length >= blockSize each).
   * @param output Per-channel output arrays (length >= blockSize each).
   *               May alias the same arrays as `input`.
   * @param blockSize Number of samples to process.
   */
  process(
    input: Float32Array[],
    output: Float32Array[],
    blockSize: number,
  ): void {
    const delay = this._delaySamples;

    // Fast path: no delay — straight copy.
    if (delay === 0) {
      for (let ch = 0; ch < this._channels; ch++) {
        if (input[ch] !== output[ch]) {
          output[ch].set(input[ch].subarray(0, blockSize));
        }
      }
      return;
    }

    const maxDelay = this._maxDelay;

    for (let i = 0; i < blockSize; i++) {
      const wp = this._writePos;
      // Read position: wrap around if negative.
      let rp = wp - delay;
      if (rp < 0) rp += maxDelay;

      for (let ch = 0; ch < this._channels; ch++) {
        this._buffer[ch][wp] = input[ch][i];
        output[ch][i] = this._buffer[ch][rp];
      }

      this._writePos = (wp + 1) % maxDelay;
    }
  }

  /**
   * Reset all ring buffers to silence and rewind the write pointer.
   * Call after a transport locate or when the delay amount changes to
   * avoid stale audio leaking through.
   */
  reset(): void {
    this._writePos = 0;
    for (let ch = 0; ch < this._channels; ch++) {
      this._buffer[ch].fill(0);
    }
  }
}
