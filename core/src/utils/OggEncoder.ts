import { logger } from "./Logger";

/**
 * OGG Encoder — Real OGG Opus encoding via MediaRecorder API,
 * with PCM-in-OGG container fallback for environments without MediaRecorder.
 *
 * The browser's MediaRecorder with 'audio/ogg; codecs=opus' produces
 * valid OGG Opus files that can be played by all modern browsers and players.
 * Quality parameter maps to Opus bitrate (64-320 kbps).
 */
export class OggEncoder {
  /**
   * Encode AudioBuffer to OGG Blob.
   * Uses MediaRecorder (OGG Opus) when available, falls back to PCM container.
   *
   * @param buffer Audio data to encode
   * @param quality Quality 0.0-1.0, maps to Opus bitrate
   */
  public static async encode(
    buffer: AudioBuffer,
    quality: number = 0.5,
  ): Promise<Blob> {
    // Try real encoding first
    if (
      typeof MediaRecorder !== "undefined" &&
      typeof OfflineAudioContext !== "undefined"
    ) {
      try {
        return await this.encodeWithMediaRecorder(buffer, quality);
      } catch (e) {
        logger.warn(
          "OggEncoder",
          "MediaRecorder encoding failed, falling back to PCM:",
          e,
        );
      }
    }

    // Fallback: PCM-in-OGG container
    return this.encodePcmFallback(buffer, quality);
  }

  /**
   * Encode using MediaRecorder API with OGG Opus codec.
   * This produces real, valid OGG Opus files.
   */
  private static async encodeWithMediaRecorder(
    buffer: AudioBuffer,
    quality: number,
  ): Promise<Blob> {
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;

    // Map quality 0.0-1.0 to bitrate 64-320 kbps
    const bitrate = Math.round(64000 + quality * (320000 - 64000));

    // Create an OfflineAudioContext to render the buffer through a MediaStreamDestination
    // We need a real-time context for MediaRecorder
    const ctx = new AudioContext({ sampleRate });

    try {
      const destination = ctx.createMediaStreamDestination();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);

      // Check if OGG Opus is supported
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg; codecs=opus")
        ? "audio/ogg; codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg")
          ? "audio/ogg"
          : null;

      if (!mimeType) {
        throw new Error("OGG encoding not supported by MediaRecorder");
      }

      const recorder = new MediaRecorder(destination.stream, {
        mimeType,
        audioBitsPerSecond: bitrate,
      });

      const chunks: Blob[] = [];

      return new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = () => {
          ctx.close();
          const blob = new Blob(chunks, { type: "audio/ogg" });
          resolve(blob);
        };

        recorder.onerror = (e) => {
          ctx.close();
          reject(e);
        };

        recorder.start();
        source.start(0);

