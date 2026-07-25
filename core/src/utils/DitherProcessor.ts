/**
 * Dither Processor
 *
 * Applies TPDF (Triangular Probability Density Function) dithering
 * when converting from higher to lower bit depths.
 */
export enum DitherType {
  NONE = "none",
  TPDF = "tpdf", // Triangular PDF - standard for audio
  SHAPED = "shaped", // Noise-shaped dithering (psychoacoustic)
}

export class DitherProcessor {
  /**
   * Apply dithering to Float32 samples before quantization.
   * Should be called before converting to lower bit depth (e.g., float32 -> int16).
   *
   * @param samples Float32 audio data (modified in-place)
   * @param targetBits Target bit depth (16 or 24)
   * @param ditherType Type of dithering to apply
   */
  public static apply(
    samples: Float32Array,
    targetBits: number,
    ditherType: DitherType = DitherType.TPDF,
  ): void {
    if (ditherType === DitherType.NONE) return;

    const quantizationStep = 1.0 / Math.pow(2, targetBits - 1);

    if (ditherType === DitherType.TPDF) {
      this.applyTPDF(samples, quantizationStep);
    } else if (ditherType === DitherType.SHAPED) {
      this.applyShaped(samples, quantizationStep);
    }
  }

  /**
   * TPDF dithering: add triangular-distributed random noise at +-1 LSB
   * and quantize to the target bit depth in a single step.
   * This is the standard method used in professional audio mastering.
   *
   * The dither noise must be applied immediately before truncation to integer
   * to correctly decorrelate the quantization error. Adding dither without
   * quantizing would leave the samples in float space with no actual
   * bit-depth reduction.
   */
  private static applyTPDF(
    samples: Float32Array,
    quantizationStep: number,
  ): void {
    const scale = 1.0 / quantizationStep; // = 2^(targetBits-1)
    for (let i = 0; i < samples.length; i++) {
      // Two uniform random values subtracted to form triangular distribution
      const r1 = Math.random();
      const r2 = Math.random();
      const dither = (r1 - r2) * quantizationStep;

      // Add dither, quantize to target bit depth, then scale back to float range
      const quantized = Math.round((samples[i] + dither) * scale) / scale;
      samples[i] = quantized;
    }
  }

  /**
   * Noise-shaped dithering: error feedback filter for psychoacoustic masking.
   * Uses a simple first-order high-pass error feedback filter.
   * Like TPDF, dither is applied and quantization happens in a single step.
   */
  private static applyShaped(
    samples: Float32Array,
    quantizationStep: number,
  ): void {
    const scale = 1.0 / quantizationStep; // = 2^(targetBits-1)
    let previousError = 0;

    for (let i = 0; i < samples.length; i++) {
      // Add TPDF noise
      const r1 = Math.random();
      const r2 = Math.random();
      const dither = (r1 - r2) * quantizationStep;

      // Apply error feedback (high-pass noise shaping)
      const shaped = samples[i] + dither - previousError * 0.5;

      // Quantize to target bit depth
      const quantized = Math.round(shaped * scale) / scale;
      previousError = quantized - samples[i];

      samples[i] = quantized;
    }
  }
}
