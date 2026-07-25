import { Signal } from "../../lib/Signal";

export interface XrunEvent {
  timestamp: number; // When the xrun occurred (Date.now())
  frame: number; // Frame position in session
  type: "underrun" | "overrun";
  duration?: number; // Estimated duration of the glitch in samples
}

/**
 * XrunTracker - Tracks buffer underrun/overrun events during recording
 * and playback. Provides signals for real-time notification and
 * query methods for post-session analysis.
 */
export class XrunTracker {
  private _events: XrunEvent[] = [];
  private _isTracking: boolean = false;
  private _totalXruns: number = 0;

  /** Signal emitted whenever an xrun is detected */
  public readonly xrunDetected: Signal<XrunEvent> = new Signal<XrunEvent>();

  /**
   * Start tracking xrun events.
   * Clears any previously recorded events.
   */
  startTracking(): void {
    this._isTracking = true;
  }

  /**
   * Stop tracking xrun events.
   */
  stopTracking(): void {
    this._isTracking = false;
  }

  /**
   * Record an xrun event.
   * Only records if tracking is active.
   * @param frame - The session frame position where the xrun occurred
   * @param type - Whether this was an underrun or overrun
   * @param duration - Optional estimated glitch duration in samples
   */
  reportXrun(
    frame: number,
    type: "underrun" | "overrun",
    duration?: number,
  ): void {
    if (!this._isTracking) return;

    const event: XrunEvent = {
      timestamp: Date.now(),
      frame,
      type,
      duration,
    };

    this._events.push(event);
    this._totalXruns++;
    this.xrunDetected.emit(event);
  }

  /**
   * Get all recorded xrun events.
   */
  getEvents(): XrunEvent[] {
    return [...this._events];
  }

  /**
   * Get all xrun events that occurred at or after the given frame.
   */
  getEventsSince(frame: number): XrunEvent[] {
    return this._events.filter((e) => e.frame >= frame);
  }

  /**
   * Get the total number of xruns recorded (persists across reset of events).
   */
  getTotalCount(): number {
    return this._totalXruns;
  }

  /**
   * Get the most recent xrun event, if any.
   */
  getLastEvent(): XrunEvent | undefined {
    return this._events.length > 0
      ? this._events[this._events.length - 1]
      : undefined;
  }

  /**
   * Check if any xruns have been recorded.
   */
  hasXruns(): boolean {
    return this._events.length > 0;
  }

  /**
   * Reset all tracked events and counters.
   */
  reset(): void {
    this._events = [];
    this._totalXruns = 0;
  }

  /**
   * Get a summary of all recorded xrun events.
   */
  getSummary(): {
    total: number;
    underruns: number;
    overruns: number;
    firstFrame?: number;
    lastFrame?: number;
  } {
    let underruns = 0;
    let overruns = 0;
    let firstFrame: number | undefined;
    let lastFrame: number | undefined;

    for (const event of this._events) {
      if (event.type === "underrun") {
        underruns++;
      } else {
        overruns++;
      }

      if (firstFrame === undefined || event.frame < firstFrame) {
        firstFrame = event.frame;
      }
      if (lastFrame === undefined || event.frame > lastFrame) {
        lastFrame = event.frame;
      }
    }

    return {
      total: this._events.length,
      underruns,
      overruns,
      firstFrame,
      lastFrame,
    };
  }
}
