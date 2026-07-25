import { Signal } from "../lib/Signal";
import { AutomationList } from "../automation/AutomationList";

export type ProcessorId = string;

export abstract class Processor {
  public readonly id: ProcessorId;
  public name: string;

  // Parameter name -> AutomationList
  public automations: Map<string, AutomationList> = new Map();

  protected _active: boolean = true;
  public readonly activeChanged = new Signal<boolean>();
  public readonly stateChanged = new Signal<void>();
  public readonly automationAdded = new Signal<{
    paramName: string;
    list: AutomationList;
  }>();

  // ── Tail length ─────────────────────────────────────────────────────────
  /**
   * The number of frames of audio "tail" this processor produces after
   * input ceases (e.g. reverb decay, delay feedback).  Used by the engine
   * to know how long to keep processing after playback stops.
   */
  private _tailLength: number = 0;
  public readonly tailLengthChanged = new Signal<number>();

  // ── Latency ─────────────────────────────────────────────────────────────
  /**
   * Processing latency in samples.  Subclasses that introduce latency
   * (e.g. look-ahead limiters, linear-phase EQs) should call
   * {@link setLatency} rather than overriding {@link getLatency}.
   */
  private _latency: number = 0;
  public readonly latencyChanged = new Signal<number>();

  constructor(id: ProcessorId, name: string) {
    this.id = id;
    this.name = name;
  }

  public getAutomation(paramName: string): AutomationList {
    if (!this.automations.has(paramName)) {
      const list = new AutomationList();
      this.automations.set(paramName, list);
      this.automationAdded.emit({ paramName, list });
    }
    return this.automations.get(paramName)!;
  }

  public get active(): boolean {
    return this._active;
  }

  public set active(value: boolean) {
    if (this._active !== value) {
      this._active = value;
      this.activeChanged.emit(value);
    }
  }

  // ── Tail length API ─────────────────────────────────────────────────────

  /**
   * Returns the tail length in frames.
   */
  public getTailLength(): number {
    return this._tailLength;
  }

  /**
   * Set the tail length in frames.
   * @param frames Number of frames (>= 0).
   */
  public setTailLength(frames: number): void {
    const clamped = Math.max(0, frames);
    if (this._tailLength !== clamped) {
      this._tailLength = clamped;
      this.tailLengthChanged.emit(clamped);
    }
  }

  // ── Latency API ─────────────────────────────────────────────────────────

  /**
   * Returns the processing latency introduced by this processor, in samples.
   *
   * Subclasses that introduce latency (e.g. look-ahead limiters, linear-phase
   * EQs) should override this method.  The route uses the aggregate latency
   * of all its processors to compute automatic delay compensation
   * (see {@link Route.getProcessorLatency}).
   *
   * @returns Latency in samples (default 0).
   */
  public getLatency(): number {
    return this._latency;
  }

  /**
   * Set the processing latency in samples.
   * @param samples Latency in samples (>= 0).
   */
  public setLatency(samples: number): void {
    const clamped = Math.max(0, samples);
    if (this._latency !== clamped) {
      this._latency = clamped;
      this.latencyChanged.emit(clamped);
    }
  }

  // ── Effective tail length ───────────────────────────────────────────────

  /**
   * Returns the effective tail length, which is the maximum of this
   * processor's own tail length and any child processor tail lengths.
   *
   * Subclasses that contain child processors (e.g. processor chains,
   * plugin wrappers) should override this to include their children.
   *
   * @returns Effective tail length in frames.
   */
  public getEffectiveTailLength(): number {
    return this._tailLength;
  }
}
