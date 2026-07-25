/**
 * Channel Splitter
 *
 * Splits N-channel audio into individual mono or stereo pairs.
 */

export interface SplitResult {
  /** Channel index (0-based) or "L"/"R" for stereo pairs */
  label: string;
  /** Mono audio data */
  data: Float32Array;
}

/**
 * Split a multi-channel AudioBuffer into individual mono channels.
 *
 * @param buffer Multi-channel audio buffer
 * @returns Array of mono channel data with labels
 */
export function splitToMono(buffer: AudioBuffer): SplitResult[] {
  const results: SplitResult[] = [];
  const numChannels = buffer.numberOfChannels;

  for (let ch = 0; ch < numChannels; ch++) {
    const data = new Float32Array(buffer.length);
    const source = buffer.getChannelData(ch);
    data.set(source);

    let label: string;
    if (numChannels === 1) {
      label = "Mono";
    } else if (numChannels === 2) {
      label = ch === 0 ? "L" : "R";
    } else {
      label = `Ch${ch + 1}`;
    }

    results.push({ label, data });
  }

  return results;
}

/**
 * Split a multi-channel buffer into stereo pairs.
 * Odd last channel becomes mono.
 *
 * @param buffer Multi-channel audio buffer
 * @returns Array of stereo pairs (or mono for odd last channel)
 */
export function splitToStereoPairs(
  buffer: AudioBuffer,
): { label: string; left: Float32Array; right?: Float32Array }[] {
  const results: { label: string; left: Float32Array; right?: Float32Array }[] =
    [];
  const numChannels = buffer.numberOfChannels;

  for (let ch = 0; ch < numChannels; ch += 2) {
    const left = new Float32Array(buffer.length);
    left.set(buffer.getChannelData(ch));

    if (ch + 1 < numChannels) {
      const right = new Float32Array(buffer.length);
      right.set(buffer.getChannelData(ch + 1));
      results.push({
        label: `Pair ${Math.floor(ch / 2) + 1}`,
        left,
        right,
      });
    } else {
      results.push({
        label: `Ch${ch + 1} (Mono)`,
        left,
      });
    }
  }

  return results;
}

/**
 * Create a mono buffer by mixing down all channels.
 * Uses equal-power downmix.
 */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const result = new Float32Array(length);

  const gain = 1 / Math.sqrt(numChannels); // Equal-power

  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      result[i] += data[i] * gain;
    }
  }

  return result;
}
