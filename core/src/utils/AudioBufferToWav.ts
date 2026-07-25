export class AudioBufferToWav {
  /**
   * Encode to WAV format
   * Reference: https://gist.github.com/meziantou/edb7217fddfbb70e899e
   */
  public static encode(
    buffer: AudioBuffer,
    format: "int16" | "int24" | "float32" = "float32",
  ): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;

    // Interleave channels
    const interleaved = this.interleave(buffer);

    // Convert to target format
    let samples: ArrayBuffer;
    let bitsPerSample: number;

    switch (format) {
      case "int16":
        samples = this.float32ToInt16(interleaved);
        bitsPerSample = 16;
        break;
      case "int24":
        samples = this.float32ToInt24(interleaved);
        bitsPerSample = 24;
        break;
      case "float32":
      default:
        samples = interleaved.buffer as ArrayBuffer;
        bitsPerSample = 32;
        break;
    }

    // Create WAV header
    const dataSize = samples.byteLength;
    const header = this.createWAVHeader(
      numChannels,
      sampleRate,
      bitsPerSample,
      dataSize,
    );

    // Combine header and data
    return new Blob([header, samples], { type: "audio/wav" });
  }

  /**
   * Interleave multi-channel audio buffer
   */
  private static interleave(buffer: AudioBuffer): Float32Array {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length * numChannels;
    const result = new Float32Array(length);

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < buffer.length; i++) {
        result[i * numChannels + ch] = channelData[i];
      }
    }

    return result;
  }

  /**
   * Convert Float32 to Int16
   */
  private static float32ToInt16(buffer: Float32Array): ArrayBuffer {
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return result.buffer;
  }

  /**
   * Convert Float32 to Int24 (stored as 3 bytes per sample)
   */
  private static float32ToInt24(buffer: Float32Array): ArrayBuffer {
    const result = new Uint8Array(buffer.length * 3);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      const val = Math.floor(s < 0 ? s * 0x800000 : s * 0x7fffff);
      result[i * 3 + 0] = (val >> 0) & 0xff;
      result[i * 3 + 1] = (val >> 8) & 0xff;
      result[i * 3 + 2] = (val >> 16) & 0xff;
    }
    return result.buffer;
  }

  /**
   * Create WAV file header
   */
  private static createWAVHeader(
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number,
    dataSize: number,
  ): ArrayBuffer {
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    // RIFF chunk descriptor
    this.writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, "WAVE");

    // fmt sub-chunk
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // subchunk1 size (16 for PCM)
    view.setUint16(20, bitsPerSample === 32 ? 3 : 1, true); // audio format (1=PCM, 3=IEEE float)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    this.writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    return header;
  }

  /**
   * Write string to DataView
   */
  private static writeString(
    view: DataView,
    offset: number,
    string: string,
  ): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
