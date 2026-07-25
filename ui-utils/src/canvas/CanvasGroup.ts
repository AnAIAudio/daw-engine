/**
 * CanvasGroup — Container item that manages child ordering and rendering.
 *
 * Children are rendered in list order (index 0 = back, last = front).
 */

import { CanvasItem } from "./CanvasItem";
import type { Rect, Point } from "./types";
import { rectUnion, EMPTY_RECT, rectsIntersect } from "./types";

export class CanvasGroup extends CanvasItem {
  private _children: CanvasItem[] = [];

  // ── Child management ──────────────────────────────────────────────────

  get children(): ReadonlyArray<CanvasItem> {
    return this._children;
  }
  get childCount(): number {
    return this._children.length;
  }

  addChild(item: CanvasItem): void {
    if (item.parent === this) return;
    if (item.parent) {
      (item.parent as CanvasGroup).removeChild(item);
    }
    this._children.push(item);
    item._setParent(this);
    this.invalidateBbox();
    this._lookupDirty = true;
  }

  removeChild(item: CanvasItem): void {
    const idx = this._children.indexOf(item);
    if (idx === -1) return;
    this.beginChange();
    this._children.splice(idx, 1);
    item._setParent(null);
    this._lookupDirty = true;
    this.invalidateBbox();
    this.endChange();
  }

  removeAllChildren(): void {
    if (this._children.length === 0) return;
    this.beginChange();
    for (const child of this._children) child._setParent(null);
    this._children = [];
    this._lookupDirty = true;
    this.invalidateBbox();
    this.endChange();
  }

  // ── Z-order ───────────────────────────────────────────────────────────

  raiseToTop(item: CanvasItem): void {
    const idx = this._children.indexOf(item);
    if (idx === -1 || idx === this._children.length - 1) return;
    this._children.splice(idx, 1);
    this._children.push(item);
    this.invalidateBbox();
  }

  lowerToBottom(item: CanvasItem): void {
    const idx = this._children.indexOf(item);
    if (idx <= 0) return;
    this._children.splice(idx, 1);
    this._children.unshift(item);
    this.invalidateBbox();
  }

  // ── Bounding box ──────────────────────────────────────────────────────

  protected computeBbox(): Rect {
    let result: Rect | null = null;
    for (const child of this._children) {
      if (!child.visible) continue;
      const cb = child.bbox;
      if (cb.width === 0 && cb.height === 0) continue;
      // Convert child bbox to group-local coords
      const pos = child.position;
      const childRectInGroup: Rect = {
        x: cb.x + pos.x,
        y: cb.y + pos.y,
        width: cb.width,
        height: cb.height,
      };
      result = result ? rectUnion(result, childRectInGroup) : childRectInGroup;
    }
    return result ?? EMPTY_RECT;
  }

  // ── Hit testing ───────────────────────────────────────────────────────

  /**
   * Find the topmost child (highest index) that covers the given canvas point.
   * Returns null if no child is hit.
   */
  hitTestChildren(canvasPoint: Point): CanvasItem | null {
    // Iterate back-to-front (topmost first)
    for (let i = this._children.length - 1; i >= 0; i--) {
      const child = this._children[i];
      if (!child.visible || child.ignoreEvents) continue;

      // Recurse into nested groups
      if (child instanceof CanvasGroup) {
        const result = child.hitTestChildren(canvasPoint);
        if (result) return result;
      }

      if (child.covers(canvasPoint)) {
        return child;
      }
    }
    return null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  render(ctx: CanvasRenderingContext2D, visibleRect: Rect): void {
    if (!this.visible) return;

    for (const child of this._children) {
      if (!child.visible) continue;

      // Cull: skip children whose canvas bbox doesn't intersect the visible rect
      const cBbox = child.canvasBbox;
      if (
        cBbox.width > 0 &&
        cBbox.height > 0 &&
        !rectsIntersect(cBbox, visibleRect)
      ) {
        continue;
      }

      // Translate context to child's position
      const pos = child.position;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      child.render(ctx, visibleRect);
      ctx.restore();
    }
  }

  // ── Change notification from children ─────────────────────────────────
  private _lookupDirty = false;
  private _onChangeCallback:
    ((item: CanvasItem, pre: Rect | null, post: Rect) => void) | null = null;

  /** Set a callback for child change notifications (used by SceneGraph). */
  setChangeCallback(
    cb: (item: CanvasItem, pre: Rect | null, post: Rect) => void,
  ): void {
    this._onChangeCallback = cb;
  }

  /** @internal Called by CanvasItem.endChange() */
  _onChildChanged(
    item: CanvasItem,
    preBbox: Rect | null,
    postBbox: Rect,
  ): void {
    this._lookupDirty = true;
    this.invalidateBbox();

    // Propagate up to scene graph root
    if (this._onChangeCallback) {
      this._onChangeCallback(item, preBbox, postBbox);
    } else if (this.parent && "_onChildChanged" in this.parent) {
      (this.parent as CanvasGroup)._onChildChanged(item, preBbox, postBbox);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  override dispose(): void {
    for (const child of this._children) child.dispose();
    this._children = [];
    this._onChangeCallback = null;
    super.dispose();
  }
}
