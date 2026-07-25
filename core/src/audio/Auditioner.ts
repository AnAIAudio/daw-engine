import { Signal } from "../lib/Signal";
import { SourceId, FrameCount } from "../domain/types";

/**
 * Auditioner provides solo preview playback of audio sources.
 *
 * Used to preview audio files before importing, or to audition
 * regions/clips without affecting the main transport.
 * Plays through a dedicated output path that bypasses the mixer.
 */

export enum AuditionerState {
  IDLE = "IDLE",
  LOADING = "LOADING",
  PLAYING = "PLAYING",
  PAUSED = "PAUSED",
}

export interface AuditionerOutput {
  sourceId: SourceId;
  url: string;
  startInSource: FrameCount;
  blockSize: number;
  gain: number;
}

export class Auditioner {
  private _state: AuditionerState = AuditionerState.IDLE;
  private _currentSourceId: SourceId | null = null;
  private _currentUrl: string | null = null;
  private _position: FrameCount = 0;
  private _duration: FrameCount = 0;
  private _gain: number = 1.0;
  private _looping: boolean = false;

  // Region preview: play a specific portion of a source
  private _regionStart: FrameCount = 0;
  private _regionLength: FrameCount = 0;

  public readonly stateChanged = new Signal<AuditionerState>();
  public readonly positionChanged = new Signal<FrameCount>();
  public readonly finished = new Signal<void>();

  // ---------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------

  get state(): AuditionerState {
    return this._state;
  }

  get isPlaying(): boolean {
    return this._state === AuditionerState.PLAYING;
  }

  get position(): FrameCount {
    return this._position;
  }

  get duration(): FrameCount {
    return this._duration;
  }

  get currentSourceId(): SourceId | null {
    return this._currentSourceId;
  }

  // ---------------------------------------------------------------
  // Audition API
  // ---------------------------------------------------------------

  /**
   * Audition an entire source by URL.
   *
   * Cancels any currently active audition, then begins playback of the
   * full source from the beginning.
   */
  auditSource(sourceId: SourceId, url: string, duration: FrameCount): void {
    this.cancel();

    this._currentSourceId = sourceId;
    this._currentUrl = url;
    this._duration = duration;
    this._position = 0;
    this._regionStart = 0;
    this._regionLength = duration;

    this.setState(AuditionerState.LOADING);
    // Transition to PLAYING — in a real implementation this would wait for
    // the audio backend to signal readiness, but for the domain model we
    // treat the source as immediately available once loaded by the cache.
    this.setState(AuditionerState.PLAYING);
  }

  /**
   * Audition a specific region of a source.
   *
   * Useful for previewing a trimmed region or a clip without
   * having to play the full underlying source.
   */
  auditRegion(
    sourceId: SourceId,
    url: string,
    start: FrameCount,
    length: FrameCount,
  ): void {
    this.cancel();

    this._currentSourceId = sourceId;
    this._currentUrl = url;
    this._duration = length;
    this._position = 0;
    this._regionStart = start;
    this._regionLength = length;

    this.setState(AuditionerState.LOADING);
    this.setState(AuditionerState.PLAYING);
  }

  // ---------------------------------------------------------------
  // Transport controls
  // ---------------------------------------------------------------

  /**
   * Resume or start playback of the current audition.
   */
  play(): void {
    if (
      this._state === AuditionerState.PAUSED ||
      this._state === AuditionerState.LOADING
    ) {
      this.setState(AuditionerState.PLAYING);
    }
  }

  /**
   * Pause the current audition. Position is preserved so playback
   * can be resumed with {@link play}.
   */
  pause(): void {
    if (this._state === AuditionerState.PLAYING) {
      this.setState(AuditionerState.PAUSED);
    }
  }

  /**
   * Stop playback and reset position to the beginning.
   */
  stop(): void {
    if (this._state === AuditionerState.IDLE) {
      return;
    }
    this._position = 0;
    this.positionChanged.emit(this._position);
    this.setState(AuditionerState.IDLE);
  }

  /**
   * Seek to an absolute frame position within the auditioned region.
   * The position is clamped to [0, duration).
   */
  seek(frame: FrameCount): void {
    if (this._currentSourceId === null) {
      return;
    }
    this._position = Math.max(0, Math.min(frame, this._regionLength - 1));
    this.positionChanged.emit(this._position);
  }

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------

  /**
   * Set the auditioner output gain.
   * @param gain Linear gain value (0.0 = silence, 1.0 = unity).
   */
  setGain(gain: number): void {
    this._gain = Math.max(0, gain);
  }

  /**
   * Enable or disable looping for the current audition.
   */
  setLooping(loop: boolean): void {
    this._looping = loop;
  }

  // ---------------------------------------------------------------
  // Audio processing
  // ---------------------------------------------------------------

  /**
   * Called by the audio engine on each render cycle to advance the
   * auditioner position and produce an output descriptor.
   *
   * Returns `null` when the auditioner is not actively playing.
   * When playback reaches the end of the region and looping is
   * disabled, emits the {@link finished} signal and transitions
   * to IDLE.
   *
   * @param blockSize   Number of frames in this render block.
   * @param _sampleRate Current engine sample rate (reserved for
   *                    future sample-rate conversion).
   */
  processBlock(
    blockSize: number,
    _sampleRate: number,
  ): AuditionerOutput | null {
    if (this._state !== AuditionerState.PLAYING) {
      return null;
    }

    if (this._currentSourceId === null || this._currentUrl === null) {
      return null;
    }

    // Calculate how many frames we can actually render this block
    const remaining = this._regionLength - this._position;

    if (remaining <= 0) {
      if (this._looping) {
        this._position = 0;
      } else {
        this.setState(AuditionerState.IDLE);
        this._position = 0;
        this.positionChanged.emit(this._position);
        this.finished.emit(undefined as unknown as void);
        return null;
      }
    }

    const framesToRender = Math.min(
      blockSize,
      this._regionLength - this._position,
    );

    const output: AuditionerOutput = {
      sourceId: this._currentSourceId,
      url: this._currentUrl,
      startInSource: this._regionStart + this._position,
      blockSize: framesToRender,
      gain: this._gain,
    };

    this._position += framesToRender;
    this.positionChanged.emit(this._position);

    // Handle end-of-region
    if (this._position >= this._regionLength) {
      if (this._looping) {
        this._position = 0;
      } else {
        this.setState(AuditionerState.IDLE);
        this._position = 0;
        this.positionChanged.emit(this._position);
        this.finished.emit(undefined as unknown as void);
      }
    }

    return output;
  }

  // ---------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------

  /**
   * Cancel the current audition and reset all state.
   */
  cancel(): void {
    this._currentSourceId = null;
    this._currentUrl = null;
    this._position = 0;
    this._duration = 0;
    this._regionStart = 0;
    this._regionLength = 0;

    if (this._state !== AuditionerState.IDLE) {
      this.setState(AuditionerState.IDLE);
    }
  }

  // ---------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------

  private setState(state: AuditionerState): void {
    if (this._state !== state) {
      this._state = state;
      this.stateChanged.emit(state);
    }
  }
}
