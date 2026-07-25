import { Signal } from "../../lib/Signal";
import { TrackId, FrameCount } from "../../domain/types";

/**
 * MultiTrackRecorder manages simultaneous recording on multiple tracks.
 *
 * In the Web Audio context, each armed track can record from:
 * - A specific audio input channel (via Web Audio MediaStreamSource)
 * - A MIDI input device
 *
 * The recorder manages:
 * - Per-track input assignment (which input channel -> which track)
 * - Simultaneous recording start/stop across all armed tracks
 * - Per-track audio buffer accumulation
 * - Take numbering and management
 */

export interface InputAssignment {
  trackId: TrackId;
  inputType: "audio" | "midi";
  channelIndex: number; // Which input channel (0, 1, 2, ...)
  deviceId?: string; // Optional specific device
}

export interface RecordingResult {
  trackId: TrackId;
  blob: Blob;
  startFrame: FrameCount;
  durationFrames: FrameCount;
  takeNumber: number;
  peakLevel: number; // Max peak during recording
  hasClipped: boolean;
}

interface ActiveRecording {
  trackId: TrackId;
  startFrame: FrameCount;
  chunks: Float32Array[][]; // Array of stereo blocks
  peakLevel: number;
  hasClipped: boolean;
  takeNumber: number;
}

interface AudioInputInfo {
  deviceId: string;
  label: string;
  channelCount: number;
}

/** Default sample rate used when encoding WAV if none is specified. */
const DEFAULT_SAMPLE_RATE = 44100;

/** Clip threshold — signals at or above 1.0 are considered clipped. */
const CLIP_THRESHOLD = 1.0;

export class MultiTrackRecorder {
  private _assignments: Map<TrackId, InputAssignment> = new Map();
  private _activeRecordings: Map<TrackId, ActiveRecording> = new Map();
  private _takeCounters: Map<TrackId, number> = new Map();
  private _isRecording: boolean = false;
  private _sampleRate: number;

  /** Emitted when recording starts on a set of tracks. */
  public readonly recordingStarted = new Signal<TrackId[]>();

  /** Emitted when recording stops, with results for each track. */
  public readonly recordingStopped = new Signal<RecordingResult[]>();

  /** Emitted periodically with per-track level updates during recording. */
  public readonly levelUpdate = new Signal<{
    trackId: TrackId;
    level: number;
  }>();

  /** Emitted when clipping is detected on a track. */
  public readonly clipDetected = new Signal<TrackId>();

