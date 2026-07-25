import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { SessionStorage } from "../../storage/SessionStorage";

import { logger } from "../../utils/Logger";
/**
 * SaveSessionCommand -- saves the current session to IndexedDB and
 * optionally downloads a JSON file.
 */
export class SaveSessionCommand implements UndoableCommand {
  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    // 1. Save to IndexedDB
    const storage = SessionStorage.getInstance();
    await storage.saveSession(session);

    // 2. Also download as JSON file for user backup
    const snapshot = session.toJSON();
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${session.name.replace(/\s+/g, "_")}_session.json`;
    anchor.click();

    URL.revokeObjectURL(url);
    logger.debug("SaveSessionCommand", `Session saved: ${session.name}`);
  }

  public async undo(): Promise<void> {
    // Save is non-destructive; nothing to undo
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
