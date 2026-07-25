import { UndoableCommand } from "./Command";
import { UndoTransaction } from "./UndoTransaction";
import { Signal } from "../lib/Signal";
import type { SerializableCommand } from "./CommandRegistry";

export interface HistoryEntry {
  command: UndoableCommand;
  label: string;
  timestamp: number;
}

/**
 * Serializable snapshot of the history (metadata only).
 * Full command re-execution is not supported after reload;
 * the snapshot is informational (labels + timestamps).
 */
export interface HistorySnapshot {
  undoEntries: Array<{ label: string; timestamp: number }>;
  redoEntries: Array<{ label: string; timestamp: number }>;
}

/**
 * Extended snapshot that includes serialized command data for entries whose
 * commands implement {@link SerializableCommand}.
 */
export interface SerializedHistorySnapshot {
  undoStack: string[];
  redoStack: string[];
}

/**
 * CommandHistory — manages undo/redo stacks with features:
 *
 * - Configurable depth limit (0 = unlimited, max 512)
 * - Transaction grouping (beginTransaction / commitTransaction / abortTransaction)
 * - Begin/End signals for UI synchronization
 * - Granular clear methods (clearUndo / clearRedo / clear)
 * - Dynamic labels (nextUndoLabel / nextRedoLabel)
 * - History snapshot serialization for persistence
 * - Batch undo/redo (undoMultiple / redoMultiple)
 * - Serialization support via CommandRegistry
 *
 */
