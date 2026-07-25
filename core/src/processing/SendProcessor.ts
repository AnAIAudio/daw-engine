import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";
import { MeterData } from "../domain/MeterData";

/**
 * Send processor -- routes a copy of the signal to a destination track or bus.
 *
 * A send can be placed either pre-fader or post-fader in the processor chain.
 * It has its own independent level (in dB) and mute state.
 *
 * The actual DSP work (copying / mixing buffers) is performed by the audio
 * backend; this processor holds the domain state and emits signals for the
 * engine to react to.
 */
export class SendProcessor extends Processor {
  private _level: number; // dB
  private _preFader: boolean;
  private _pannable: boolean;
  private _targetId: string; // destination track/bus ID
  private _muted: boolean = false;

  /** Emitted when the send level changes. */
  public readonly levelChanged = new Signal<number>();
  /** Emitted when the pre/post-fader placement changes. */
  public readonly preFaderChanged = new Signal<boolean>();
  /** Emitted when the mute state changes. */
  public readonly muteChanged = new Signal<boolean>();

  /**
   * @param id        Unique processor identifier.
   * @param targetId  The ID of the destination track or bus.
   * @param level     Initial send level in dB (default 0 dB -- unity).
   * @param preFader  Whether this send taps the signal before the fader.
   * @param pannable  Whether the send has its own pan control.
   */
  constructor(
    id: ProcessorId,
    targetId: string,
    level: number = 0,
    preFader: boolean = false,
    pannable: boolean = false,
  ) {
    super(id, "Send");
    this._targetId = targetId;
    this._level = level;
    this._preFader = preFader;
    this._pannable = pannable;
  }

  // ── Level ────────────────────────────────────────────────────────────────

  /** Send level in dB. */
  public get level(): number {
    return this._level;
  }

  public set level(value: number) {
    const clamped =
      value === -Infinity ? -Infinity : Math.min(Math.max(value, -100), 12);
    if (this._level !== clamped) {
      this._level = clamped;
      this.levelChanged.emit(clamped);
      this.stateChanged.emit();
    }
  }

  // ── Pre/Post Fader ───────────────────────────────────────────────────────

  /** Whether this send taps the signal before the channel fader. */
  public get preFader(): boolean {
    return this._preFader;
  }

  public set preFader(value: boolean) {
    if (this._preFader !== value) {
      this._preFader = value;
      this.preFaderChanged.emit(value);
      this.stateChanged.emit();
    }
  }

  // ── Target ───────────────────────────────────────────────────────────────

  /** The destination track or bus ID. */
  public get targetId(): string {
    return this._targetId;
  }

  // ── Pannable ─────────────────────────────────────────────────────────────

  /** Whether this send has its own panning control. */
  public get pannable(): boolean {
    return this._pannable;
  }

  // ── Mute ─────────────────────────────────────────────────────────────────

  /** Whether this send is muted. */
  public get muted(): boolean {
    return this._muted;
  }

  public set muted(value: boolean) {
    if (this._muted !== value) {
      this._muted = value;
      this.muteChanged.emit(value);
      this.stateChanged.emit();
    }
  }

  // ── Metering ─────────────────────────────────────────────────────────────

  /**
   * Returns the current meter data for this send.
   * In a full implementation the audio backend would feed real values;
   * here we return sensible defaults so consumers always get a valid object.
   */
  public getMeterData(): MeterData {
    return {
      peak: -Infinity,
      rms: -Infinity,
      peakHold: -Infinity,
      clipping: false,
    };
  }
}
