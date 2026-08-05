import { Signal } from "../lib/Signal";

/**
 * SelectionHistory - parallel undo/redo for selection changes.
 *
 * Maintains a separate history stack of selection snapshots,
 * independent of the main command history.
 */
export class SelectionHistory {
  private history: Set<string>[] = [];
  // commit, undo, redo가 같은 기준을 사용하도록 현재 snapshot의 배열 인덱스를 저장한다.
  private currentSnapshotIndex: number = 0;

  public readonly changed = new Signal<void>();

  /**
   * Initialize/reset the selection history with the current selection.
   * Called at the start of a session and after main undo/redo operations.
   */
  public begin(currentSelection: Set<string>): void {
    this.history = [new Set(currentSelection)];
    this.currentSnapshotIndex = 0;
    this.changed.emit();
  }

  /**
   * Commit a new selection state snapshot.
   * Trims any forward (redo) history.
   */
  public commit(selectionSnapshot: Set<string>): void {
    // Trim forward history
    if (this.currentSnapshotIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentSnapshotIndex + 1);
    }
    this.history.push(new Set(selectionSnapshot));
    this.currentSnapshotIndex = this.history.length - 1;
    this.changed.emit();
  }

  /**
   * Undo the last selection change.
   * Returns the previous selection state, or null if nothing to undo.
   */
  public undo(): Set<string> | null {
    if (!this.canUndo) return null;
    this.currentSnapshotIndex--;
    const snapshot = this.history[this.currentSnapshotIndex];
    this.changed.emit();
    return snapshot ? new Set(snapshot) : null;
  }

  /**
   * Redo the next selection change.
   * Returns the next selection state, or null if nothing to redo.
   */
  public redo(): Set<string> | null {
    if (!this.canRedo) return null;
    this.currentSnapshotIndex++;
    const snapshot = this.history[this.currentSnapshotIndex];
    this.changed.emit();
    return snapshot ? new Set(snapshot) : null;
  }

  public get canUndo(): boolean {
    return this.currentSnapshotIndex > 0;
  }

  public get canRedo(): boolean {
    return this.currentSnapshotIndex < this.history.length - 1;
  }
}
