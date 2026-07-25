/**
 * FLAC Encoder (Lossless)
 *
 * Pure JS FLAC encoder with basic compression.
 * Implements a subset of the FLAC specification (verbatim frames for simplicity).
 */
export class FlacEncoder {
  /**
   * Encode AudioBuffer to FLAC Blob.
   * @param buffer Audio data
   * @param bitsPerSample 16 or 24
   */
  public static encode(buffer: AudioBuffer, bitsPerSample: number = 16): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const totalSamples = buffer.length;

    const parts: Uint8Array[] = [];

    // 1. FLAC marker
    parts.push(new Uint8Array([0x66, 0x4c, 0x61, 0x43])); // "fLaC"

    // 2. STREAMINFO metadata block
    parts.push(
      this.buildStreamInfo(
        numChannels,
        sampleRate,
        bitsPerSample,
        totalSamples,
        buffer,
      ),
    );

    // 3. Audio frames (verbatim encoding - uncompressed but valid FLAC)
    const blockSize = 4096;
    for (let offset = 0; offset < totalSamples; offset += blockSize) {
      const currentBlockSize = Math.min(blockSize, totalSamples - offset);
      parts.push(
        this.buildFrame(
          buffer,
          offset,
          currentBlockSize,
          numChannels,
          bitsPerSample,
          sampleRate,
          offset / blockSize,
        ),
      );
    }