  /**
   * @param sampleRate - Audio sample rate for WAV encoding. Defaults to 44100.
   */
  constructor(sampleRate?: number) {
    this._sampleRate = sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  // ─── Input Assignment ───────────────────────────────────────────────

  /**
   * Assign an input source to a track.
   * Defines which audio input channel or MIDI device feeds this track.
   */
  assignInput(assignment: InputAssignment): void {
    this._assignments.set(assignment.trackId, { ...assignment });
  }

  /**
   * Remove an input assignment from a track.
   */
  removeAssignment(trackId: TrackId): void {
    this._assignments.delete(trackId);
  }

  /**
   * Get the input assignment for a specific track.
   */
  getAssignment(trackId: TrackId): InputAssignment | undefined {
    const assignment = this._assignments.get(trackId);
    return assignment ? { ...assignment } : undefined;
  }

  /**
   * Get all current input assignments.
   */
  getAllAssignments(): InputAssignment[] {
    return Array.from(this._assignments.values()).map((a) => ({ ...a }));
  }

  // ─── Recording Control ──────────────────────────────────────────────

  /**
   * Start recording on all assigned and armed tracks simultaneously.
   * Only tracks that appear in both armedTrackIds AND have an input assignment
   * will begin recording.
   *
   * @param armedTrackIds - List of track IDs that are armed for recording
   * @param startFrame - The session frame at which recording begins
   */
  startRecording(armedTrackIds: TrackId[], startFrame: FrameCount): void {
    if (this._isRecording) {
      return;
    }

    const tracksToRecord: TrackId[] = [];

    for (const trackId of armedTrackIds) {
      if (!this._assignments.has(trackId)) {
        continue;
      }

      // Increment take counter for this track
      const currentTake = (this._takeCounters.get(trackId) ?? 0) + 1;
      this._takeCounters.set(trackId, currentTake);

      const recording: ActiveRecording = {
        trackId,
        startFrame,
        chunks: [],
        peakLevel: 0,
        hasClipped: false,
        takeNumber: currentTake,
      };

      this._activeRecordings.set(trackId, recording);
      tracksToRecord.push(trackId);
    }

    if (tracksToRecord.length > 0) {
      this._isRecording = true;
      this.recordingStarted.emit(tracksToRecord);
    }
  }

  /**
   * Stop recording on all tracks and return results.
   * Each result contains the accumulated audio as a WAV blob, duration,
   * peak level, and clipping information.
   */
  stopRecording(): RecordingResult[] {
    if (!this._isRecording) {
      return [];
    }

    const results: RecordingResult[] = [];

    for (const [trackId, recording] of this._activeRecordings) {
      const result = this._finalizeRecording(recording);
      if (result) {
        results.push(result);
      }
    }

    this._activeRecordings.clear();
    this._isRecording = false;
    this.recordingStopped.emit(results);
    return results;
  }

  /**
   * Stop recording on a specific track while other tracks continue.
   * Returns the result for that track, or null if the track was not recording.
   */
  stopTrackRecording(trackId: TrackId): RecordingResult | null {
    const recording = this._activeRecordings.get(trackId);
    if (!recording) {
      return null;
    }

    const result = this._finalizeRecording(recording);
    this._activeRecordings.delete(trackId);

    // If no more active recordings remain, mark as not recording
    if (this._activeRecordings.size === 0) {
      this._isRecording = false;
    }

    return result;
  }

  // ─── Audio Data Feed ────────────────────────────────────────────────

  /**
   * Feed audio data for a specific track during recording.
   * Called from the audio processing callback for each block of samples.
   *
   * Accumulates chunks, tracks peak levels, and detects clipping.
   *
   * @param trackId - The track receiving the audio
   * @param data - Per-channel audio data (e.g. [leftChannel, rightChannel])
   * @param blockSize - Number of frames in this block
   */
  feedAudio(trackId: TrackId, data: Float32Array[], blockSize: number): void {
    const recording = this._activeRecordings.get(trackId);
    if (!recording) {
      return;
    }

    // Copy the incoming data so we own the buffers
    // (callers may reuse the same arrays each cycle)
    const chunk: Float32Array[] = [];
    for (let ch = 0; ch < data.length; ch++) {
      const copy = new Float32Array(blockSize);
      // Copy only the relevant portion (blockSize may be less than data[ch].length)
      const srcLen = Math.min(blockSize, data[ch].length);
      for (let i = 0; i < srcLen; i++) {
        copy[i] = data[ch][i];
      }
      chunk.push(copy);
    }

    recording.chunks.push(chunk);

    // Compute peak level and detect clipping for this block
    let blockPeak = 0;
    let clippedInBlock = false;

    for (let ch = 0; ch < data.length; ch++) {
      const channelData = data[ch];
      const len = Math.min(blockSize, channelData.length);
      for (let i = 0; i < len; i++) {
        const abs = Math.abs(channelData[i]);
        if (abs > blockPeak) {
          blockPeak = abs;
        }
        if (abs >= CLIP_THRESHOLD) {
          clippedInBlock = true;
        }
      }
    }

    // Update recording peak
    if (blockPeak > recording.peakLevel) {
      recording.peakLevel = blockPeak;
    }

    // Detect clipping
    if (clippedInBlock && !recording.hasClipped) {
      recording.hasClipped = true;
      this.clipDetected.emit(trackId);
    }

    // Emit level update for metering
    this.levelUpdate.emit({ trackId, level: blockPeak });
  }

  // ─── Available Inputs ───────────────────────────────────────────────

  /**
   * Query the browser for available audio input devices.
   * Returns a list of input devices with their capabilities.
   */
  static async getAvailableInputs(): Promise<AudioInputInfo[]> {
    // Check if the MediaDevices API is available (browser environment)
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return [];
    }

    try {
      // Request permission to enumerate devices with labels
      // Some browsers require an active stream before labels are visible
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs: AudioInputInfo[] = [];

      for (const device of devices) {
        if (device.kind === "audioinput") {
          // Determine channel count from device capabilities if available
          let channelCount = 2; // Default to stereo
          try {
            const capabilities = (device as any).getCapabilities?.();
            if (capabilities?.channelCount?.max) {
              channelCount = capabilities.channelCount.max;
            }
          } catch {
            // getCapabilities not supported — use default
          }

          audioInputs.push({
            deviceId: device.deviceId,
            label: device.label || `Input ${audioInputs.length + 1}`,
            channelCount,
          });
        }
      }

      // Stop the temporary stream
      for (const track of stream.getTracks()) {
        track.stop();
      }

      return audioInputs;
    } catch {
      // Permission denied or no audio input available
      return [];
    }
  }

