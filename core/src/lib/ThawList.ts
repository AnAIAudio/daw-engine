import { Signal } from "./Signal";

/**
 * ThawList implements the freeze/thaw notification pattern.
 *
 * When performing bulk operations (e.g., moving 50 regions),
 * you don't want 50 individual change notifications. Instead:
 *
 * 1. Call freeze() to suppress notifications
 * 2. Make all changes
 * 3. Call thaw() to emit a single batch notification
 *
 * Supports nesting: multiple freeze() calls require matching thaw() calls.
 * Only the outermost thaw() triggers the batch notification.
 */
export class ThawList<T = void> {
  private _freezeCount: number = 0;
  private _pendingChanges: T[] = [];
  private _hasPendingChanges: boolean = false;

  /**
   * Emitted when the outermost thaw() resolves and there are pending
   * changes. Receives the full array of batched changes.
   */
  public readonly changed = new Signal<T[]>();

  /**
   * Emitted immediately for each change when the list is NOT frozen.
   * When frozen, individual notifications are suppressed until thaw.
   */
  public readonly singleChanged = new Signal<T>();

  // ---------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------

  /**
   * Whether notifications are currently suppressed.
   */
  get isFrozen(): boolean {
    return this._freezeCount > 0;
  }

  /**
   * Current nesting depth of freeze() calls.
   */
  get freezeCount(): number {
    return this._freezeCount;
  }

  /**
   * Number of changes queued while frozen.
   */
  get pendingCount(): number {
    return this._pendingChanges.length;
  }

  // ---------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------

  /**
   * Freeze (suppress) notifications.
   *
   * Can be called multiple times to nest freeze contexts. Each freeze()
   * must be balanced by a corresponding thaw().
   */
  freeze(): void {
    this._freezeCount++;
  }

  /**
   * Thaw notifications.
   *
   * Decrements the freeze counter. When the counter reaches zero (i.e.
   * the outermost freeze context is resolved) and there are pending
   * changes, a single batch notification is emitted via {@link changed}.
   *
   * @throws Error if called without a matching freeze().
   */
  thaw(): void {
    if (this._freezeCount <= 0) {
      throw new Error("ThawList.thaw() called without matching freeze()");
    }

    this._freezeCount--;

    if (this._freezeCount === 0 && this._hasPendingChanges) {
      const changes = this._pendingChanges;
      this._pendingChanges = [];
      this._hasPendingChanges = false;
      this.changed.emit(changes);
    }
  }

  /**
   * Record a change.
   *
   * - If the list is **not frozen**, the change is emitted immediately
   *   via {@link singleChanged}.
   * - If the list **is frozen**, the change is queued and will be
   *   included in the batch notification when the outermost thaw()
   *   resolves.
   */
  notify(data: T): void {
    if (this._freezeCount > 0) {
      this._pendingChanges.push(data);
      this._hasPendingChanges = true;
    } else {
      this.singleChanged.emit(data);
    }
  }

  /**
   * Force-emit all pending changes as a batch notification, regardless
   * of the current freeze state. The freeze counter is **not** modified.
   *
   * Useful for "flush before destroy" scenarios where you need to
   * guarantee observers see all pending changes.
   */
  flush(): void {
    if (this._hasPendingChanges) {
      const changes = this._pendingChanges;
      this._pendingChanges = [];
      this._hasPendingChanges = false;
      this.changed.emit(changes);
    }
  }

  /**
   * Discard all pending changes without emitting any notification.
   *
   * The freeze counter is **not** modified. This is useful when an
   * operation is aborted/rolled back and queued notifications should
   * be silently dropped.
   */
  discard(): void {
    this._pendingChanges = [];
    this._hasPendingChanges = false;
  }

  /**
   * Execute a function within a freeze/thaw block.
   *
   * Convenience wrapper that:
   * 1. Calls freeze()
   * 2. Invokes `fn`
   * 3. Calls thaw() (even if `fn` throws)
   *
   * This ensures the freeze/thaw pairing is always balanced.
   *
   * @param fn The function to execute while notifications are frozen.
   */
  batch(fn: () => void): void {
    this.freeze();
    try {
      fn();
    } finally {
      this.thaw();
    }
  }
}