    return new Blob(parts as unknown as BlobPart[], { type: "audio/flac" });
  }

  private static buildStreamInfo(
    channels: number,
    sampleRate: number,
    bitsPerSample: number,
    totalSamples: number,
    _buffer: AudioBuffer,
  ): Uint8Array {
    // METADATA_BLOCK_HEADER (4 bytes) + STREAMINFO (34 bytes)
    const data = new Uint8Array(4 + 34);
    const view = new DataView(data.buffer);

    // Header: last-metadata-block=1, type=0 (STREAMINFO), length=34
    data[0] = 0x80; // last block flag + type 0
    data[1] = 0x00;
    data[2] = 0x00;
    data[3] = 34;

    const blockSize = 4096;
    // Min/Max block size
    view.setUint16(4, blockSize, false);
    view.setUint16(6, blockSize, false);

    // Min/Max frame size (0 = unknown)
    data[8] = 0;
    data[9] = 0;
    data[10] = 0;
    data[11] = 0;
    data[12] = 0;
    data[13] = 0;

    // Sample rate (20 bits) | channels-1 (3 bits) | bits-per-sample-1 (5 bits) | total samples (36 bits)
    const srChannelsBps =
      ((sampleRate & 0xfffff) << 12) |
      (((channels - 1) & 0x7) << 9) |
      (((bitsPerSample - 1) & 0x1f) << 4) |
      ((totalSamples >>> 32) & 0xf);

    view.setUint32(14, srChannelsBps, false);
    view.setUint32(18, totalSamples & 0xffffffff, false);

    // MD5 signature (16 bytes) - simplified, zeros
    // In production, compute actual MD5 of decoded audio
    for (let i = 22; i < 38; i++) {
      data[i] = 0;
    }

    return data;
  }

  private static buildFrame(
    buffer: AudioBuffer,
    offset: number,
    blockSize: number,
    channels: number,
    bitsPerSample: number,
    sampleRate: number,
    frameNumber: number,
  ): Uint8Array {
    const bytesPerSample = bitsPerSample / 8;
    const _dataSize = blockSize * channels * bytesPerSample;

    // Frame header (variable size) + subframes + CRC
    const parts: number[] = [];

    // Sync code (14 bits: 0x3FFE) + reserved (1 bit: 0) + blocking strategy (1 bit: 0=fixed)
    parts.push(0xff); // sync byte 1
    parts.push(0xf8); // sync byte 2 (11111000)

    // Block size code + sample rate code
    const blockSizeCode = this.getBlockSizeCode(blockSize);
    const sampleRateCode = this.getSampleRateCode(sampleRate);
    parts.push((blockSizeCode << 4) | sampleRateCode);

    // Channel assignment + sample size + reserved
    const channelAssignment = channels === 1 ? 0x00 : 0x01; // mono or L+R
    const sampleSizeCode =
      bitsPerSample === 16 ? 0x04 : bitsPerSample === 24 ? 0x06 : 0x04;
    parts.push((channelAssignment << 4) | (sampleSizeCode << 1));

    // Frame number (UTF-8 coded)
    // Bitmasks ensure data bits don't overflow into the marker bits of each byte.
    if (frameNumber < 0x80) {
      parts.push(frameNumber & 0x7f);
    } else if (frameNumber < 0x800) {
      parts.push(0xc0 | ((frameNumber >> 6) & 0x1f));
      parts.push(0x80 | (frameNumber & 0x3f));
    } else {
      parts.push(0xe0 | ((frameNumber >> 12) & 0x0f));
      parts.push(0x80 | ((frameNumber >> 6) & 0x3f));
      parts.push(0x80 | (frameNumber & 0x3f));
    }

    // Block size (if code indicates "get from end of header")
    if (blockSizeCode === 0x06) {
      parts.push((blockSize - 1) & 0xff);
    } else if (blockSizeCode === 0x07) {
      parts.push(((blockSize - 1) >> 8) & 0xff);
      parts.push((blockSize - 1) & 0xff);
    }

    // Header CRC-8
    const headerBytes = new Uint8Array(parts);
    parts.push(this.crc8(headerBytes));

    // Subframes (verbatim encoding)
    const sampleData: number[] = [];
    for (let ch = 0; ch < channels; ch++) {
      // Subframe header: 0 (padding) + type 01 (verbatim) + no wasted bits
      sampleData.push(0x02); // verbatim subframe type

      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < blockSize; i++) {
        const sampleIndex = offset + i;
        const sample =
          sampleIndex < channelData.length ? channelData[sampleIndex] : 0;

        if (bitsPerSample === 16) {
          const clamped = Math.max(-1, Math.min(1, sample));
          const int16 =
            clamped < 0
              ? Math.floor(clamped * 0x8000)
              : Math.floor(clamped * 0x7fff);
          sampleData.push((int16 >> 8) & 0xff);
          sampleData.push(int16 & 0xff);
        } else {
          // 24-bit
          const clamped = Math.max(-1, Math.min(1, sample));
          const int24 =
            clamped < 0
              ? Math.floor(clamped * 0x800000)
              : Math.floor(clamped * 0x7fffff);
          sampleData.push((int24 >> 16) & 0xff);
          sampleData.push((int24 >> 8) & 0xff);
          sampleData.push(int24 & 0xff);
        }
      }
    }

    // Combine header + sample data
    const frameData = new Uint8Array(parts.length + sampleData.length + 2);
    frameData.set(new Uint8Array(parts), 0);
    frameData.set(new Uint8Array(sampleData), parts.length);

    // Frame footer: CRC-16
    const crc16 = this.crc16(
      frameData.subarray(0, parts.length + sampleData.length),
    );
    frameData[parts.length + sampleData.length] = (crc16 >> 8) & 0xff;
    frameData[parts.length + sampleData.length + 1] = crc16 & 0xff;

    return frameData;
  }

  private static getBlockSizeCode(blockSize: number): number {
    switch (blockSize) {
      case 192:
        return 0x01;
      case 576:
        return 0x02;
      case 1152:
        return 0x03;
      case 2304:
        return 0x04;
      case 4096:
        return 0x08;
      case 4608:
        return 0x05;
      case 8192:
        return 0x09;
      case 16384:
        return 0x0a;
      case 32768:
        return 0x0b;
      default:
        if (blockSize <= 256) return 0x06;
        return 0x07;
    }
  }

  private static getSampleRateCode(sampleRate: number): number {
    switch (sampleRate) {
      case 88200:
        return 0x01;
      case 176400:
        return 0x02;
      case 192000:
        return 0x03;
      case 8000:
        return 0x04;
      case 16000:
        return 0x05;
      case 22050:
        return 0x06;
      case 24000:
        return 0x07;
      case 32000:
        return 0x08;
      case 44100:
        return 0x09;
      case 48000:
        return 0x0a;
      case 96000:
        return 0x0b;
      default:
        return 0x00;
    }
  }

  private static crc8(data: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x80 ? (crc << 1) ^ 0x07 : crc << 1;
        crc &= 0xff;
      }
    }
    return crc;
  }

  private static crc16(data: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x8005 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc;
  }
}
