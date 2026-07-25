/**
 * Silence Padding & Trimming
 *
 * Adds or removes silence at the start/end of audio buffers.
 */

/**
 * Add silence padding to start and/or end of audio data.
 *
 * @param channelData Array of channel data (modified in place via return)
 * @param startFrames Number of silence frames to prepend
 * @param endFrames Number of silence frames to append
 * @returns New channel data arrays with padding
 */
export function addSilencePadding(
  channelData: Float32Array[],
  startFrames: number,
  endFrames: number,
): Float32Array[] {
  if (startFrames <= 0 && endFrames <= 0) {
    return channelData;
  }

  const originalLength = channelData[0].length;
  const newLength = startFrames + originalLength + endFrames;

  return channelData.map((data) => {
    const result = new Float32Array(newLength);
    // Copy original data after start padding
    result.set(data, startFrames);
    return result;
  });
}

/**
 * Trim silence from start and/or end of audio data.
 *
 * @param channelData Array of channel data
 * @param threshold Amplitude threshold below which is considered silence (default: 0.001)
 * @returns Trimmed channel data and the number of frames trimmed from each end
 */
export function trimSilence(
  channelData: Float32Array[],
  threshold: number = 0.001,
): { data: Float32Array[]; trimmedStart: number; trimmedEnd: number } {
  if (channelData.length === 0 || channelData[0].length === 0) {
    return { data: channelData, trimmedStart: 0, trimmedEnd: 0 };
  }

  const length = channelData[0].length;

  // Find first non-silent sample (across all channels)
  let startIdx = 0;
  for (let i = 0; i < length; i++) {
    let isSilent = true;
    for (const data of channelData) {
      if (Math.abs(data[i]) > threshold) {
        isSilent = false;
        break;
      }
    }
    if (!isSilent) {
      startIdx = i;
      break;
    }
    if (i === length - 1) {
      // Entire buffer is silence
      return {
        data: channelData.map(() => new Float32Array(0)),
        trimmedStart: length,
        trimmedEnd: 0,
      };
    }
  }

  // Find last non-silent sample
  let endIdx = length - 1;
  for (let i = length - 1; i >= startIdx; i--) {
    let isSilent = true;
    for (const data of channelData) {
      if (Math.abs(data[i]) > threshold) {
        isSilent = false;
        break;
      }
    }
    if (!isSilent) {
      endIdx = i;
      break;
    }
  }

  const trimmedLength = endIdx - startIdx + 1;

  return {
    data: channelData.map((data) => data.slice(startIdx, endIdx + 1)),
    trimmedStart: startIdx,
    trimmedEnd: length - endIdx - 1,
  };
}
