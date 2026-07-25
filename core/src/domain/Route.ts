import { RouteId, ProcessorId } from "./types";
import { Processor } from "../processing/Processor";
import { GainProcessor } from "../processing/GainProcessor";
import { Panner } from "../processing/Panner";
import { PolarityProcessor } from "../processing/PolarityProcessor";
import { IO } from "../processing/IO";
import { Signal } from "../lib/Signal";
import { LatencyCompensator } from "../audio/engine/LatencyCompensator";

export class Route {
  public readonly id: RouteId;
  public name: string;

  // IO Ports
  public readonly input: IO;
  public readonly output: IO;

  private _preFaderProcessors: Processor[] = [];
  private _postFaderProcessors: Processor[] = [];

  public readonly processorAdded = new Signal<Processor>();
  public readonly processorRemoved = new Signal<ProcessorId>();

  // ── Core strip processors ────────────────────────────────────────────────
  // Signal chain order:
  //   Input -> Trim -> [Pre-fader plugins] -> Fader -> Polarity
  //         -> [Post-fader plugins] -> Panner -> Output

  /** Input gain correction (pre-fader). */
  private _trim: GainProcessor;
  /** Main channel fader. */
  private _fader: GainProcessor;
  /** Phase inversion processor (post-fader, before post-fader plugins). */
  private _polarity: PolarityProcessor;
  /** Channel panner. */
  private _panner: Panner;

  private _active: boolean = true;

  // ── Latency Compensation (D-5) ──────────────────────────────────────────
  /**
   * Auto-computed compensation delay (in samples) applied to this route
   * so that all routes in the session are time-aligned.
   */
  private _compensationDelay: number = 0;

  /**
   * Delay buffer that applies `_compensationDelay` samples of latency to
   * this route's audio so all routes stay time-aligned at the summing bus.
   */
  public readonly latencyCompensator: LatencyCompensator =
    new LatencyCompensator();

  /**
   * Emitted whenever the total processor latency of this route changes,
   * carrying the new total latency in samples.  The session listens to
   * this signal to know when to recompute global compensation.
   */
  public readonly latencyChanged = new Signal<number>();

  /** Disposers for processor latency-change subscriptions. */
  private _latencySubscriptions: Map<ProcessorId, { dispose: () => void }> =
    new Map();

  constructor(id: RouteId, name: string) {
    this.id = id;
    this.name = name;

    // Initialize IO
    this.input = new IO(crypto.randomUUID(), `${name} Input`);
    this.output = new IO(crypto.randomUUID(), `${name} Output`);

    // Initialize default processors
    this._trim = new GainProcessor(crypto.randomUUID() as ProcessorId, "Trim");
    this._fader = new GainProcessor(crypto.randomUUID() as ProcessorId);
    this._polarity = new PolarityProcessor(crypto.randomUUID() as ProcessorId);
    this._panner = new Panner(crypto.randomUUID() as ProcessorId);

    // Core strip processors are implicit "bridge" processors -- they are
    // not stored in the pre/post lists but appear in the `processors` getter.
  }

  /**
   * Adds a processor to the chain.
   * @param processor The processor to add
   * @param position 'pre' (before fader) or 'post' (after fader)
   * @param index Index within the specific chain (not global index)
   */
  public addProcessor(
    processor: Processor,
    position: "pre" | "post" = "pre",
    index?: number,
  ) {
    const targetList =
      position === "pre" ? this._preFaderProcessors : this._postFaderProcessors;

    if (index !== undefined && index >= 0 && index <= targetList.length) {
      targetList.splice(index, 0, processor);
    } else {
      targetList.push(processor);
    }

    // Subscribe to the processor's latency changes so we can propagate
    // total-latency updates to the session.
    this._subscribeToProcessorLatency(processor);

    // We emit the processor. Listeners (AudioEngine) will query `processors` getter
    // to find its global index, or we might need to update listeners if they need precise info.
    this.processorAdded.emit(processor);

    // Recompute route-level totals now that the chain has changed.
    this.updateLatencyCompensation();
  }

  public removeProcessor(id: ProcessorId) {
    // Check pre
    let index = this._preFaderProcessors.findIndex((p) => p.id === id);
    if (index !== -1) {
      this._preFaderProcessors.splice(index, 1);
      this._unsubscribeFromProcessorLatency(id);
      this.processorRemoved.emit(id);
      this.updateLatencyCompensation();
      return;
    }

    // Check post
    index = this._postFaderProcessors.findIndex((p) => p.id === id);
    if (index !== -1) {
      this._postFaderProcessors.splice(index, 1);
      this._unsubscribeFromProcessorLatency(id);
      this.processorRemoved.emit(id);
      this.updateLatencyCompensation();
      return;
    }
  }

