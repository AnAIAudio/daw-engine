import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";
import { TrackId } from "../domain/types";

/**
 * InternalSend routes audio from one route to another internally.
 * Unlike regular sends that go to a send bus, internal sends
 * create a direct connection between two routes.
 */

export interface InternalSendSnapshot {
  id: ProcessorId;
  name: string;
  targetTrackId: string;
  sendLevel: number;
  preFader: boolean;
  muted: boolean;
  active: boolean;
}

export interface InternalReturnSnapshot {
  id: ProcessorId;
  name: string;
  sourceTrackIds: string[];
  active: boolean;
}

export class InternalSend extends Processor {
  private _targetTrackId: TrackId;
  private _sendLevel: number = 0; // dB
  private _preFader: boolean = false;
  private _muted: boolean = false;

  public readonly targetChanged = new Signal<TrackId>();
  public readonly levelChanged = new Signal<number>();

  constructor(id: ProcessorId, name: string, targetTrackId: TrackId) {
    super(id, name);
    this._targetTrackId = targetTrackId;
  }

  // ── Target ──────────────────────────────────────────────────────────────

  /** The ID of the target track that receives audio from this send. */
  public get targetTrackId(): TrackId {
    return this._targetTrackId;
  }

  /**
   * Change the target track.
   * @param trackId The new target track ID.
   */
  public setTarget(trackId: TrackId): void {
    if (this._targetTrackId !== trackId) {
      this._targetTrackId = trackId;
      this.targetChanged.emit(trackId);
      this.stateChanged.emit();
    }
  }

  // ── Send Level ──────────────────────────────────────────────────────────

  /** Send level in dB. 0 dB = unity gain. */
  public get sendLevel(): number {
    return this._sendLevel;
  }

  /**
   * Set the send level in dB.
   * @param db Level in decibels. Clamped to [-100, +12]. -Infinity = silence, 0 = unity.
   */
  public setSendLevel(db: number): void {
    const clamped =
      db === -Infinity ? -Infinity : Math.min(Math.max(db, -100), 12);
    if (this._sendLevel !== clamped) {
      this._sendLevel = clamped;
      this.levelChanged.emit(clamped);
      this.stateChanged.emit();
    }
  }

  // ── Pre/Post Fader ──────────────────────────────────────────────────────

  /** Whether this send taps the signal before the channel fader. */
  public get preFader(): boolean {
    return this._preFader;
  }

  /**
   * Set whether this send is pre-fader or post-fader.
   * @param pre true for pre-fader, false for post-fader.
   */
  public setPreFader(pre: boolean): void {
    if (this._preFader !== pre) {
      this._preFader = pre;
      this.stateChanged.emit();
    }
  }

  // ── Mute ────────────────────────────────────────────────────────────────

  /** Whether this send is muted. */
  public get muted(): boolean {
    return this._muted;
  }

  /**
   * Set the mute state of this send.
   * @param muted true to mute, false to unmute.
   */
  public setMuted(muted: boolean): void {
    if (this._muted !== muted) {
      this._muted = muted;
      this.stateChanged.emit();
    }
  }

  // ── Gain computation ────────────────────────────────────────────────────

  /**
   * Compute the linear gain to apply to audio routed through this send.
   * Takes into account the send level (dB) and mute state.
   *
   * @returns Linear gain (0.0 if muted or inactive).
   */
  public getLinearGain(): number {
    if (this._muted || !this.active) {
      return 0;
    }
    // Convert dB to linear: gain = 10^(dB/20)
    return Math.pow(10, this._sendLevel / 20);
  }

  // ── Serialization ───────────────────────────────────────────────────────

  public toJSON(): InternalSendSnapshot {
    return {
      id: this.id,
      name: this.name,
      targetTrackId: this._targetTrackId,
      sendLevel: this._sendLevel,
      preFader: this._preFader,
      muted: this._muted,
      active: this.active,
    };
  }

  public static fromJSON(data: InternalSendSnapshot): InternalSend {
    const send = new InternalSend(
      data.id as ProcessorId,
      data.name,
      data.targetTrackId as TrackId,
    );
    send._sendLevel = data.sendLevel;
    send._preFader = data.preFader;
    send._muted = data.muted;
    send.active = data.active;
    return send;
  }
}

/**
 * InternalReturn receives audio from InternalSend(s).
 *
 * An InternalReturn is placed in the processor chain of the receiving track.
 * It collects audio from any number of InternalSend processors that target
 * the track containing this return.
 */
export class InternalReturn extends Processor {
  private _sourceTrackIds: Set<TrackId> = new Set();

  public readonly sourceAdded = new Signal<TrackId>();
  public readonly sourceRemoved = new Signal<TrackId>();

  constructor(id: ProcessorId, name: string) {
    super(id, name);
  }

  /**
   * Register a source track that is sending audio to this return.
   * @param trackId The source track ID.
   */
  public addSource(trackId: TrackId): void {
    if (!this._sourceTrackIds.has(trackId)) {
      this._sourceTrackIds.add(trackId);
      this.sourceAdded.emit(trackId);
      this.stateChanged.emit();
    }
  }

  /**
   * Remove a source track from this return.
   * @param trackId The source track ID to remove.
   */
  public removeSource(trackId: TrackId): void {
    if (this._sourceTrackIds.has(trackId)) {
      this._sourceTrackIds.delete(trackId);
      this.sourceRemoved.emit(trackId);
      this.stateChanged.emit();
    }
  }

  /** List of all source track IDs sending audio to this return. */
  public get sourceTrackIds(): ReadonlyArray<TrackId> {
    return Array.from(this._sourceTrackIds);
  }

  /**
   * Check if a specific track is registered as a source.
   * @param trackId The track ID to check.
   */
  public hasSource(trackId: TrackId): boolean {
    return this._sourceTrackIds.has(trackId);
  }

  // ── Serialization ───────────────────────────────────────────────────────

  public toJSON(): InternalReturnSnapshot {
    return {
      id: this.id,
      name: this.name,
      sourceTrackIds: Array.from(this._sourceTrackIds),
      active: this.active,
    };
  }

  public static fromJSON(data: InternalReturnSnapshot): InternalReturn {
    const ret = new InternalReturn(data.id as ProcessorId, data.name);
    for (const id of data.sourceTrackIds) {
      ret._sourceTrackIds.add(id as TrackId);
    }
    ret.active = data.active;
    return ret;
  }
}
