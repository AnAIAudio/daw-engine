import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { SessionStorage } from "../../storage/SessionStorage";

import { logger } from "../../utils/Logger";
/**
 * SaveSnapshotCommand -- saves a named snapshot of the current session
 * (point-in-time save).
 */
export class SaveSnapshotCommand implements UndoableCommand {
  private readonly snapshotName: string;
  private _snapshotId?: string;

  constructor(name: string) {
    this.snapshotName = name;
  }

  public get snapshotId(): string | undefined {
    return this._snapshotId;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;
    const storage = SessionStorage.getInstance();

    const snapshot = session.toJSON();
    this._snapshotId = await storage.saveSnapshot(
      session.id,
      this.snapshotName,
      snapshot,
    );

    logger.debug(
      "SaveSnapshotCommand",
      `Snapshot "${this.snapshotName}" saved (id: ${this._snapshotId})`,
    );
  }

  public async undo(): Promise<void> {
    // Snapshot save is non-destructive; optionally delete the snapshot
    if (this._snapshotId) {
      const storage = SessionStorage.getInstance();
      await storage.deleteSnapshot(this._snapshotId);
      logger.debug(
        "SaveSnapshotCommand",
        `Undo: deleted snapshot ${this._snapshotId}`,
      );
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
