import { SourceId, FrameCount } from "./types";
import type { VideoMetadata } from "./VideoMetadata";
import { Signal } from "../lib/Signal";

// ---------------------------------------------------------------
// Peak data for waveform display
// ---------------------------------------------------------------

/**
 * Pre-computed peak data for waveform rendering at a given resolution.
 *
 * Each entry represents one "pixel column" of the waveform and stores
 * the minimum, maximum, and RMS sample values within that column's
 * frame range.
 */
export interface PeakData {
  /** Minimum sample values per peak pixel. */
  min: Float32Array;
  /** Maximum sample values per peak pixel. */
  max: Float32Array;
  /** RMS (root mean square) values per peak pixel. */
  rms: Float32Array;
  /** Number of peak entries. */
  length: number;
  /** Number of source frames represented by each peak entry. */
  resolution: number;
}

// ---------------------------------------------------------------
// Analysis data
// ---------------------------------------------------------------

/**
 * Aggregated analysis results computed by the AudioAnalyzer.
 *
 * Fields are populated lazily — not all analysis passes produce
 * every metric, so most values are optional.
 */
export interface SourceAnalysisData {
  /** Detected transient positions in frames. */
  transients: number[];
  /** Estimated tempo in beats per minute. */
  bpm?: number;
  /** Confidence of the BPM estimate (0..1). */
  bpmConfidence?: number;
  /** Integrated loudness in LUFS. */
  lufs?: number;
  /** True peak level in dBFS. */
  truePeak?: number;
  /** Zero crossing rate (crossings per second). */
  zeroCrossingRate?: number;
  /** Spectral centroid in Hz. */
  spectralCentroid?: number;
}

/**
 * Bitflags for source metadata properties.
 */
export enum SourceFlags {
  WRITABLE = 1 << 0, // 1
  CAN_RENAME = 1 << 1, // 2
  REMOVABLE = 1 << 2, // 4
  MISSING = 1 << 3, // 8
  RF64_RIFF = 1 << 4, // 16
}

export class Source {
  public readonly id: SourceId;
  public readonly name: string;
  public readonly url: string; // Blob URL or path
  public readonly duration: FrameCount;
  public readonly sampleRate: number;
  public readonly channelCount: number;

  /**
   * Optional video metadata if this source originated from a video file.
   * When present, indicates that audio was extracted from a video file.
   */
  public readonly videoMetadata?: VideoMetadata;

  /** Bitflags describing source properties (see SourceFlags). */
  public flags: number = 0;

  /** Identifier linking this source to a specific take. */
  public takeId?: string;

  /** Name of the ancestor source (e.g. the original file before edits). */
  public ancestorName?: string;

  /** Reference count tracking how many regions/clips use this source. */
  private _useCount: number = 0;

  /** Cached peak data for waveform display at various zoom levels. */
  private _peakCache: Map<number, PeakData> = new Map();

  /** Analysis results (populated lazily by AudioAnalyzer). */
  private _analysisData: SourceAnalysisData | null = null;

  /** Emitted when peak data for a given resolution is added or updated. */
  public readonly peakCacheUpdated = new Signal<number>();

  /** Emitted when analysis data is set or replaced. */
  public readonly analysisCompleted = new Signal<SourceAnalysisData>();

  /** Natural timeline position in frames (where the source was originally recorded). */
  public naturalPosition?: number;

  /** Detected transient positions in frames. */
  public transients: number[] = [];

  /** Cue markers mapping frame positions to names. */
  public cueMarkers: Map<number, string> = new Map();

  /** Positions (in frames) where xruns / buffer underruns occurred during capture. */
  public xrunPositions: number[] = [];

  /** The track name this source was originally captured for. */
  public capturedFor?: string;

  constructor(
    id: SourceId,
    name: string,
    url: string,
    duration: FrameCount,
    sampleRate: number = 44100,
    channelCount: number = 2,
    videoMetadata?: VideoMetadata,
  ) {
    this.id = id;
    this.name = name;
    this.url = url;
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.channelCount = channelCount;
    this.videoMetadata = videoMetadata;
  }

  /**
   * Check if this source originated from a video file
   */
  public isVideoSource(): boolean {
    return this.videoMetadata !== undefined;
  }

  // --- Use count ---

  public get useCount(): number {
    return this._useCount;
  }

  public addUse(): void {
    this._useCount++;
  }

  public removeUse(): void {
    if (this._useCount > 0) {
      this._useCount--;
    }
  }

  // --- Flag helpers ---

  /**
   * Check whether a specific flag is set.
   */
  public hasFlag(flag: SourceFlags): boolean {
    return (this.flags & flag) !== 0;
  }

  /**
   * Set a specific flag.
   */
  public setFlag(flag: SourceFlags): void {
    this.flags |= flag;
  }

  /**
   * Clear a specific flag.
   */
  public clearFlag(flag: SourceFlags): void {
    this.flags &= ~flag;
  }

  // --- Peak cache ---

  /**
   * Store peak data for a given resolution (frames per peak entry).
   *
   * Replaces any previously cached data at the same resolution.
   * Emits {@link peakCacheUpdated} with the resolution key.
   */
  public setPeakData(resolution: number, data: PeakData): void {
    this._peakCache.set(resolution, data);
    this.peakCacheUpdated.emit(resolution);
  }

  /**
   * Retrieve cached peak data for a given resolution.
   *
   * @returns The peak data, or `undefined` if not yet computed.
   */
  public getPeakData(resolution: number): PeakData | undefined {
    return this._peakCache.get(resolution);
  }

  /**
   * Check whether peak data exists for a given resolution.
   */
  public hasPeakData(resolution: number): boolean {
    return this._peakCache.has(resolution);
  }

  /**
   * Clear all cached peak data for this source.
   */
  public clearPeakCache(): void {
    this._peakCache.clear();
  }

  // --- Analysis data ---

  /**
   * Set or replace analysis data for this source.
   *
   * This also updates the legacy {@link transients} array from the
   * analysis results for backward compatibility.
   * Emits {@link analysisCompleted} with the new data.
   */
  public setAnalysisData(data: SourceAnalysisData): void {
    this._analysisData = data;
    // Keep legacy transients array in sync
    this.transients = data.transients;
    this.analysisCompleted.emit(data);
  }

  /**
   * Retrieve the analysis data, or `null` if no analysis has been run.
   */
  public getAnalysisData(): SourceAnalysisData | null {
    return this._analysisData;
  }

  // --- Cleanup ---

  /**
   * Release resources held by this source.
   *
   * Revokes the blob URL (if applicable), clears the peak cache, and
   * disconnects all signal listeners. After disposal the source should
   * not be used.
   */
  public dispose(): void {
    // Revoke blob URLs to free browser memory
    if (this.url && this.url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(this.url);
      } catch {
        // Best-effort; URL may already be revoked
      }
    }

    this.clearPeakCache();
    this._analysisData = null;

    // Disconnect all signal listeners
    this.peakCacheUpdated.clear();
    this.analysisCompleted.clear();
  }
}
