import { Signal } from "@drop-ai/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InfiniteTimelineOptions {
  /** Initial timeline duration in seconds. */
  initialDuration: number;
  /** Seconds to extend when the edge is reached. */
  extendBy?: number;
  /** Distance in pixels from the right edge to trigger extension. */
  edgeThreshold?: number;
  /** Minimum duration in seconds (never shrink below this). */
  minDuration?: number;
}

// ---------------------------------------------------------------------------
// InfiniteTimeline
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic infinite/auto-extending timeline manager.
 *
 * Monitors scroll position relative to the timeline's total width and
 * automatically extends the duration when the user scrolls near the
 * right edge — or when the playhead approaches the end.
 *
 * ```ts
 * const inf = new InfiniteTimeline({ initialDuration: 120, extendBy: 30 });
 * inf.extended.connect((newDuration) => {
 *     store.setTimelineDuration(newDuration);
 * });
 *
 * // Call on every scroll event:
 * inf.checkScroll(scrollLeft, clientWidth, contentWidth);
 *
 * // Call on every playhead update:
 * inf.checkPlayhead(currentTimeSec);
 * ```
 */
export class InfiniteTimeline {
  /** Emitted when the timeline is extended, with the new duration. */
  public readonly extended = new Signal<number>();

  private _duration: number;
  private _extendBy: number;
  private _edgeThreshold: number;
  private _minDuration: number;

  /** Cooldown flag to prevent rapid repeated extensions. */
  private _extending: boolean = false;

  constructor(options: InfiniteTimelineOptions) {
    this._duration = options.initialDuration;
    this._extendBy = options.extendBy ?? 15;
    this._edgeThreshold = options.edgeThreshold ?? 200;
    this._minDuration = options.minDuration ?? 30;
  }

  // ── Getters ──────────────────────────────────────────────────────────

  get duration(): number {
    return this._duration;
  }
  get extendBy(): number {
    return this._extendBy;
  }
  get edgeThreshold(): number {
    return this._edgeThreshold;
  }

  // ── Setters ──────────────────────────────────────────────────────────

  setDuration(seconds: number): void {
    this._duration = Math.max(this._minDuration, seconds);
  }

  setExtendBy(seconds: number): void {
    this._extendBy = Math.max(1, seconds);
  }

  setEdgeThreshold(pixels: number): void {
    this._edgeThreshold = Math.max(0, pixels);
  }

  // ── Scroll-based extension ──────────────────────────────────────────

  /**
   * Check whether the scroll position is near the right edge.
   * Call this from scroll event handlers.
   *
   * @param scrollLeft   Current horizontal scroll offset.
   * @param clientWidth  Visible width of the scroll container.
   * @param contentWidth Total scrollable content width.
   * @returns `true` if the timeline was extended.
   */
  checkScroll(
    scrollLeft: number,
    clientWidth: number,
    contentWidth: number,
  ): boolean {
    if (this._extending) return false;

    const distanceToEnd = contentWidth - clientWidth - scrollLeft;
    if (distanceToEnd < this._edgeThreshold) {
      return this._extend();
    }
    return false;
  }

  // ── Playhead-based extension ────────────────────────────────────────

  /**
   * Check whether the playhead is approaching the end of the timeline.
   * Call this from the playhead animation loop.
   *
   * @param currentTimeSec  Current playhead position in seconds.
   * @param bufferSec       Seconds of buffer before the end to trigger (default: 5).
   * @returns `true` if the timeline was extended.
   */
  checkPlayhead(currentTimeSec: number, bufferSec: number = 5): boolean {
    if (this._extending) return false;

    if (currentTimeSec >= this._duration - bufferSec) {
      return this._extend();
    }
    return false;
  }

  // ── Internals ────────────────────────────────────────────────────────

  private _extend(): boolean {
    this._extending = true;
    this._duration += this._extendBy;
    this.extended.emit(this._duration);

    // Debounce: prevent further extensions for a short period.
    // Use setTimeout for framework-agnostic compatibility.
    setTimeout(() => {
      this._extending = false;
    }, 100);

    return true;
  }
}