export class CommandHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private _depth: number = 0; // 0 = unlimited

  // Active transaction
  private _activeTransaction: UndoTransaction | null = null;

  // Signals
  public readonly historyChanged = new Signal<void>();
  public readonly beginUndoRedo = new Signal<void>();
  public readonly endUndoRedo = new Signal<void>();

  // --- Depth management ---

  public get depth(): number {
    return this._depth;
  }

  public setDepth(d: number): void {
    this._depth = Math.max(0, Math.min(512, d));
    this.trimUndoStack();
  }

  public get undoDepth(): number {
    return this.undoStack.length;
  }

  public get redoDepth(): number {
    return this.redoStack.length;
  }

  private trimUndoStack(): void {
    if (this._depth > 0) {
      while (this.undoStack.length > this._depth) {
        this.undoStack.shift(); // Remove oldest entry
      }
    }
  }

  // --- Execute ---

  public async execute(command: UndoableCommand, label?: string) {
    await command.execute();
    const entryLabel = label || command.constructor.name.replace("Command", "");
    this.undoStack.push({
      command,
      label: entryLabel,
      timestamp: Date.now(),
    });
    this.trimUndoStack();
    this.redoStack = []; // Clear redo stack on new action
    this.historyChanged.emit();
  }

  // --- Transaction grouping ---

  public beginTransaction(name: string): void {
    this._activeTransaction = new UndoTransaction(name);
  }

  public addCommandToTransaction(cmd: UndoableCommand): void {
    if (this._activeTransaction) {
      this._activeTransaction.addCommand(cmd);
    }
  }

  public async commitTransaction(): Promise<void> {
    if (!this._activeTransaction || this._activeTransaction.empty) {
      this._activeTransaction = null;
      return;
    }
    const txn = this._activeTransaction;
    this._activeTransaction = null;
    this.undoStack.push({
      command: txn,
      label: txn.name,
      timestamp: txn.timestamp,
    });
    this.trimUndoStack();
    this.redoStack = [];
    this.historyChanged.emit();
  }

  public async abortTransaction(): Promise<void> {
    if (!this._activeTransaction) return;
    const txn = this._activeTransaction;
    this._activeTransaction = null;
    // Undo everything in the active transaction
    await txn.undo();
  }

  public get hasActiveTransaction(): boolean {
    return this._activeTransaction !== null;
  }

  // --- Undo / Redo with begin/end signals ---

  public async undo() {
    const entry = this.undoStack.pop();
    if (entry) {
      this.beginUndoRedo.emit();
      try {
        await entry.command.undo();
        this.redoStack.push(entry);
      } finally {
        this.endUndoRedo.emit();
      }
      this.historyChanged.emit();
    }
  }

  public async redo() {
    const entry = this.redoStack.pop();
    if (entry) {
      this.beginUndoRedo.emit();
      try {
        await entry.command.redo();
        this.undoStack.push(entry);
        this.trimUndoStack();
      } finally {
        this.endUndoRedo.emit();
      }
      this.historyChanged.emit();
    }
  }

  // --- Batch undo / redo ---

  /**
   * Undo multiple transactions at once.
   *
   * This is more efficient than calling {@link undo} in a loop because it
   * emits `beginUndoRedo` / `endUndoRedo` and `historyChanged` only once
   * for the entire batch.
   *
   * @param count - Number of undo steps to perform.  Clamped to the
   *   available undo depth.
   */
  public async undoMultiple(count: number): Promise<void> {
    const steps = Math.min(Math.max(0, count), this.undoStack.length);
    if (steps === 0) return;

    this.beginUndoRedo.emit();
    try {
      for (let i = 0; i < steps; i++) {
        const entry = this.undoStack.pop();
        if (entry) {
          await entry.command.undo();
          this.redoStack.push(entry);
        }
      }
    } finally {
      this.endUndoRedo.emit();
    }
    this.historyChanged.emit();
  }

  /**
   * Redo multiple transactions at once.
   *
   * This is more efficient than calling {@link redo} in a loop because it
   * emits `beginUndoRedo` / `endUndoRedo` and `historyChanged` only once
   * for the entire batch.
   *
   * @param count - Number of redo steps to perform.  Clamped to the
   *   available redo depth.
   */
  public async redoMultiple(count: number): Promise<void> {
    const steps = Math.min(Math.max(0, count), this.redoStack.length);
    if (steps === 0) return;

    this.beginUndoRedo.emit();
    try {
      for (let i = 0; i < steps; i++) {
        const entry = this.redoStack.pop();
        if (entry) {
          await entry.command.redo();
          this.undoStack.push(entry);
        }
      }
      this.trimUndoStack();
    } finally {
      this.endUndoRedo.emit();
    }
    this.historyChanged.emit();
  }

  // --- State queries ---

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Dynamic label for next undo action.
   */
  public get nextUndoLabel(): string {
    if (this.undoStack.length === 0) return "";
    return this.undoStack[this.undoStack.length - 1].label;
  }

  /**
   * Dynamic label for next redo action.
   */
  public get nextRedoLabel(): string {
    if (this.redoStack.length === 0) return "";
    return this.redoStack[this.redoStack.length - 1].label;
  }

  /**
   * Get the undo history stack (for UI display).
   * Returns entries in execution order (oldest first).
   */
  public getUndoHistory(): ReadonlyArray<HistoryEntry> {
    return [...this.undoStack];
  }

  /**
   * Get the redo history stack.
   * Returns entries in redo order (next to redo first).
   */
  public getRedoHistory(): ReadonlyArray<HistoryEntry> {
    return [...this.redoStack].reverse();
  }

  /**
   * Undo to a specific point in history (undo multiple steps).
   */
  public async undoTo(index: number): Promise<void> {
    const stepsToUndo = this.undoStack.length - index;
    for (let i = 0; i < stepsToUndo; i++) {
      await this.undo();
    }
  }

  /**
   * Get the current position in history (number of executed commands).
   */
  public get currentIndex(): number {
    return this.undoStack.length;
  }

  /**
   * Get total history size (undo + redo).
   */
  public get totalSize(): number {
    return this.undoStack.length + this.redoStack.length;
  }

  // --- Clear methods ---

  public clearUndo(): void {
    this.undoStack = [];
    this.historyChanged.emit();
  }

  public clearRedo(): void {
    this.redoStack = [];
    this.historyChanged.emit();
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.historyChanged.emit();
  }

  // --- Persistence ---

  /**
   * Serialize history metadata for persistence.
   * @param depth Number of entries to save (0 = all, negative = all)
   */
  public getState(depth: number = 0): HistorySnapshot {
    const undoEntries = (
      depth > 0 ? this.undoStack.slice(-depth) : this.undoStack
    ).map((e) => ({ label: e.label, timestamp: e.timestamp }));

    const redoEntries = (
      depth > 0 ? this.redoStack.slice(-depth) : this.redoStack
    ).map((e) => ({ label: e.label, timestamp: e.timestamp }));

    return { undoEntries, redoEntries };
  }

  // --- Serialization support ---

  /**
   * Return a lightweight snapshot containing the transaction/command names
   * from both stacks.
   *
   * This is useful for persisting history metadata (e.g. to show the user
   * what operations were performed) without needing to serialize full
   * command state.
   *
   * @returns An object with `undoStack` and `redoStack` arrays of label
   *   strings.
   */
  public getSnapshot(): SerializedHistorySnapshot {
    return {
      undoStack: this.undoStack.map((e) => e.label),
      redoStack: this.redoStack.map((e) => e.label),
    };
  }

  /**
   * Check whether all commands in the history implement
   * {@link SerializableCommand}, meaning the full history could be
   * serialized and later re-hydrated.
   *
   * @returns `true` if every entry's command has a `toJSON` method.
   */
  public canSerialize(): boolean {
    const allEntries = [...this.undoStack, ...this.redoStack];
    return allEntries.every((entry) => this.isSerializable(entry.command));
  }

  /**
   * Type guard for checking if a command implements SerializableCommand.
   */
  private isSerializable(cmd: unknown): cmd is SerializableCommand {
    return (
      typeof cmd === "object" &&
      cmd !== null &&
      "toJSON" in cmd &&
      typeof (cmd as SerializableCommand).toJSON === "function"
    );
  }
}
