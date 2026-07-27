import type { FrameCount } from "@anaidev/daw-engine-core";
import { Signal } from "@anaidev/daw-engine-core";
import { ZoomFocus } from "@anaidev/daw-engine-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_PPS = 1;
const MAX_PPS = 1000;
const DEFAULT_PPS = 50;
const ZOOM_FACTOR = 1.5;

// ---------------------------------------------------------------------------
// TimelineViewport
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic timeline viewport state.
 *
 * Manages zoom level (`pixelsPerSecond`), horizontal scroll offset, and
 * provides frame ↔ pixel conversion utilities needed by every DAW UI:
 * waveform rendering, region positioning, playhead location, ruler ticks, etc.
 *
 * ```ts
 * const vp = new TimelineViewport(44100);
 * vp.changed.connect(() => render());
 * vp.setPixelsPerSecond(100);
 * const px = vp.frameToPixel(44100); // → 100
 * ```
 */
export class TimelineViewport {
  /** Emitted whenever pixelsPerSecond or scrollX changes. */
  public readonly changed = new Signal<void>();

  private _sampleRate: number;
  private _pixelsPerSecond: number = DEFAULT_PPS;
  /** Horizontal scroll offset in pixels. */
  private _scrollX: number = 0;
  /** Total duration of the session in seconds. */
  private _duration: number = 0;
  /** Visible width of the viewport in pixels. */
  private _viewportWidth: number = 0;

  constructor(sampleRate: number) {
    this._sampleRate = sampleRate;
  }

  // ── Getters ──────────────────────────────────────────────────────────

  get sampleRate(): number {
    return this._sampleRate;
  }
  get pixelsPerSecond(): number {
    return this._pixelsPerSecond;
  }
  get scrollX(): number {
    return this._scrollX;
  }
  get duration(): number {
    return this._duration;
  }
  get viewportWidth(): number {
    return this._viewportWidth;
  }

  /** Frames per pixel — useful for peak resolution selection. */
  get framesPerPixel(): number {
    return this._sampleRate / this._pixelsPerSecond;
  }

  /** Total content width in pixels. */
  get contentWidth(): number {
    return this._duration * this._pixelsPerSecond;
  }

  /** The first visible frame at the current scroll position. */
  get visibleStartFrame(): FrameCount {
    return this.pixelToFrame(this._scrollX);
  }

  /** The last visible frame at the current scroll position. */
  get visibleEndFrame(): FrameCount {
    return this.pixelToFrame(this._scrollX + this._viewportWidth);
  }

  // ── Setters ──────────────────────────────────────────────────────────

  setSampleRate(sampleRate: number): void {
    if (this._sampleRate !== sampleRate) {
      this._sampleRate = sampleRate;
      this.changed.emit();
    }
  }

  setDuration(seconds: number): void {
    if (this._duration !== seconds) {
      this._duration = seconds;
      this.changed.emit();
    }
  }

  setViewportWidth(pixels: number): void {
    if (this._viewportWidth !== pixels) {
      this._viewportWidth = pixels;
      this.changed.emit();
    }
  }

  setPixelsPerSecond(pps: number): void {
    const clamped = Math.max(MIN_PPS, Math.min(pps, MAX_PPS));
    if (this._pixelsPerSecond !== clamped) {
      this._pixelsPerSecond = clamped;
      this.changed.emit();
    }
  }

  setScrollX(px: number): void {
    const clamped = Math.max(
      0,
      Math.min(px, Math.max(0, this.contentWidth - this._viewportWidth)),
    );
    if (this._scrollX !== clamped) {
      this._scrollX = clamped;
      this.changed.emit();
    }
  }

  // ── Zoom ─────────────────────────────────────────────────────────────