        // Stop after buffer duration + small padding
        const durationMs = (buffer.length / sampleRate) * 1000;
        setTimeout(() => {
          try {
            if (recorder.state === "recording") {
              recorder.stop();
            }
            // Stop all tracks on the stream
            destination.stream.getTracks().forEach((t) => t.stop());
          } catch {
            // ignore
          }
        }, durationMs + 100);
      });
    } catch (e) {
      ctx.close();
      throw e;
    }
  }

  /**
   * Fallback: PCM data in OGG container.
   * This is NOT valid OGG Vorbis/Opus, but provides basic container structure.
   */
  private static encodePcmFallback(buffer: AudioBuffer, quality: number): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const interleaved = this.interleave(buffer);
    const int16Data = this.float32ToInt16(interleaved);

    const pages: Uint8Array[] = [];
    const serialNumber = Math.floor(Math.random() * 0xffffffff);

    pages.push(
      this.buildIdHeader(numChannels, sampleRate, quality, serialNumber),
    );
    pages.push(this.buildCommentHeader(serialNumber));

    const pageSize = 4096;
    const bytesPerSample = 2 * numChannels;
    let granulePosition = 0;
    let pageSequence = 2;

    for (
      let offset = 0;
      offset < int16Data.byteLength;
      offset += pageSize * bytesPerSample
    ) {
      const remaining = int16Data.byteLength - offset;
      const chunkSize = Math.min(pageSize * bytesPerSample, remaining);
      const chunk = new Uint8Array(int16Data, offset, chunkSize);
      const samplesInPage = Math.floor(chunkSize / bytesPerSample);
      granulePosition += samplesInPage;

      const isLastPage = offset + chunkSize >= int16Data.byteLength;
      pages.push(
        this.buildDataPage(
          chunk,
          serialNumber,
          pageSequence++,
          granulePosition,
          isLastPage,
        ),
      );
    }

    // Use application/octet-stream since PCM fallback isn't valid OGG Vorbis
    return new Blob(pages as unknown as BlobPart[], {
      type: "application/octet-stream",
    });
  }

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

  private static float32ToInt16(buffer: Float32Array): ArrayBuffer {
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return result.buffer;
  }

  private static buildOggPage(
    headerType: number,
    granulePosition: number,
    serialNumber: number,
    pageSequence: number,
    data: Uint8Array,
  ): Uint8Array {
    const segments: number[] = [];
    let remaining = data.length;
    while (remaining >= 255) {
      segments.push(255);
      remaining -= 255;
    }
    segments.push(remaining);

    const headerSize = 27 + segments.length;
    const page = new Uint8Array(headerSize + data.length);
    const view = new DataView(page.buffer);

    page[0] = 0x4f;
    page[1] = 0x67;
    page[2] = 0x67;
    page[3] = 0x53; // "OggS"
    page[4] = 0;
    page[5] = headerType;
    view.setUint32(6, granulePosition & 0xffffffff, true);
    view.setUint32(
      10,
      Math.floor(granulePosition / 0x100000000) & 0xffffffff,
      true,
    );
    view.setUint32(14, serialNumber, true);
    view.setUint32(18, pageSequence, true);
    view.setUint32(22, 0, true);
    page[26] = segments.length;
    for (let i = 0; i < segments.length; i++) {
      page[27 + i] = segments[i];
    }
    page.set(data, headerSize);
    const crc = this.crc32(page);
    view.setUint32(22, crc, true);
    return page;
  }

  private static buildIdHeader(
    channels: number,
    sampleRate: number,
    quality: number,
    serialNumber: number,
  ): Uint8Array {
    const data = new Uint8Array(30);
    const view = new DataView(data.buffer);
    data[0] = 0x01;
    data[1] = 0x76;
    data[2] = 0x6f;
    data[3] = 0x72;
    data[4] = 0x62;
    data[5] = 0x69;
    data[6] = 0x73;
    view.setUint32(7, 0, true);
    data[11] = channels;
    view.setUint32(12, sampleRate, true);
    const nominalBitrate = Math.floor(64000 + quality * (320000 - 64000));
    view.setInt32(16, nominalBitrate, true);
    view.setInt32(20, nominalBitrate, true);
    view.setInt32(24, nominalBitrate, true);
    data[28] = 0x08;
    data[29] = 0x01;
    return this.buildOggPage(0x02, 0, serialNumber, 0, data);
  }

  private static buildCommentHeader(serialNumber: number): Uint8Array {
    const vendor = "daw-engine Web DAW";
    const vendorBytes = new TextEncoder().encode(vendor);
    const data = new Uint8Array(7 + 4 + vendorBytes.length + 4 + 1);
    const view = new DataView(data.buffer);
    data[0] = 0x03;
    data[1] = 0x76;
    data[2] = 0x6f;
    data[3] = 0x72;
    data[4] = 0x62;
    data[5] = 0x69;
    data[6] = 0x73;
    view.setUint32(7, vendorBytes.length, true);
    data.set(vendorBytes, 11);
    view.setUint32(11 + vendorBytes.length, 0, true);
    data[11 + vendorBytes.length + 4] = 0x01;
    return this.buildOggPage(0x00, 0, serialNumber, 1, data);
  }

  private static buildDataPage(
    audioData: Uint8Array,
    serialNumber: number,
    pageSequence: number,
    granulePosition: number,
    isLast: boolean,
  ): Uint8Array {
    const headerType = isLast ? 0x04 : 0x00;
    return this.buildOggPage(
      headerType,
      granulePosition,
      serialNumber,
      pageSequence,
      audioData,
    );
  }

  private static crcTable: Uint32Array | null = null;

  private static getCrcTable(): Uint32Array {
    if (this.crcTable) return this.crcTable;
    this.crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) {
        r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      }
      this.crcTable[i] = r >>> 0;
    }
    return this.crcTable;
  }

  private static crc32(data: Uint8Array): number {
    const table = this.getCrcTable();
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      crc = ((crc << 8) ^ table[((crc >>> 24) & 0xff) ^ data[i]]) >>> 0;
    }
    return crc;
  }
}
