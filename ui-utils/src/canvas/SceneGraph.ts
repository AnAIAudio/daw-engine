/**
 * SceneGraph — Root of the canvas scene graph.
 *
 * Owns the root CanvasGroup, LookupTable, and DirtyRectTracker.
 * Provides the main render() and hitTest() entry points.
 */

import { CanvasGroup } from "./CanvasGroup";
import { LookupTable } from "./LookupTable";
import { DirtyRectTracker } from "./DirtyRectTracker";
import type { CanvasItem } from "./CanvasItem";
import type { Rect, Point, HitTestResult } from "./types";
import { EMPTY_RECT } from "./types";

export class SceneGraph {
  public readonly root = new CanvasGroup();
  public readonly lookup = new LookupTable();
  public readonly dirtyTracker = new DirtyRectTracker();

  /** Scroll offset (canvas pixels). Items render at position - scroll. */
  private _scrollX = 0;
  private _scrollY = 0;

  constructor() {
    // Wire up change notifications from root group → dirty tracker
    this.root.setChangeCallback((item, preBbox, postBbox) => {
      if (preBbox) this.dirtyTracker.markDirty(preBbox);
      this.dirtyTracker.markDirty(postBbox);
      this.lookup.markDirty();
    });
  }

  // ── Scroll ────────────────────────────────────────────────────────────

  get scrollX(): number {
    return this._scrollX;
  }
  get scrollY(): number {
    return this._scrollY;
  }

  setScroll(x: number, y: number): void {
    if (this._scrollX === x && this._scrollY === y) return;
    this._scrollX = x;
    this._scrollY = y;
    this.dirtyTracker.markFullRedraw();
  }

  /** Convert window (viewport) coordinates to canvas coordinates. */
  windowToCanvas(p: Point): Point {
    return { x: p.x + this._scrollX, y: p.y + this._scrollY };
  }

  /** Convert canvas coordinates to window (viewport) coordinates. */
  canvasToWindow(p: Point): Point {
    return { x: p.x - this._scrollX, y: p.y - this._scrollY };
  }

  // ── Hit testing ───────────────────────────────────────────────────────

  /**
   * Find the topmost item at the given window-space point.
   */
  hitTest(windowPoint: Point): HitTestResult {
    const canvasPoint = this.windowToCanvas(windowPoint);
    const noHit: HitTestResult = { item: null, canvasPoint, itemPoint: null };

    // Use lookup table for candidate items
    if (this.lookup.dirty) {
      this._rebuildLookup();
    }

    const candidates = this.lookup.queryPoint(canvasPoint);
    if (candidates.length === 0) {
      // Fallback: try the root group's recursive hit test
      const item = this.root.hitTestChildren(canvasPoint);
      if (!item) return noHit;
      return {
        item,
        canvasPoint,
        itemPoint: item.canvasToItem(canvasPoint),
      };
    }

    // Find topmost (by checking render order — last in parent's children list = topmost)
    // For now, iterate candidates and use covers() check
    let topItem: CanvasItem | null = null;
    for (const candidate of candidates) {
      if (candidate.covers(canvasPoint)) {
        topItem = candidate; // later candidates may override (but candidates aren't ordered)
      }
    }

    if (!topItem) {
      // Candidates from LUT but none actually covers the exact point
      const item = this.root.hitTestChildren(canvasPoint);
      if (!item) return noHit;
      topItem = item;
    }

    return {
      item: topItem,
      canvasPoint,
      itemPoint: topItem.canvasToItem(canvasPoint),
    };
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /**
   * Render the scene graph to the given canvas context.
   *
   * @param ctx — 2D rendering context
   * @param viewportWidth — visible width in pixels
   * @param viewportHeight — visible height in pixels
   * @param forceFullRedraw — skip dirty-rect optimization
   */
  render(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    forceFullRedraw = false,
  ): void {
    // Rebuild lookup table if needed
    if (this.lookup.dirty) {
      this._rebuildLookup();
    }

    const visibleRect: Rect = {
      x: this._scrollX,
      y: this._scrollY,
      width: viewportWidth,
      height: viewportHeight,
    };

    const useDirtyRects =
      !forceFullRedraw && !this.dirtyTracker.needsFullRedraw;

    if (useDirtyRects && !this.dirtyTracker.hasDirty) {
      return; // Nothing changed, skip render entirely
    }

    ctx.save();

    if (useDirtyRects) {
      // Clip to dirty regions (in window coords)
      const clipped = this.dirtyTracker.applyClipping(ctx);
      if (clipped) {
        // Clear only dirty rects
        for (const r of this.dirtyTracker.getDirtyRects()) {
          const wx = r.x - this._scrollX;
          const wy = r.y - this._scrollY;
          ctx.clearRect(wx, wy, r.width, r.height);
        }
      }
    } else {
      // Full redraw
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    }

    // Translate to canvas space (scroll offset)
    ctx.translate(-this._scrollX, -this._scrollY);

    // Render root group (which recursively renders children)
    this.root.render(ctx, visibleRect);

    ctx.restore();

    // Reset dirty tracker for next frame
    this.dirtyTracker.reset();
  }

  // ── Lookup table management ───────────────────────────────────────────

  private _rebuildLookup(): void {
    const items = this._collectLeafItems(this.root);
    this.lookup.rebuild(items);
  }

  private _collectLeafItems(group: CanvasGroup): CanvasItem[] {
    const result: CanvasItem[] = [];
    for (const child of group.children) {
      if (!child.visible) continue;
      if (child instanceof CanvasGroup) {
        result.push(...this._collectLeafItems(child));
      } else {
        result.push(child);
      }
    }
    return result;
  }

  // ── Convenience ───────────────────────────────────────────────────────

  /** Request a full redraw on the next render call. */
  invalidate(): void {
    this.dirtyTracker.markFullRedraw();
  }

  /** Remove all items and reset state. */
  clear(): void {
    this.root.removeAllChildren();
    this.lookup.clear();
    this.dirtyTracker.reset();
  }

  dispose(): void {
    this.root.dispose();
    this.lookup.clear();
  }
}
