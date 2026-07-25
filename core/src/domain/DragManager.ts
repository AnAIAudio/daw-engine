import { Signal } from "../lib/Signal";

/**
 * DragManager - centralized drag state tracking.
 *
 * Components register/unregister active drags.
 * HistoryHandler aborts active drags before undo/redo.
 */
export class DragManager {
  private static instance: DragManager;
  public readonly dragAborted = new Signal<void>();
  private _activeDragCount: number = 0;

  private constructor() {}

  public static getInstance(): DragManager {
    if (!DragManager.instance) {
      DragManager.instance = new DragManager();
    }
    return DragManager.instance;
  }

  public registerDrag(): void {
    this._activeDragCount++;
  }

  public unregisterDrag(): void {
    this._activeDragCount = Math.max(0, this._activeDragCount - 1);
  }

  public get active(): boolean {
    return this._activeDragCount > 0;
  }

  public abort(): void {
    if (this._activeDragCount > 0) {
      this._activeDragCount = 0;
      this.dragAborted.emit();
    }
  }
}
