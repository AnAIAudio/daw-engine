/**
 * Declick (DeclickAmp) - Provides smooth amplitude transitions
 * to avoid clicks/pops at record start/stop and region boundaries.
 */
export class DeclickAmp {
  private _targetGain: number = 1.0;
  private _currentGain: number = 0.0;
  private _sampleRate: number;
  private _rampLength: number; // samples for full ramp (default ~64 samples)
  private _rampIncrement: number;

  /**
   * @param sampleRate - The audio sample rate (e.g. 44100, 48000)
   * @param rampLengthMs - Duration of a full 0->1 or 1->0 ramp in ms. Defaults to ~1.5ms (~64 samples at 44100).
   */
  constructor(sampleRate: number, rampLengthMs?: number) {
    this._sampleRate = sampleRate;
    const ms = rampLengthMs ?? 1.5;
    this._rampLength = Math.max(1, Math.round((ms / 1000) * sampleRate));
    this._rampIncrement = 1.0 / this._rampLength;
  }

  /**
   * Set target gain (0 for fade out, 1 for fade in).
   */
  setTarget(gain: number): void {
    this._targetGain = Math.max(0, Math.min(1, gain));
  }

  /**
   * Apply declick ramp to a buffer in-place.
   * Uses linear ramping from _currentGain toward _targetGain.
   * @returns true if ramp is still in progress after processing
   */
  applyToBuffer(buffer: Float32Array, offset: number, count: number): boolean {
    const end = offset + count;
    const target = this._targetGain;
    let current = this._currentGain;
    const inc = this._rampIncrement;

    if (current === target) {
      // Already at target — apply constant gain
      if (target !== 1.0) {
        for (let i = offset; i < end; i++) {
          buffer[i] *= target;
        }
      }
      return false;
    }

    const goingUp = target > current;

    for (let i = offset; i < end; i++) {
      buffer[i] *= current;

      if (goingUp) {
        current = Math.min(current + inc, target);
      } else {
        current = Math.max(current - inc, target);
      }
    }

    this._currentGain = current;
    return current !== target;
  }

  /**
   * Apply declick ramp to multi-channel buffers in-place.
   * All channels share the same gain trajectory.
   * @returns true if ramp is still in progress after processing
   */
  applyToBuffers(
    buffers: Float32Array[],
    offset: number,
    count: number,
  ): boolean {
    const end = offset + count;
    const target = this._targetGain;
    let current = this._currentGain;
    const inc = this._rampIncrement;
    const numChannels = buffers.length;

    if (current === target) {
      // Already at target — apply constant gain
      if (target !== 1.0) {
        for (let ch = 0; ch < numChannels; ch++) {
          const buf = buffers[ch];
          for (let i = offset; i < end; i++) {
            buf[i] *= target;
          }
        }
      }
      return false;
    }

    const goingUp = target > current;

    for (let i = offset; i < end; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        buffers[ch][i] *= current;
      }

      if (goingUp) {
        current = Math.min(current + inc, target);
      } else {
        current = Math.max(current - inc, target);
      }
    }

    this._currentGain = current;
    return current !== target;
  }

  /**
   * Check if currently ramping (current gain has not yet reached target).
   */
  isRamping(): boolean {
    return this._currentGain !== this._targetGain;
  }

  /**
   * Reset to initial state.
   * @param initialGain - Starting gain value (default 0.0)
   */
  reset(initialGain?: number): void {
    this._currentGain = initialGain ?? 0.0;
    this._targetGain = 1.0;
  }

  /**
   * Get current gain value.
   */
  getCurrentGain(): number {
    return this._currentGain;
  }
}

/**
 * Declicker - Provides crossfade curves for loop boundaries.
 * Used to create smooth transitions at loop points.
 * Uses raised cosine (Hann) curves for perceptually smooth fades.
 */
export class Declicker {
  private _fadeIn: Float32Array;
  private _fadeOut: Float32Array;
  private _length: number;

  /**
   * @param lengthSamples - Number of samples for the fade region
   */
  constructor(lengthSamples: number) {
    this._length = Math.max(1, lengthSamples);
    this._fadeIn = new Float32Array(this._length);
    this._fadeOut = new Float32Array(this._length);
    this.computeCurves();
  }

  /**
   * Pre-compute fade curves using a raised cosine (Hann window).
   * fade_in[i]  = 0.5 * (1 - cos(pi * i / (N-1)))
   * fade_out[i] = 0.5 * (1 + cos(pi * i / (N-1)))
   * This ensures fade_in + fade_out = 1.0 at every sample (constant power crossfade).
   */
  computeCurves(): void {
    const N = this._length;
    if (N === 1) {
      this._fadeIn[0] = 1.0;
      this._fadeOut[0] = 1.0;
      return;
    }

    const divisor = N - 1;
    for (let i = 0; i < N; i++) {
      const cosVal = Math.cos((Math.PI * i) / divisor);
      this._fadeIn[i] = 0.5 * (1 - cosVal);
      this._fadeOut[i] = 0.5 * (1 + cosVal);
    }
  }

  /**
   * Apply fade-in curve to the start of a buffer.
   * @param buffer - The audio buffer to modify in-place
   * @param offset - Optional offset into the buffer (default 0)
   */
  applyFadeIn(buffer: Float32Array, offset: number = 0): void {
    const len = Math.min(this._length, buffer.length - offset);
    for (let i = 0; i < len; i++) {
      buffer[offset + i] *= this._fadeIn[i];
    }
  }

  /**
   * Apply fade-out curve to the end of a buffer.
   * @param offset - Optional: the sample index where the fade-out begins.
   *                 Defaults to buffer.length - fadeLength.
   */
  applyFadeOut(buffer: Float32Array, offset?: number): void {
    const start = offset ?? buffer.length - this._length;
    const len = Math.min(this._length, buffer.length - Math.max(0, start));
    for (let i = 0; i < len; i++) {
      buffer[Math.max(0, start) + i] *= this._fadeOut[i];
    }
  }

  /**
   * Apply crossfade between two buffers, writing result into output.
   * output[i] = outgoing[i] * fadeOut[i] + incoming[i] * fadeIn[i]
   * All three buffers must be at least _length samples long.
   */
  applyCrossfade(
    outgoing: Float32Array,
    incoming: Float32Array,
    output: Float32Array,
  ): void {
    const len = Math.min(
      this._length,
      outgoing.length,
      incoming.length,
      output.length,
    );
    for (let i = 0; i < len; i++) {
      output[i] =
        outgoing[i] * this._fadeOut[i] + incoming[i] * this._fadeIn[i];
    }
  }

  /**
   * Get the pre-computed fade-in curve.
   */
  getFadeIn(): Float32Array {
    return this._fadeIn;
  }

  /**
   * Get the pre-computed fade-out curve.
   */
  getFadeOut(): Float32Array {
    return this._fadeOut;
  }

  /**
   * Get the length of the fade region in samples.
   */
  getLength(): number {
    return this._length;
  }
}
