import { Signal } from "@anaidev/daw-engine-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VirtualItem {
  /** Index in the source list. */
  index: number;
  /** Offset in pixels from the start of the container. */
  offset: number;
  /** Size (width or height) in pixels. */
  size: number;
}

export interface VirtualScrollOptions {
  /** Total number of items. */
  itemCount: number;
  /** Returns the size of item at the given index. */
  itemSize: (index: number) => number;
  /** Number of extra items to render beyond the visible window. */
  overscan?: number;
}

// ---------------------------------------------------------------------------
// VirtualScroll
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic virtual scroll engine.
 *
 * Computes which items are visible within a scrollable viewport, plus an
 * overscan buffer. Only those items need to be rendered — everything else
 * is replaced by spacers.
 *
 * Works for both vertical (tracks) and horizontal (regions) virtualisation.
 *
 * ```ts
 * const vs = new VirtualScroll({
 *     itemCount: tracks.length,
 *     itemSize: (i) => trackHeights[i] ?? 80,
 *     overscan: 3,
 * });
 * vs.setViewportSize(600);
 * vs.setScrollOffset(0);
 * const items = vs.getVisibleItems(); // only the items in view
 * ```
 */
export class VirtualScroll {
  /** Emitted when visible items change. */
  public readonly changed = new Signal<void>();

  private _itemCount: number;
  private _itemSize: (index: number) => number;
  private _overscan: number;
  private _viewportSize: number = 0;
  private _scrollOffset: number = 0;

  // Cache
  private _offsets: number[] | null = null;
  private _totalSize: number = 0;
  private _visibleItems: VirtualItem[] | null = null;

  constructor(options: VirtualScrollOptions) {
    this._itemCount = options.itemCount;
    this._itemSize = options.itemSize;
    this._overscan = options.overscan ?? 3;
    this._invalidateOffsets();
  }

  // ── Getters ──────────────────────────────────────────────────────────

  get itemCount(): number {
    return this._itemCount;
  }
  get viewportSize(): number {
    return this._viewportSize;
  }
  get scrollOffset(): number {
    return this._scrollOffset;
  }

  /** Total size of all items in pixels. */
  get totalSize(): number {
    return this._totalSize;
  }

  // ── Setters ──────────────────────────────────────────────────────────

  setItemCount(count: number): void {
    if (this._itemCount !== count) {
      this._itemCount = count;
      this._invalidateOffsets();
      this._invalidateVisible();
      this.changed.emit();
    }
  }

  setItemSize(fn: (index: number) => number): void {
    this._itemSize = fn;
    this._invalidateOffsets();
    this._invalidateVisible();
    this.changed.emit();
  }

  setOverscan(overscan: number): void {
    if (this._overscan !== overscan) {
      this._overscan = overscan;
      this._invalidateVisible();
      this.changed.emit();
    }
  }

  setViewportSize(size: number): void {
    if (this._viewportSize !== size) {
      this._viewportSize = size;
      this._invalidateVisible();
      this.changed.emit();
    }
  }

  setScrollOffset(offset: number): void {
    const clamped = Math.max(
      0,
      Math.min(offset, Math.max(0, this._totalSize - this._viewportSize)),
    );
    if (this._scrollOffset !== clamped) {
      this._scrollOffset = clamped;
      this._invalidateVisible();
      this.changed.emit();
    }
  }

  /** Force recalculation (e.g. after item sizes change). */
  invalidate(): void {
    this._invalidateOffsets();
    this._invalidateVisible();
    this.changed.emit();
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /** Get items that should be rendered (visible + overscan). */
  getVisibleItems(): VirtualItem[] {
    if (this._visibleItems) return this._visibleItems;

    const offsets = this._getOffsets();
    if (offsets.length === 0) {
      this._visibleItems = [];
      return this._visibleItems;
    }

    const start = this._scrollOffset;
    const end = this._scrollOffset + this._viewportSize;

    // Binary search for first visible item
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] + this._itemSize(mid) <= start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const firstVisible = Math.max(0, lo - this._overscan);

    // Find last visible
    let lastVisible = lo;
    while (lastVisible < offsets.length && offsets[lastVisible] < end) {
      lastVisible++;
    }
    lastVisible = Math.min(offsets.length - 1, lastVisible + this._overscan);

    const items: VirtualItem[] = [];
    for (let i = firstVisible; i <= lastVisible; i++) {
      items.push({
        index: i,
        offset: offsets[i],
        size: this._itemSize(i),
      });
    }

    this._visibleItems = items;
    return items;
  }

  /** Offset (in pixels) before the first rendered item. */
  get startPadding(): number {
    const items = this.getVisibleItems();
    return items.length > 0 ? items[0].offset : 0;
  }

  /** Offset (in pixels) after the last rendered item. */
  get endPadding(): number {
    const items = this.getVisibleItems();
    if (items.length === 0) return 0;
    const last = items[items.length - 1];
    return Math.max(0, this._totalSize - (last.offset + last.size));
  }

  /** Find the item at a given offset. */
  getItemAtOffset(offset: number): VirtualItem | undefined {
    const offsets = this._getOffsets();
    for (let i = offsets.length - 1; i >= 0; i--) {
      if (offset >= offsets[i]) {
        return { index: i, offset: offsets[i], size: this._itemSize(i) };
      }
    }
    return undefined;
  }

  // ── Internals ────────────────────────────────────────────────────────

  private _getOffsets(): number[] {
    if (this._offsets) return this._offsets;

    const offsets: number[] = new Array(this._itemCount);
    let cumulative = 0;
    for (let i = 0; i < this._itemCount; i++) {
      offsets[i] = cumulative;
      cumulative += this._itemSize(i);
    }
    this._offsets = offsets;
    this._totalSize = cumulative;
    return offsets;
  }

  private _invalidateOffsets(): void {
    this._offsets = null;
    this._totalSize = 0;
    // Force recalculation
    this._getOffsets();
  }

  private _invalidateVisible(): void {
    this._visibleItems = null;
  }
}
