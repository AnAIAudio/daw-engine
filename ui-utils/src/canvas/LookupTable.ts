/**
 * LookupTable — Grid-based spatial index for O(1) hit testing.
 *
 * Divides the canvas into a grid of cells. Each cell stores references
 * to items whose bounding boxes overlap it. Point queries map to a cell
 * in O(1), then iterate the (short) item list in that cell.
 */

import type { CanvasItem } from "./CanvasItem";
import type { Rect, Point } from "./types";
import { rectsIntersect } from "./types";

const DEFAULT_CELL_SIZE = 64;

export class LookupTable {
  private _cellSize: number;
  private _cells = new Map<string, Set<CanvasItem>>();
  private _itemCells = new Map<CanvasItem, string[]>();
  private _dirty = false;

  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    this._cellSize = cellSize;
  }

  // ── Cell key helpers ──────────────────────────────────────────────────

  private _cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private _getCellCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this._cellSize), Math.floor(y / this._cellSize)];
  }

  private _getCellRange(r: Rect): {
    minCx: number;
    minCy: number;
    maxCx: number;
    maxCy: number;
  } {
    return {
      minCx: Math.floor(r.x / this._cellSize),
      minCy: Math.floor(r.y / this._cellSize),
      maxCx: Math.floor((r.x + r.width) / this._cellSize),
      maxCy: Math.floor((r.y + r.height) / this._cellSize),
    };
  }

  // ── Item management ───────────────────────────────────────────────────

  add(item: CanvasItem): void {
    const bbox = item.canvasBbox;
    if (bbox.width === 0 && bbox.height === 0) return;

    const { minCx, minCy, maxCx, maxCy } = this._getCellRange(bbox);
    const keys: string[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this._cellKey(cx, cy);
        let cell = this._cells.get(key);
        if (!cell) {
          cell = new Set();
          this._cells.set(key, cell);
        }
        cell.add(item);
        keys.push(key);
      }
    }

    this._itemCells.set(item, keys);
  }

  remove(item: CanvasItem): void {
    const keys = this._itemCells.get(item);
    if (!keys) return;

    for (const key of keys) {
      const cell = this._cells.get(key);
      if (cell) {
        cell.delete(item);
        if (cell.size === 0) this._cells.delete(key);
      }
    }

    this._itemCells.delete(item);
  }

  /** Remove and re-add an item (call when its bbox changes). */
  update(item: CanvasItem): void {
    this.remove(item);
    this.add(item);
  }

  // ── Queries ───────────────────────────────────────────────────────────

  /** Find all items whose bbox overlaps the cell containing point (x, y). */
  queryPoint(p: Point): CanvasItem[] {
    const [cx, cy] = this._getCellCoords(p.x, p.y);
    const key = this._cellKey(cx, cy);
    const cell = this._cells.get(key);
    if (!cell) return [];
    return [...cell];
  }

  /** Find all items whose bbox overlaps the given rect. */
  queryRect(r: Rect): CanvasItem[] {
    const { minCx, minCy, maxCx, maxCy } = this._getCellRange(r);
    const seen = new Set<CanvasItem>();
    const result: CanvasItem[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this._cellKey(cx, cy);
        const cell = this._cells.get(key);
        if (!cell) continue;
        for (const item of cell) {
          if (seen.has(item)) continue;
          seen.add(item);
          // Fine-grained bbox check
          if (rectsIntersect(item.canvasBbox, r)) {
            result.push(item);
          }
        }
      }
    }

    return result;
  }

  // ── Bulk operations ───────────────────────────────────────────────────

  clear(): void {
    this._cells.clear();
    this._itemCells.clear();
  }

  /** Rebuild from a list of items. */
  rebuild(items: CanvasItem[]): void {
    this.clear();
    for (const item of items) {
      if (item.visible) this.add(item);
    }
    this._dirty = false;
  }

  get dirty(): boolean {
    return this._dirty;
  }
  markDirty(): void {
    this._dirty = true;
  }

  get itemCount(): number {
    return this._itemCells.size;
  }
  get cellCount(): number {
    return this._cells.size;
  }
}
