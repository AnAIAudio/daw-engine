export interface Command {
  execute(): Promise<void>;
}

export interface UndoableCommand extends Command {
  undo(): Promise<void>;
  redo(): Promise<void>;
}
