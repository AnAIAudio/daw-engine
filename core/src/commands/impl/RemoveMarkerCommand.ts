import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { MarkerId } from "../../domain/Marker";

import { logger } from "../../utils/Logger";
export class RemoveMarkerCommand implements UndoableCommand {
  private savedName?: string;
  private savedPosition?: number;
  private savedColor?: string;
  private savedLocked?: boolean;

  constructor(private markerId: MarkerId) {}

  async execute(): Promise<void> {
    const session = AudioEngine.getInstance().session;
    const marker = session.getMarker(this.markerId);
    if (!marker) throw new Error(`Marker not found: ${this.markerId}`);

    // Save for undo
    this.savedName = marker.name;
    this.savedPosition = marker.position;
    this.savedColor = marker.color;
    this.savedLocked = marker.locked;

    session.removeMarker(this.markerId);
    logger.debug("RemoveMarkerCommand", `Removed marker "${this.savedName}"`);
  }

  async undo(): Promise<void> {
    if (this.savedName !== undefined && this.savedPosition !== undefined) {
      const session = AudioEngine.getInstance().session;
      const marker = session.addMarker(
        this.savedName,
        this.savedPosition,
        this.savedColor,
        this.markerId,
      );
      if (this.savedLocked) marker.locked = true;
      logger.debug(
        "RemoveMarkerCommand",
        `Undo: restored marker "${this.savedName}"`,
      );
    }
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}