  /**
   * Reorder a processor within the same chain (pre or post fader).
   */
  public reorderProcessor(id: ProcessorId, newIndex: number) {
    // Try pre-fader first
    let idx = this._preFaderProcessors.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const [proc] = this._preFaderProcessors.splice(idx, 1);
      const clampedIdx = Math.max(
        0,
        Math.min(newIndex, this._preFaderProcessors.length),
      );
      this._preFaderProcessors.splice(clampedIdx, 0, proc);
      return;
    }
    // Try post-fader
    idx = this._postFaderProcessors.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const [proc] = this._postFaderProcessors.splice(idx, 1);
      const clampedIdx = Math.max(
        0,
        Math.min(newIndex, this._postFaderProcessors.length),
      );
      this._postFaderProcessors.splice(clampedIdx, 0, proc);
      return;
    }
  }

  /**
   * Full ordered processor chain.
   *
   * Order: Trim -> [Pre-fader] -> Fader -> Polarity -> [Post-fader] -> Panner
   */
  public get processors(): ReadonlyArray<Processor> {
    return [
      this._trim,
      ...this._preFaderProcessors,
      this._fader,
      this._polarity,
      ...this._postFaderProcessors,
      this._panner,
    ];
  }

  public get preFaderProcessors(): ReadonlyArray<Processor> {
    return this._preFaderProcessors;
  }

  public get postFaderProcessors(): ReadonlyArray<Processor> {
    return this._postFaderProcessors;
  }

  // ── Legacy / Convenience Accessors ───────────────────────────────────────

  public get volume(): number {
    return this._fader.gain;
  }

  public set volume(db: number) {
    this._fader.gain = db;
  }

  public get pan(): number {
    return this._panner.azimuth;
  }

  public set pan(val: number) {
    this._panner.setAzimuth(val);
  }

  /**
   * Input trim gain in dB.
   * Used for pre-fader level correction (e.g. mic preamp adjustment).
   */
  public get trim(): number {
    return this._trim.gain;
  }

  public set trim(db: number) {
    this._trim.gain = db;
  }

  public get active(): boolean {
    return this._active;
  }

  public set active(value: boolean) {
    this._active = value;
  }

  // ── Direct access to core processors ─────────────────────────────────────

  /** Input trim gain processor. */
  public get trimProcessor(): GainProcessor {
    return this._trim;
  }
  /** Main channel fader. */
  public get fader(): GainProcessor {
    return this._fader;
  }
  /** Polarity (phase inversion) processor. */
  public get polarity(): PolarityProcessor {
    return this._polarity;
  }
  /** Channel panner. */
  public get panner(): Panner {
    return this._panner;
  }

  // ── Latency Compensation (D-5) ──────────────────────────────────────────

  /**
   * Sum of latencies (in samples) introduced by all processors in this route.
   *
   * This represents the total processing delay that audio experiences as it
   * passes through the signal chain.  Used by the session to compute
   * per-route compensation delays so that all routes stay time-aligned.
   */
  public getProcessorLatency(): number {
    let total = 0;
    for (const proc of this.processors) {
      total += proc.getLatency();
    }
    return total;
  }

  /**
   * Alias for {@link getProcessorLatency} — returns the total latency
   * (in samples) across every processor in the chain.
   */
  public getTotalLatency(): number {
    return this.getProcessorLatency();
  }

  /**
   * Returns the maximum tail length (in frames) across all processors in
   * this route.
   *
   * The tail length represents the duration of audio "tail" that persists
   * after input ceases (e.g. reverb decay, delay feedback).  The engine
   * uses this value to know how long to keep processing after playback
   * stops.
   */
  public getTotalTailLength(): number {
    let maxTail = 0;
    for (const proc of this.processors) {
      const tail = proc.getEffectiveTailLength();
      if (tail > maxTail) {
        maxTail = tail;
      }
    }
    return maxTail;
  }

  /**
   * The current compensation delay applied to this route (in samples).
   *
   * The value is set by the session / engine after evaluating all routes.
   * A route with lower inherent latency gets a larger compensation delay
   * so that every route's effective latency equals the session maximum.
   */
  public get compensationDelay(): number {
    return this._compensationDelay;
  }

  /**
   * Recalculate the route-level latency total and emit {@link latencyChanged}
   * when it differs from the previous value.  Also syncs the
   * {@link latencyCompensator} delay with {@link _compensationDelay}.
   *
   * Called automatically whenever a processor is added / removed or any
   * processor's latency changes.
   */
  public updateLatencyCompensation(): void {
    const total = this.getProcessorLatency();
    this.latencyCompensator.setDelay(this._compensationDelay);
    this.latencyChanged.emit(total);
  }

  /**
   * Directly set the compensation delay for this route.
   * @param samples Delay in samples (>= 0).
   */
  public setCompensationDelay(samples: number): void {
    this._compensationDelay = Math.max(0, samples);
    this.latencyCompensator.setDelay(this._compensationDelay);
  }

  /**
   * Compute the compensation delay needed for this route given the
   * maximum latency across the entire session.
   *
   * Call this once per route after determining `maxLatency` via
   * `Math.max(...routes.map(r => r.getProcessorLatency()))`.
   *
   * @param maxLatency The highest processor latency among all routes (in samples).
   */
  public computeLatencyCompensation(maxLatency?: number): void {
    if (maxLatency !== undefined) {
      const ownLatency = this.getTotalLatency();
      this._compensationDelay = Math.max(0, maxLatency - ownLatency);
    } else {
      // Self-contained: compensation is based solely on this route's
      // own latency (useful when a single route needs to report its
      // internal compensation requirement).
      this._compensationDelay = this.getTotalLatency();
    }
    this.latencyCompensator.setDelay(this._compensationDelay);
  }

  // ── Private: processor latency subscriptions ────────────────────────────

  private _subscribeToProcessorLatency(processor: Processor): void {
    const sub = processor.latencyChanged.connect(() => {
      this.updateLatencyCompensation();
    });
    this._latencySubscriptions.set(processor.id, sub);
  }

  private _unsubscribeFromProcessorLatency(id: ProcessorId): void {
    const sub = this._latencySubscriptions.get(id);
    if (sub) {
      sub.dispose();
      this._latencySubscriptions.delete(id);
    }
  }
}
