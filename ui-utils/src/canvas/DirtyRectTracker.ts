/**
 * DirtyRectTracker — Tracks changed regions for incremental rendering.
 *
 * When items change, their old and new bounding boxes are marked dirty.
 * On render, the tracker returns a merged set of dirty rects for clip-based
 * partial repainting. If too many rects accumulate, falls back to full redraw.
 */

import type { Rect } from "./types";
import { rectUnion } from "./types";

const MAX_DIRTY_RECTS = 20;

export class DirtyRectTracker {
  private _rects: Rect[] = [];
  private _fullRedraw = true;

  /** Mark a rectangle as needing repaint. */
  markDirty(rect: Rect): void {
    if (rect.width <= 0 || rect.height <= 0) return;

    if (this._rects.length >= MAX_DIRTY_RECTS) {
      // Too many rects — just do a full redraw
      this._fullRedraw = true;
      this._rects = [];
      return;
    }

    // Try to merge with an existing rect if they overlap significantly
    for (let i = 0; i < this._rects.length; i++) {
      const existing = this._rects[i];
      const merged = rectUnion(existing, rect);
      const mergedArea = merged.width * merged.height;
      const sumArea =
        existing.width * existing.height + rect.width * rect.height;
      // Merge if the union isn't much bigger than the sum (< 1.5x)
      if (mergedArea < sumArea * 1.5) {
        this._rects[i] = merged;
        return;
      }
    }

    this._rects.push(rect);
  }

  /** Request a full canvas redraw on next render. */
  markFullRedraw(): void {
    this._fullRedraw = true;
    this._rects = [];
  }

  /** Whether a full redraw is needed (no clipping optimization). */
  get needsFullRedraw(): boolean {
    return this._fullRedraw;
  }

  /** Whether any dirty rects exist (or full redraw is needed). */
  get hasDirty(): boolean {
    return this._fullRedraw || this._rects.length > 0;
  }

  /** Get the current dirty rects. Empty if fullRedraw is set. */
  getDirtyRects(): ReadonlyArray<Rect> {
    return this._rects;
  }

  /**
   * Apply dirty rects as clip regions on the canvas context.
   * Returns true if clipping was applied, false if full redraw is needed.
   */
  applyClipping(ctx: CanvasRenderingContext2D): boolean {
    if (this._fullRedraw || this._rects.length === 0) {
      return false; // caller should do full redraw
    }

    ctx.save();
    ctx.beginPath();
    for (const r of this._rects) {
      ctx.rect(r.x, r.y, r.width, r.height);
    }
    ctx.clip();
    return true;
  }

  /** Clear all dirty state after rendering. */
  reset(): void {
    this._rects = [];
    this._fullRedraw = false;
  }
}
