import { Declicker, DeclickAmp } from "./Declick";
import { XrunTracker } from "./XrunTracker";

/**
 * Minimal interface for audio buffer sources used by DiskReader.
 * Compatible with Web Audio API's AudioBuffer.
 */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** Default chunk size: 64k samples (~1.5s at 44100 Hz) */
const DEFAULT_CHUNK_SIZE = 65536;

/** Default peak buffer size for GUI visualization */
const DEFAULT_PEAK_BUFFER_SIZE = 1024;

/**
 * DiskReader - Manages buffered playback I/O.
 * Provides chunk-based reading with loop handling.
 */
export class DiskReader {
  private _chunkSize: number;
  private _buffer: Float32Array[]; // Per-channel playback buffers
  private _readPosition: number = 0;
  private _writeOffset: number = 0; // How many valid samples are in _buffer
  private _channelCount: number;
  private _loopStart: number = -1;
  private _loopEnd: number = -1;
  private _declicker: Declicker | null = null;

  /**
   * @param channelCount - Number of audio channels (e.g. 2 for stereo)
   * @param chunkSize - Size of the internal playback buffer per channel (default 64k)
   */
  constructor(channelCount: number, chunkSize?: number) {
    this._channelCount = channelCount;
    this._chunkSize = chunkSize ?? DEFAULT_CHUNK_SIZE;
    this._buffer = [];
    for (let ch = 0; ch < channelCount; ch++) {
      this._buffer.push(new Float32Array(this._chunkSize));
    }
  }

  /**
   * Set loop boundaries for loop playback.
   * When reading reaches loopEnd, it wraps back to loopStart.
   * Optionally enables a declicker for smooth loop transitions.
   * @param start - Loop start frame (in source coordinates)
   * @param end - Loop end frame (in source coordinates)
   */
  setLoop(start: number, end: number): void {
    this._loopStart = start;
    this._loopEnd = end;
    // Create a declicker for the loop boundary (~128 samples)
    this._declicker = new Declicker(128);
  }

  /**
   * Remove loop boundaries.
   */
  clearLoop(): void {
    this._loopStart = -1;
    this._loopEnd = -1;
    this._declicker = null;
  }

  /**
   * Fill the internal buffer from a source starting at the given frame.
   * Handles loop wrapping if a loop is set.
   * @param source - The audio buffer source to read from
   * @param startFrame - The frame position in the source to start reading from
   * @returns The number of frames actually read
   */
  async refill(source: AudioBufferLike, startFrame: number): Promise<number> {
    const srcLength = source.length;
    const channels = Math.min(this._channelCount, source.numberOfChannels);
    let framesRead = 0;
    let srcPos = startFrame;
    const hasLoop = this._loopStart >= 0 && this._loopEnd > this._loopStart;

    // Clear buffers
    for (let ch = 0; ch < this._channelCount; ch++) {
      this._buffer[ch].fill(0);
    }

    while (framesRead < this._chunkSize) {
      // Clamp source position
      if (srcPos >= srcLength) {
        if (hasLoop) {
          srcPos = this._loopStart;
        } else {
          break; // End of source, no loop
        }
      }

      // Determine how many frames we can read in this segment
      let framesToRead = this._chunkSize - framesRead;

      // Don't read past source end
      framesToRead = Math.min(framesToRead, srcLength - srcPos);

      // Don't read past loop end
      if (hasLoop && srcPos < this._loopEnd) {
        framesToRead = Math.min(framesToRead, this._loopEnd - srcPos);
      }

      if (framesToRead <= 0) break;

      // Copy from source into internal buffer
      for (let ch = 0; ch < channels; ch++) {
        const srcData = source.getChannelData(ch);
        const destData = this._buffer[ch];
        for (let i = 0; i < framesToRead; i++) {
          destData[framesRead + i] = srcData[srcPos + i];
        }
      }

      framesRead += framesToRead;
      srcPos += framesToRead;

      // Handle loop wrap
      if (hasLoop && srcPos >= this._loopEnd) {
        // Apply crossfade at the loop boundary if declicker is available
        if (this._declicker && framesRead > 0) {
          const fadeLen = this._declicker.getLength();
          const fadeStart = framesRead - Math.min(fadeLen, framesToRead);
          if (fadeStart >= 0) {
            for (let ch = 0; ch < channels; ch++) {
              this._declicker.applyFadeOut(this._buffer[ch], fadeStart);
            }
          }
        }
        srcPos = this._loopStart;
      }
    }

    this._writeOffset = framesRead;
    this._readPosition = 0;
    return framesRead;
  }

