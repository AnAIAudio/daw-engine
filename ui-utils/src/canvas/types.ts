/**
 * Core types for the Canvas scene graph.
 *
 * Coordinate spaces:
 *   Item   — origin at item's own position
 *   Parent — origin at parent item's position
 *   Canvas — global canvas coordinates (0,0 = top-left of full timeline)
 *   Window — viewport pixel coordinates (0,0 = visible top-left)
 */

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Rect utilities ────────────────────────────────────────────────────────────

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return (
    p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

// ── Hit testing ───────────────────────────────────────────────────────────────

export interface HitTestResult {
  /** The topmost item hit, or null if nothing was hit. */
  item: import("./CanvasItem").CanvasItem | null;
  /** Canvas-space coordinates of the hit point. */
  canvasPoint: Point;
  /** Item-local coordinates of the hit point. */
  itemPoint: Point | null;
}

// ── Render layers ─────────────────────────────────────────────────────────────

export enum RenderLayer {
  GRID = 0,
  REGION_BODY = 1,
  WAVEFORM = 2,
  FADE = 3,
  HANDLE = 4,
  OVERLAY = 5,
}
