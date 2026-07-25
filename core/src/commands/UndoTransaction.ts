import { UndoableCommand } from "./Command";

/**
 * Optional cleanup callback type.
 *
 * A cleanup function is invoked when the command it is associated with is
 * removed or invalidated — for example via {@link UndoTransaction.removeCommand}.
 * This allows callers to release external resources (e.g. cached buffers,
 * temporary files) that were tied to the command's lifecycle.
 */
export type CommandCleanup = () => void;

/**
 * Internal entry pairing a command with its optional cleanup callback.
 */
interface TransactionEntry {
  command: UndoableCommand;
  cleanup?: CommandCleanup;
}

/**
 * UndoTransaction groups multiple commands into one atomic undo step.
 *
 * On undo, commands are reversed in reverse order.
 * On redo, commands are re-executed in forward order.
 *
 * - Optional `cleanup` callback per command, called when a command is
 *   removed or the transaction is cleared.
 * - {@link removeCommand} for invalidating individual commands mid-transaction.
 */
export class UndoTransaction implements UndoableCommand {
  private entries: TransactionEntry[] = [];
  private _name: string;
  private _timestamp: number;

  constructor(name: string) {
    this._name = name;
    this._timestamp = Date.now();
  }

  public get name(): string {
    return this._name;
  }

  public get timestamp(): number {
    return this._timestamp;
  }

  public get empty(): boolean {
    return this.entries.length === 0;
  }

  public get size(): number {
    return this.entries.length;
  }

  /**
   * Append a command to this transaction.
   *
   * @param cmd     - The undoable command to add.
   * @param cleanup - Optional callback invoked when the command is removed
   *                  or invalidated (e.g. via {@link removeCommand}).
   */
  public addCommand(cmd: UndoableCommand, cleanup?: CommandCleanup): void {
    this.entries.push({ command: cmd, cleanup });
  }

  /**
   * Remove (invalidate) the command at the given index.
   *
   * If the entry has a cleanup callback it will be invoked before the
   * entry is removed.
   *
   * @param index - Zero-based index of the command to remove.
   * @throws {RangeError} If the index is out of bounds.
   */
  public removeCommand(index: number): void {
    if (index < 0 || index >= this.entries.length) {
      throw new RangeError(
        `UndoTransaction.removeCommand: index ${index} out of bounds [0, ${this.entries.length})`,
      );
    }
    const entry = this.entries[index];
    if (entry.cleanup) {
      entry.cleanup();
    }
    this.entries.splice(index, 1);
  }

  public async execute(): Promise<void> {
    for (const entry of this.entries) {
      await entry.command.execute();
    }
  }

  public async undo(): Promise<void> {
    // Undo in reverse order
    for (let i = this.entries.length - 1; i >= 0; i--) {
      await this.entries[i].command.undo();
    }
  }

  public async redo(): Promise<void> {
    for (const entry of this.entries) {
      await entry.command.redo();
    }
  }
}
