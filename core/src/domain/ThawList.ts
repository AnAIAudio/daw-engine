import { Signal } from "../lib/Signal";

/**
 * ThawList - Defers signal emissions during batch operations.
 * Collects change notifications and emits them all at once when thawed.
 */
export class ThawList {
  private _frozen: boolean = false;
  private _pendingEmissions: Array<{ signal: Signal<any>; data: any }> = [];
  private _changeCount: number = 0;

  // ─── Freeze / Thaw ──────────────────────────────────────────────────────

  /** Freeze: begin collecting emissions instead of firing them immediately. */
  public freeze(): void {
    this._frozen = true;
  }

  /**
   * Thaw: emit all pending signals that were queued while frozen,
   * then reset to the unfrozen state.
   */
  public thaw(): void {
    this._frozen = false;
    const pending = [...this._pendingEmissions];
    this._pendingEmissions = [];
    for (const { signal, data } of pending) {
      signal.emit(data);
    }
  }

  /** Whether the ThawList is currently frozen. */
  public isFrozen(): boolean {
    return this._frozen;
  }

  // ─── Emission Queuing ───────────────────────────────────────────────────

  /**
   * Queue an emission. If frozen, the emission is stored and will be
   * fired when {@link thaw} is called. If not frozen, the signal is
   * emitted immediately.
   */
  public queueEmission<T>(signal: Signal<T>, data: T): void {
    this._changeCount++;
    if (this._frozen) {
      this._pendingEmissions.push({ signal, data });
    } else {
      signal.emit(data);
    }
  }

  // ─── Inspection ─────────────────────────────────────────────────────────

  /** Get the number of pending emissions queued while frozen. */
  public getPendingCount(): number {
    return this._pendingEmissions.length;
  }

  /** Discard all pending emissions without firing them. */
  public discard(): void {
    this._pendingEmissions = [];
  }

  // ─── Batch Helper ───────────────────────────────────────────────────────

  /**
   * Execute a callback within a freeze/thaw block.
   * The thawList is frozen before fn() runs and thawed after it completes,
   * even if fn() throws.
   */
  public static batch(fn: () => void, thawList: ThawList): void {
    thawList.freeze();
    try {
      fn();
    } finally {
      thawList.thaw();
    }
  }
}
