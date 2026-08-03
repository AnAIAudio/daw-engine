import type { TrackId } from "@daw-engine/core";
import { Signal } from "@daw-engine/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TRACK_HEIGHT = 80;
const MIN_TRACK_HEIGHT = 24;
const MAX_TRACK_HEIGHT = 500;

// ---------------------------------------------------------------------------
// TrackLayout
// ---------------------------------------------------------------------------

export interface TrackLayoutEntry {
  trackId: TrackId;
  y: number;
  height: number;
}

/**
 * Computes vertical positions for a list of tracks.
 *
 * ```ts
 * const layout = new TrackLayout();
 * layout.setTracks(['t1', 't2', 't3']);
 * layout.setTrackHeight('t1', 120);
 * const entry = layout.getEntry('t1'); // { trackId: 't1', y: 0, height: 120 }
 * const t2 = layout.getEntry('t2');    // { trackId: 't2', y: 120, height: 80 }
 * ```
 */
export class TrackLayout {
  public readonly changed = new Signal<void>();

  private _trackIds: TrackId[] = [];
  private _heights: Map<TrackId, number> = new Map();
  private _collapsed: Set<TrackId> = new Set();
  private _collapsedHeight: number = MIN_TRACK_HEIGHT;

  // Cached layout entries, invalidated on change.
  private _cache: TrackLayoutEntry[] | null = null;

  // ── Configuration ────────────────────────────────────────────────────

  /** Set the ordered list of track IDs (top to bottom). */
  setTracks(trackIds: TrackId[]): void {
    this._trackIds = trackIds;
    this._cache = null;
    this.changed.emit();
  }

  setTrackHeight(trackId: TrackId, height: number): void {
    const clamped = Math.max(
      MIN_TRACK_HEIGHT,
      Math.min(height, MAX_TRACK_HEIGHT),
    );
    if (this._heights.get(trackId) !== clamped) {
      this._heights.set(trackId, clamped);
      this._cache = null;
      this.changed.emit();
    }
  }

  getTrackHeight(trackId: TrackId): number {
    if (this._collapsed.has(trackId)) return this._collapsedHeight;
    return this._heights.get(trackId) ?? DEFAULT_TRACK_HEIGHT;
  }

  setCollapsed(trackId: TrackId, collapsed: boolean): void {
    const changed = collapsed
      ? !this._collapsed.has(trackId)
      : this._collapsed.has(trackId);
    if (!changed) return;
    if (collapsed) this._collapsed.add(trackId);
    else this._collapsed.delete(trackId);
    this._cache = null;
    this.changed.emit();
  }

  isCollapsed(trackId: TrackId): boolean {
    return this._collapsed.has(trackId);
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /** Get all layout entries (ordered top → bottom). */
  getEntries(): TrackLayoutEntry[] {
    if (this._cache) return this._cache;
    let y = 0;
    const entries: TrackLayoutEntry[] = [];
    for (const trackId of this._trackIds) {
      const height = this.getTrackHeight(trackId);
      entries.push({ trackId, y, height });
      y += height;
    }
    this._cache = entries;
    return entries;
  }

  /** Get layout entry for a specific track. */
  getEntry(trackId: TrackId): TrackLayoutEntry | undefined {
    return this.getEntries().find((e) => e.trackId === trackId);
  }

  /** Total height of all tracks. */
  get totalHeight(): number {
    const entries = this.getEntries();
    if (entries.length === 0) return 0;
    const last = entries[entries.length - 1];
    return last.y + last.height;
  }

  /** Find the track at a given Y coordinate. */
  getTrackAtY(y: number): TrackLayoutEntry | undefined {
    const entries = this.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (y >= entries[i].y) return entries[i];
    }
    return undefined;
  }
}
