import { Signal } from "../../lib/Signal";
import { FrameCount, TrackId } from "../../domain/types";

/**
 * PunchRecordManager handles automatic punch-in/punch-out recording.
 *
 * When punch is enabled:
 * - Recording starts automatically when playhead enters the punch range
 * - Recording stops automatically when playhead exits the punch range
 * - Declick fades are applied at punch boundaries
 * - Pre-roll audio before punch-in is discarded
 *
 * Modes:
 * - Simple punch: single pass recording within the range
 * - Loop punch: repeated punch recording when loop + punch are both enabled
 */

export interface PunchState {
  enabled: boolean;
  punchIn: FrameCount;
  punchOut: FrameCount;
  isPunchedIn: boolean;
  armedTrackIds: TrackId[];
}

export class PunchRecordManager {
  private _enabled: boolean = false;
  private _punchIn: FrameCount = 0;
  private _punchOut: FrameCount = 0;
  private _isPunchedIn: boolean = false;
  private _armedTrackIds: Set<TrackId> = new Set();

  // Declick fade length in frames (~1.5ms at 44100)
  private _declickLength: number = 64;

  /** Emitted when the playhead enters the punch range and recording begins. */
  public readonly punchInTriggered = new Signal<TrackId[]>();

  /** Emitted when the playhead exits the punch range and recording stops. */
  public readonly punchOutTriggered = new Signal<TrackId[]>();

  /** Emitted whenever the punch state changes. */
  public readonly stateChanged = new Signal<PunchState>();

  /**
   * @param sampleRate - Audio sample rate, used to compute declick fade length.
   *                     Defaults to 44100 if omitted.
   */
  constructor(sampleRate?: number) {
    const rate = sampleRate ?? 44100;
    // ~1.5ms declick fade, minimum 16 samples
    this._declickLength = Math.max(16, Math.round((1.5 / 1000) * rate));
  }

  // ─── Configuration ──────────────────────────────────────────────────

  /**
   * Configure the punch range boundaries.
   * @param punchIn - Frame at which recording should begin
   * @param punchOut - Frame at which recording should end
   */
  setPunchRange(punchIn: FrameCount, punchOut: FrameCount): void {
    if (punchOut <= punchIn) {
      throw new Error(
        `Invalid punch range: punchOut (${punchOut}) must be greater than punchIn (${punchIn})`,
      );
    }
    this._punchIn = punchIn;
    this._punchOut = punchOut;
    this._emitStateChanged();
  }

  /**
   * Enable or disable punch recording.
   * Disabling while punched-in will trigger an immediate punch-out.
   */
  setEnabled(enabled: boolean): void {
    const wasEnabled = this._enabled;
    this._enabled = enabled;

    // If disabling while currently punched in, trigger punch-out
    if (wasEnabled && !enabled && this._isPunchedIn) {
      this._doPunchOut();
    }

    this._emitStateChanged();
  }

  // ─── Track Arming ───────────────────────────────────────────────────

  /**
   * Arm a track for punch recording.
   * Only armed tracks will be affected by punch-in/punch-out events.
   */
  armTrack(trackId: TrackId): void {
    this._armedTrackIds.add(trackId);
    this._emitStateChanged();
  }

  /**
   * Disarm a track from punch recording.
   */
  disarmTrack(trackId: TrackId): void {
    this._armedTrackIds.delete(trackId);
    this._emitStateChanged();
  }

  // ─── Processing ─────────────────────────────────────────────────────

  /**
   * Called each audio process cycle with the current transport position.
   * Checks whether the playhead has crossed a punch boundary and triggers
   * punch-in or punch-out accordingly.
   *
   * @param currentFrame - The current transport playhead position in frames
   * @returns true if the recording state changed during this call
   */
  processPosition(currentFrame: FrameCount): boolean {
    if (!this._enabled) {
      return false;
    }

    if (this._armedTrackIds.size === 0) {
      return false;
    }

    const wasInRange = this._isPunchedIn;
    const isInRange =
      currentFrame >= this._punchIn && currentFrame < this._punchOut;

    if (!wasInRange && isInRange) {
      // Playhead just entered the punch range -> punch in
      this._doPunchIn();
      return true;
    }

    if (wasInRange && !isInRange) {
      // Playhead just exited the punch range -> punch out
      this._doPunchOut();
      return true;
    }

    return false;
  }

  // ─── State Queries ──────────────────────────────────────────────────

  /**
   * Get a snapshot of the current punch state.
   */
  getState(): PunchState {
    return {
      enabled: this._enabled,
      punchIn: this._punchIn,
      punchOut: this._punchOut,
      isPunchedIn: this._isPunchedIn,
      armedTrackIds: Array.from(this._armedTrackIds),
    };
  }

  /**
   * Whether we're currently in the punched-in state (recording is active
   * within the punch range).
   */
  get isPunchedIn(): boolean {
    return this._isPunchedIn;
  }

  /**
   * Compute declick fade gain at a given position relative to punch boundaries.
   *
   * Returns a gain value between 0.0 and 1.0:
   * - Ramps from 0->1 over _declickLength frames starting at punchIn (fade-in)
   * - Ramps from 1->0 over _declickLength frames ending at punchOut (fade-out)
   * - Returns 1.0 for positions in the middle of the punch range
   * - Returns 0.0 for positions outside the punch range
   *
   * Uses a raised-cosine (Hann) curve for perceptually smooth transitions,
   * consistent with the Declicker class.
   */
  getDeclickGain(frame: FrameCount): number {
    if (!this._enabled) {
      return 1.0;
    }

    // Outside punch range entirely
    if (frame < this._punchIn || frame >= this._punchOut) {
      return 0.0;
    }

    const fadeLen = this._declickLength;

    // Fade-in region: punchIn to punchIn + fadeLen
    const distFromStart = frame - this._punchIn;
    if (distFromStart < fadeLen) {
      // Raised cosine (Hann) fade-in: 0.5 * (1 - cos(pi * t))
      const t = distFromStart / (fadeLen - 1);
      return 0.5 * (1 - Math.cos(Math.PI * t));
    }

    // Fade-out region: punchOut - fadeLen to punchOut
    const distFromEnd = this._punchOut - frame;
    if (distFromEnd <= fadeLen) {
      // Raised cosine (Hann) fade-out: 0.5 * (1 + cos(pi * t))
      const t = (fadeLen - distFromEnd) / (fadeLen - 1);
      return 0.5 * (1 + Math.cos(Math.PI * t));
    }

    // In the middle of the range — full gain
    return 1.0;
  }

  /**
   * Reset state (called on transport stop).
   * Clears the punched-in state without emitting punch-out signals,
   * since transport stop implies recording has already ceased.
   */
  reset(): void {
    this._isPunchedIn = false;
    this._emitStateChanged();
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * Execute a punch-in: transition to recording state and notify listeners.
   */
  private _doPunchIn(): void {
    this._isPunchedIn = true;
    const trackIds = Array.from(this._armedTrackIds);
    this.punchInTriggered.emit(trackIds);
    this._emitStateChanged();
  }

  /**
   * Execute a punch-out: transition out of recording state and notify listeners.
   */
  private _doPunchOut(): void {
    this._isPunchedIn = false;
    const trackIds = Array.from(this._armedTrackIds);
    this.punchOutTriggered.emit(trackIds);
    this._emitStateChanged();
  }

  /**
   * Emit a stateChanged signal with the current punch state snapshot.
   */
  private _emitStateChanged(): void {
    this.stateChanged.emit(this.getState());
  }
}
