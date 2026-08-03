import type { PeakData } from "@daw-engine/core";

/**
 * Compute peak data from a raw `Float32Array` of audio samples.
 *
 * This produces one min/max/rms entry per `resolution` frames, suitable for
 * waveform rendering at the matching zoom level.
 *
 * @param channelData  Raw PCM samples for a single channel.
 * @param resolution   Number of source frames per peak entry.
 * @returns            PeakData compatible with `Source.setPeakData()`.
 *
 * ```ts
 * const data = audioBuffer.getChannelData(0);
 * const peaks = computePeaksFromSamples(data, 512);
 * source.setPeakData(512, peaks);
 * ```
 */
export function computePeaksFromSamples(
  channelData: Float32Array,
  resolution: number,
): PeakData {
  const length = Math.ceil(channelData.length / resolution);
  const min = new Float32Array(length);
  const max = new Float32Array(length);
  const rms = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const start = i * resolution;
    const end = Math.min(start + resolution, channelData.length);

    let lo = Infinity;
    let hi = -Infinity;
    let sumSq = 0;

    for (let j = start; j < end; j++) {
      const v = channelData[j];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sumSq += v * v;
    }

    const count = end - start;
    min[i] = lo === Infinity ? 0 : lo;
    max[i] = hi === -Infinity ? 0 : hi;
    rms[i] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  return { min, max, rms, length, resolution };
}

/**
 * Compute peak data from an `AudioBuffer`.
 *
 * Processes channel 0 by default. For stereo, call twice with different
 * channel indices and store separately.
 *
 * @param audioBuffer  Decoded Web Audio buffer.
 * @param resolution   Number of source frames per peak entry.
 * @param channel      Channel index (default 0).
 */
export function computePeaks(
  audioBuffer: AudioBuffer,
  resolution: number,
  channel: number = 0,
): PeakData {
  return computePeaksFromSamples(
    audioBuffer.getChannelData(channel),
    resolution,
  );
}

/**
 * Choose an appropriate peak resolution for a given zoom level.
 *
 * The idea: each peak entry should map to roughly 1 pixel. Since
 * `framesPerPixel = sampleRate / pixelsPerSecond`, we pick the nearest
 * power-of-two resolution that is ≤ framesPerPixel so we never render
 * more than 1 peak per pixel.
 *
 * @param framesPerPixel  Current `sampleRate / pixelsPerSecond`.
 * @returns               Recommended resolution (power of two, minimum 64).
 */
export function recommendResolution(framesPerPixel: number): number {
  const MIN_RESOLUTION = 64;
  if (framesPerPixel <= MIN_RESOLUTION) return MIN_RESOLUTION;
  // Largest power of two ≤ framesPerPixel
  return 1 << Math.floor(Math.log2(framesPerPixel));
}