  /**
   * Read samples from the internal buffer into output arrays.
   * @param output - Per-channel output arrays to write into
   * @param offset - Offset into the output arrays
   * @param count - Number of frames to read
   * @returns Number of frames actually read
   */
  read(output: Float32Array[], offset: number, count: number): number {
    const available = this._writeOffset - this._readPosition;
    const framesToRead = Math.min(count, available);

    if (framesToRead <= 0) return 0;

    const channels = Math.min(this._channelCount, output.length);
    for (let ch = 0; ch < channels; ch++) {
      const src = this._buffer[ch];
      const dest = output[ch];
      for (let i = 0; i < framesToRead; i++) {
        dest[offset + i] = src[this._readPosition + i];
      }
    }

    this._readPosition += framesToRead;
    return framesToRead;
  }

  /**
   * Seek to a specific frame position within the buffer.
   * Note: This only adjusts the internal read pointer; you may need to refill().
   */
  seek(frame: number): void {
    this._readPosition = 0;
    this._writeOffset = 0;
    // The caller should refill after seeking
  }

  /**
   * Get current read position within the internal buffer.
   */
  getPosition(): number {
    return this._readPosition;
  }

  /**
   * Check if the internal buffer needs a refill (more than half consumed).
   */
  needsRefill(): boolean {
    return this._readPosition >= this._writeOffset / 2;
  }

  /**
   * Get the percentage of the buffer that still contains unread data.
   * Useful for monitoring playback buffer health.
   */
  getBufferLoadPercent(): number {
    if (this._writeOffset === 0) return 0;
    const remaining = this._writeOffset - this._readPosition;
    return (remaining / this._chunkSize) * 100;
  }
}

/**
 * DiskWriter - Manages buffered recording I/O.
 * Captures audio with alignment and xrun tracking.
 */
export class DiskWriter {
  private _buffer: Float32Array[]; // Per-channel capture buffers
  private _bufferSize: number;
  private _writePosition: number = 0;
  private _captureStart: number = -1;
  private _captureEnd: number = -1;
  private _channelCount: number;
  private _isRecording: boolean = false;
  private _xrunTracker: XrunTracker;
  private _declickAmp: DeclickAmp;
  private _peakBuffer: Float32Array[]; // For GUI peak visualization
  private _peakWritePos: number = 0;
  private _alignmentStyle: "existing_material" | "capture_time" =
    "capture_time";

  /** Initial capture buffer size: 10 minutes at 48kHz stereo */
  private static readonly INITIAL_BUFFER_FRAMES = 48000 * 60 * 10;

  /**
   * @param channelCount - Number of audio channels
   * @param sampleRate - Audio sample rate (for DeclickAmp ramp calculation)
   * @param xrunTracker - Shared xrun tracker instance
   */
  constructor(
    channelCount: number,
    sampleRate: number,
    xrunTracker: XrunTracker,
  ) {
    this._channelCount = channelCount;
    this._xrunTracker = xrunTracker;
    this._declickAmp = new DeclickAmp(sampleRate);
    this._bufferSize = DiskWriter.INITIAL_BUFFER_FRAMES;

    // Allocate per-channel capture buffers
    this._buffer = [];
    for (let ch = 0; ch < channelCount; ch++) {
      this._buffer.push(new Float32Array(this._bufferSize));
    }

    // Peak buffer for GUI visualization
    this._peakBuffer = [];
    for (let ch = 0; ch < channelCount; ch++) {
      this._peakBuffer.push(new Float32Array(DEFAULT_PEAK_BUFFER_SIZE));
    }
  }

  /**
   * Prepare for recording. Resets buffers and sets the capture start frame.
   * @param startFrame - The session frame at which recording will begin
   */
  prepareRecord(startFrame: number): void {
    this._captureStart = startFrame;
    this._captureEnd = -1;
    this._writePosition = 0;
    this._peakWritePos = 0;

    // Clear buffers
    for (let ch = 0; ch < this._channelCount; ch++) {
      this._buffer[ch].fill(0);
      this._peakBuffer[ch].fill(0);
    }

    // Reset declick: start at gain 0, will ramp up when recording starts
    this._declickAmp.reset(0.0);
    this._declickAmp.setTarget(1.0);
  }

  /**
   * Start recording. Activates capture and begins the fade-in ramp.
   */
  startRecord(): void {
    this._isRecording = true;
    this._declickAmp.setTarget(1.0);
  }

  /**
   * Stop recording. Begins fade-out ramp and marks the capture end.
   * @returns The capture end frame in session coordinates
   */
  stopRecord(): number {
    this._isRecording = false;
    this._declickAmp.setTarget(0.0);
    this._captureEnd = this._captureStart + this._writePosition;
    return this._captureEnd;
  }

