/**
 * Sample Rate Converter
 *
 * Uses OfflineAudioContext for high-quality resampling.
 * Falls back to linear interpolation in non-browser environments.
 */

/**
 * Resample an AudioBuffer to a target sample rate.
 * Uses OfflineAudioContext (native resampler) when available.
 *
 * @param buffer Source audio buffer
 * @param targetSampleRate Desired sample rate
 * @returns Resampled AudioBuffer
 */
export async function resampleAudio(
  buffer: AudioBuffer,
  targetSampleRate: number,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetSampleRate) {
    return buffer; // No conversion needed
  }

  // Use OfflineAudioContext for native high-quality resampling
  if (typeof OfflineAudioContext !== "undefined") {
    return resampleWithOfflineContext(buffer, targetSampleRate);
  }

  // Fallback: linear interpolation
  return resampleLinear(buffer, targetSampleRate);
}

/**
 * Native resampling using OfflineAudioContext.
 */
async function resampleWithOfflineContext(
  buffer: AudioBuffer,
  targetSampleRate: number,
): Promise<AudioBuffer> {
  const ratio = targetSampleRate / buffer.sampleRate;
  const newLength = Math.ceil(buffer.length * ratio);

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    newLength,
    targetSampleRate,
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Linear interpolation resampling (fallback for non-browser environments).
 */
function resampleLinear(
  buffer: AudioBuffer,
  targetSampleRate: number,
): AudioBuffer {
  const ratio = buffer.sampleRate / targetSampleRate;
  const newLength = Math.ceil(buffer.length / ratio);
  const numChannels = buffer.numberOfChannels;

  // Create output channel data
  const outputChannels: Float32Array[] = [];

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcPos = i * ratio;
      const srcIdx = Math.floor(srcPos);
      const frac = srcPos - srcIdx;

      if (srcIdx + 1 < input.length) {
        output[i] = input[srcIdx] * (1 - frac) + input[srcIdx + 1] * frac;
      } else if (srcIdx < input.length) {
        output[i] = input[srcIdx];
      }
    }

    outputChannels.push(output);
  }

  // Return as a mock AudioBuffer-like object (for non-browser env)
  return {
    numberOfChannels: numChannels,
    length: newLength,
    sampleRate: targetSampleRate,
    duration: newLength / targetSampleRate,
    getChannelData(channel: number): Float32Array {
      return outputChannels[channel];
    },
    copyFromChannel() {},
    copyToChannel() {},
  } as unknown as AudioBuffer;
}

/**
 * Check if sample rate conversion is needed.
 */
export function needsResampling(
  sourceSampleRate: number,
  sessionSampleRate: number,
): boolean {
  return sourceSampleRate !== sessionSampleRate;
}
