import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { MarkerId } from "../../domain/Marker";
import { FrameCount } from "../../domain/types";

import { logger } from "../../utils/Logger";
export class AddMarkerCommand implements UndoableCommand {
  private markerId?: MarkerId;

  constructor(
    private name: string,
    private position: FrameCount,
    private color?: string,
  ) {}

  async execute(): Promise<void> {
    const session = AudioEngine.getInstance().session;
    const marker = session.addMarker(this.name, this.position, this.color);
    this.markerId = marker.id;
    logger.debug(
      "AddMarkerCommand",
      `Added marker "${this.name}" at frame ${this.position}`,
    );
  }

  async undo(): Promise<void> {
    if (this.markerId) {
      const session = AudioEngine.getInstance().session;
      session.removeMarker(this.markerId);
      logger.debug("AddMarkerCommand", `Undo: removed marker "${this.name}"`);
    }
  }

  async redo(): Promise<void> {
    await this.execute();
  }
}