  /**
   * Write incoming audio samples to the capture buffer.
   * Applies declick ramp and tracks peak data for GUI.
   * Reports an xrun if the buffer overflows.
   * @param input - Per-channel input arrays
   * @param offset - Offset into the input arrays
   * @param count - Number of frames to write
   */
  write(input: Float32Array[], offset: number, count: number): void {
    if (!this._isRecording && !this._declickAmp.isRamping()) return;

    // Check for buffer overflow
    if (this._writePosition + count > this._bufferSize) {
      // Grow the buffer (double it)
      this._growBuffer();

      // If still not enough (shouldn't happen), report xrun
      if (this._writePosition + count > this._bufferSize) {
        this._xrunTracker.reportXrun(
          this._captureStart + this._writePosition,
          "overrun",
          count,
        );
        return;
      }
    }

    const channels = Math.min(this._channelCount, input.length);

    // Copy input data into capture buffer
    for (let ch = 0; ch < channels; ch++) {
      const src = input[ch];
      const dest = this._buffer[ch];
      for (let i = 0; i < count; i++) {
        dest[this._writePosition + i] = src[offset + i];
      }
    }

    // Apply declick ramp to the just-written segment
    const segmentBuffers: Float32Array[] = this._buffer;
    this._declickAmp.applyToBuffers(segmentBuffers, this._writePosition, count);

    // Update peak data for GUI visualization
    this._updatePeaks(channels, count);

    this._writePosition += count;
  }

  /**
   * Get the captured audio as trimmed Float32Arrays (one per channel).
   */
  getCapturedAudio(): Float32Array[] {
    const result: Float32Array[] = [];
    for (let ch = 0; ch < this._channelCount; ch++) {
      result.push(this._buffer[ch].slice(0, this._writePosition));
    }
    return result;
  }

  /**
   * Get the capture range in session frame coordinates.
   */
  getCaptureRange(): { start: number; end: number } {
    return {
      start: this._captureStart,
      end:
        this._captureEnd >= 0
          ? this._captureEnd
          : this._captureStart + this._writePosition,
    };
  }

  /**
   * Get peak data for GUI real-time visualization during recording.
   * Returns per-channel arrays of peak values.
   */
  getPeakData(): Float32Array[] {
    const result: Float32Array[] = [];
    for (let ch = 0; ch < this._channelCount; ch++) {
      result.push(this._peakBuffer[ch].slice(0, this._peakWritePos));
    }
    return result;
  }

  /**
   * Reset peak data (e.g. when the GUI display scrolls).
   */
  resetPeakData(): void {
    this._peakWritePos = 0;
    for (let ch = 0; ch < this._channelCount; ch++) {
      this._peakBuffer[ch].fill(0);
    }
  }

  /**
   * Set the alignment style for the captured recording.
   * - 'existing_material': Align to existing material on the track (snap to beat/region boundaries)
   * - 'capture_time': Align to the exact time the audio was captured (default)
   */
  setAlignment(style: "existing_material" | "capture_time"): void {
    this._alignmentStyle = style;
  }

  /**
   * Check if currently recording.
   */
  isRecording(): boolean {
    return this._isRecording;
  }

  /**
   * Get the number of frames captured so far.
   */
  getCapturedFrames(): number {
    return this._writePosition;
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  /**
   * Grow the capture buffer by doubling its size.
   */
  private _growBuffer(): void {
    const newSize = this._bufferSize * 2;
    for (let ch = 0; ch < this._channelCount; ch++) {
      const newBuf = new Float32Array(newSize);
      newBuf.set(this._buffer[ch]);
      this._buffer[ch] = newBuf;
    }
    this._bufferSize = newSize;
  }

  /**
   * Update the peak buffer with the maximum absolute sample values
   * from the most recently written segment. Each peak entry represents
   * a chunk of recorded samples, downsampled for efficient GUI rendering.
   */
  private _updatePeaks(channels: number, count: number): void {
    // Each peak entry covers a fixed number of source samples
    const samplesPerPeak = 512;
    const startSample = this._writePosition;
    const endSample = startSample + count;

    for (let pos = startSample; pos < endSample; pos += samplesPerPeak) {
      const blockEnd = Math.min(pos + samplesPerPeak, endSample);

      for (let ch = 0; ch < channels; ch++) {
        let peak = 0;
        const buf = this._buffer[ch];
        for (let i = pos; i < blockEnd; i++) {
          const abs = Math.abs(buf[i]);
          if (abs > peak) peak = abs;
        }

        // Grow peak buffer if needed
        if (this._peakWritePos >= this._peakBuffer[ch].length) {
          const newPeakBuf = new Float32Array(this._peakBuffer[ch].length * 2);
          newPeakBuf.set(this._peakBuffer[ch]);
          this._peakBuffer[ch] = newPeakBuf;
        }

        this._peakBuffer[ch][this._peakWritePos] = peak;
      }

      this._peakWritePos++;
    }
  }
}