  /**
   * Zoom in/out while keeping the given anchor stable on screen.
   *
   * @param direction  Positive = zoom in, negative = zoom out.
   * @param focus      Where the zoom should be anchored.
   * @param anchorPx   Pixel position of the mouse (for ZoomFocus.MOUSE).
   * @param playheadFrame Current transport frame (for ZoomFocus.PLAYHEAD).
   */
  zoom(
    direction: number,
    focus: ZoomFocus = ZoomFocus.LEFT,
    anchorPx?: number,
    playheadFrame?: FrameCount,
  ): void {
    const factor = direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const newPps = Math.max(
      MIN_PPS,
      Math.min(this._pixelsPerSecond * factor, MAX_PPS),
    );
    if (newPps === this._pixelsPerSecond) return;

    // Determine anchor point in seconds
    let anchorSec: number;
    switch (focus) {
      case ZoomFocus.MOUSE:
        anchorSec = (this._scrollX + (anchorPx ?? 0)) / this._pixelsPerSecond;
        break;
      case ZoomFocus.PLAYHEAD:
        anchorSec = (playheadFrame ?? 0) / this._sampleRate;
        break;
      case ZoomFocus.CENTER:
        anchorSec =
          (this._scrollX + this._viewportWidth / 2) / this._pixelsPerSecond;
        break;
      case ZoomFocus.RIGHT:
        anchorSec =
          (this._scrollX + this._viewportWidth) / this._pixelsPerSecond;
        break;
      case ZoomFocus.EDIT_POINT:
      case ZoomFocus.LEFT:
      default:
        anchorSec = this._scrollX / this._pixelsPerSecond;
        break;
    }

    // Compute where the anchor would land after zoom
    const anchorRatio =
      anchorPx !== undefined
        ? anchorPx / this._viewportWidth
        : focus === ZoomFocus.CENTER
          ? 0.5
          : focus === ZoomFocus.RIGHT
            ? 1
            : 0;

    const oldPps = this._pixelsPerSecond;
    this._pixelsPerSecond = newPps;

    // Adjust scroll to keep anchor visually stable
    const newAnchorPx = anchorSec * newPps;
    this._scrollX = Math.max(
      0,
      newAnchorPx - anchorRatio * this._viewportWidth,
    );

    if (oldPps !== this._pixelsPerSecond) {
      this.changed.emit();
    }
  }

  zoomIn(
    focus?: ZoomFocus,
    anchorPx?: number,
    playheadFrame?: FrameCount,
  ): void {
    this.zoom(1, focus, anchorPx, playheadFrame);
  }

  zoomOut(
    focus?: ZoomFocus,
    anchorPx?: number,
    playheadFrame?: FrameCount,
  ): void {
    this.zoom(-1, focus, anchorPx, playheadFrame);
  }

  /** Zoom to fit the entire session duration in the viewport. */
  zoomToFit(): void {
    if (this._duration <= 0 || this._viewportWidth <= 0) return;
    this._pixelsPerSecond = Math.max(
      MIN_PPS,
      Math.min(this._viewportWidth / this._duration, MAX_PPS),
    );
    this._scrollX = 0;
    this.changed.emit();
  }

  /** Zoom to show the given frame range. */
  zoomToRange(startFrame: FrameCount, endFrame: FrameCount): void {
    if (this._viewportWidth <= 0) return;
    const durationSec = (endFrame - startFrame) / this._sampleRate;
    if (durationSec <= 0) return;
    this._pixelsPerSecond = Math.max(
      MIN_PPS,
      Math.min(this._viewportWidth / durationSec, MAX_PPS),
    );
    this._scrollX = (startFrame / this._sampleRate) * this._pixelsPerSecond;
    this.changed.emit();
  }

  // ── Frame ↔ Pixel conversion ─────────────────────────────────────────

  /** Convert an absolute frame position to a pixel X offset (relative to content origin). */
  frameToPixel(frame: FrameCount): number {
    return (frame / this._sampleRate) * this._pixelsPerSecond;
  }

  /** Convert a pixel X offset (relative to content origin) to a frame position. */
  pixelToFrame(px: number): FrameCount {
    return (px / this._pixelsPerSecond) * this._sampleRate;
  }

  /** Convert a frame to a pixel offset relative to the visible viewport. */
  frameToViewportPixel(frame: FrameCount): number {
    return this.frameToPixel(frame) - this._scrollX;
  }

  /** Convert a viewport-relative pixel to an absolute frame. */
  viewportPixelToFrame(px: number): FrameCount {
    return this.pixelToFrame(px + this._scrollX);
  }

  /** Convert a duration in frames to a width in pixels. */
  framesToWidth(frames: FrameCount): number {
    return (frames / this._sampleRate) * this._pixelsPerSecond;
  }

  /** Convert a width in pixels to a duration in frames. */
  widthToFrames(px: number): FrameCount {
    return (px / this._pixelsPerSecond) * this._sampleRate;
  }

  // ── Scroll helpers ───────────────────────────────────────────────────

  /** Scroll so the given frame is visible, optionally centered. */
  scrollToFrame(frame: FrameCount, center: boolean = false): void {
    const px = this.frameToPixel(frame);
    if (center) {
      this.setScrollX(px - this._viewportWidth / 2);
    } else if (px < this._scrollX) {
      this.setScrollX(px);
    } else if (px > this._scrollX + this._viewportWidth) {
      this.setScrollX(px - this._viewportWidth);
    }
  }

  /** Returns true if the given frame is within the visible viewport. */
  isFrameVisible(frame: FrameCount): boolean {
    const px = this.frameToPixel(frame);
    return px >= this._scrollX && px <= this._scrollX + this._viewportWidth;
  }
}