  // ─── State Queries ──────────────────────────────────────────────────

  /**
   * Whether the recorder is currently recording on any track.
   */
  get isRecording(): boolean {
    return this._isRecording;
  }

  /**
   * Get the list of track IDs that are currently being recorded.
   */
  getActiveTrackIds(): TrackId[] {
    return Array.from(this._activeRecordings.keys());
  }

  /**
   * Reset all state: clear active recordings, assignments, and take counters.
   */
  reset(): void {
    this._activeRecordings.clear();
    this._assignments.clear();
    this._takeCounters.clear();
    this._isRecording = false;
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * Finalize a recording: merge accumulated chunks into a WAV blob
   * and produce a RecordingResult.
   */
  private _finalizeRecording(
    recording: ActiveRecording,
  ): RecordingResult | null {
    if (recording.chunks.length === 0) {
      return null;
    }

    // Determine channel count from the first chunk
    const numChannels = recording.chunks[0].length;

    // Calculate total number of frames across all chunks
    let totalFrames = 0;
    for (const chunk of recording.chunks) {
      totalFrames += chunk[0].length;
    }

    if (totalFrames === 0) {
      return null;
    }

    // Merge all chunks into per-channel Float32Arrays
    const mergedChannels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      const merged = new Float32Array(totalFrames);
      let writePos = 0;
      for (const chunk of recording.chunks) {
        if (ch < chunk.length) {
          merged.set(chunk[ch], writePos);
          writePos += chunk[ch].length;
        } else {
          // If this chunk has fewer channels, fill with silence
          writePos += chunk[0].length;
        }
      }
      mergedChannels.push(merged);
    }

    // Encode to WAV
    const blob = MultiTrackRecorder._encodeWav(
      mergedChannels,
      this._sampleRate,
      numChannels,
    );

    return {
      trackId: recording.trackId,
      blob,
      startFrame: recording.startFrame,
      durationFrames: totalFrames,
      takeNumber: recording.takeNumber,
      peakLevel: recording.peakLevel,
      hasClipped: recording.hasClipped,
    };
  }

  /**
   * Encode per-channel Float32Array data into a WAV file Blob.
   *
   * Produces a standard RIFF/WAVE file with IEEE Float32 audio format.
   * Header layout follows the canonical WAV specification.
   *
   * @param channels - Per-channel audio data arrays (all same length)
   * @param sampleRate - Sample rate in Hz
   * @param numChannels - Number of audio channels
   */
  private static _encodeWav(
    channels: Float32Array[],
    sampleRate: number,
    numChannels: number,
  ): Blob {
    const totalFrames = channels[0].length;
    const bitsPerSample = 32;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = totalFrames * blockAlign;

    // Interleave channels: [L0, R0, L1, R1, ...]
    const interleaved = new Float32Array(totalFrames * numChannels);
    for (let frame = 0; frame < totalFrames; frame++) {
      for (let ch = 0; ch < numChannels; ch++) {
        interleaved[frame * numChannels + ch] = channels[ch][frame];
      }
    }

    // Build WAV header (44 bytes)
    const headerSize = 44;
    const header = new ArrayBuffer(headerSize);
    const view = new DataView(header);

    // RIFF chunk descriptor
    MultiTrackRecorder._writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true); // ChunkSize
    MultiTrackRecorder._writeString(view, 8, "WAVE");

    // fmt sub-chunk
    MultiTrackRecorder._writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM/Float)
    view.setUint16(20, 3, true); // AudioFormat: 3 = IEEE float
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, byteRate, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // data sub-chunk
    MultiTrackRecorder._writeString(view, 36, "data");
    view.setUint32(40, dataSize, true); // Subchunk2Size

    // Combine header + interleaved sample data
    return new Blob([header, interleaved.buffer as ArrayBuffer], {
      type: "audio/wav",
    });
  }

  /**
   * Write an ASCII string into a DataView at the given byte offset.
   */
  private static _writeString(
    view: DataView,
    offset: number,
    str: string,
  ): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
