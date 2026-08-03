import type { FrameCount } from "@daw-engine/core";
import { Signal } from "@daw-engine/core";
import type { TimelineViewport } from "../viewport/TimelineViewport";

// ---------------------------------------------------------------------------
// PlayheadTracker
// ---------------------------------------------------------------------------

/**
 * Tracks the transport position via `requestAnimationFrame` and converts
 * the current frame into a pixel X coordinate.
 *
 * Framework-agnostic — connect to the `moved` signal to drive your UI.
 *
 * ```ts
 * const tracker = new PlayheadTracker(viewport, () => engine.session.transportFrame);
 * tracker.moved.connect(({ frame, x }) => {
 *     playheadEl.style.transform = `translateX(${x}px)`;
 * });
 * tracker.start();
 * ```
 */
export class PlayheadTracker {
  /** Emitted on each animation frame with the current position. */
  public readonly moved = new Signal<{ frame: FrameCount; x: number }>();

  private _viewport: TimelineViewport;
  private _getFrame: () => FrameCount;
  private _rafId: number | null = null;
  private _followPlayhead: boolean = false;

  /**
   * @param viewport   The timeline viewport for frame → pixel conversion.
   * @param getFrame   A callback that returns the current transport frame.
   *                   Typically `() => engine.session.transportFrame`.
   */
  constructor(viewport: TimelineViewport, getFrame: () => FrameCount) {
    this._viewport = viewport;
    this._getFrame = getFrame;
  }

  get isRunning(): boolean {
    return this._rafId !== null;
  }

  /** When true, the viewport will auto-scroll to keep the playhead visible. */
  get followPlayhead(): boolean {
    return this._followPlayhead;
  }
  set followPlayhead(value: boolean) {
    this._followPlayhead = value;
  }

  /** Start the animation loop. */
  start(): void {
    if (this._rafId !== null) return;
    const tick = () => {
      const frame = this._getFrame();
      const x = this._viewport.frameToViewportPixel(frame);

      if (this._followPlayhead) {
        this._viewport.scrollToFrame(frame);
      }

      this.moved.emit({ frame, x });
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  /** Stop the animation loop. */
  stop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Dispose the tracker and release resources. */
  dispose(): void {
    this.stop();
    this.moved.clear();
  }
}
