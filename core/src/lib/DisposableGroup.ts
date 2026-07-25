/**
 * Collects multiple disposable subscriptions and disposes them all at once.
 *
 * Typical usage with Signal:
 * ```ts
 * const group = new DisposableGroup();
 * group.add(track.muteChanged.connect(() => { ... }));
 * group.add(track.soloChanged.connect(() => { ... }));
 *
 * // Later, when the owner is torn down:
 * group.dispose();
 * ```
 */
export interface Disposable {
  dispose: () => void;
}

export class DisposableGroup implements Disposable {
  private _disposables: Disposable[] = [];
  private _disposed = false;

  /** Number of active subscriptions. */
  get size(): number {
    return this._disposables.length;
  }

  /** Whether this group has already been disposed. */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Add a disposable to the group.
   * If the group is already disposed, the disposable is immediately disposed.
   */
  add(disposable: Disposable): void {
    if (this._disposed) {
      disposable.dispose();
      return;
    }
    this._disposables.push(disposable);
  }

  /**
   * Dispose all collected subscriptions and prevent further additions.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const disposables = this._disposables;
    this._disposables = [];
    for (const d of disposables) {
      d.dispose();
    }
  }
}
