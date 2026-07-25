import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { SendBus } from "../../domain/SendBus";

import { logger } from "../../utils/Logger";
export interface RemoveSendBusPayload {
  sendBusId: string;
}

/**
 * RemoveSendBusCommand – Send Bus를 제거합니다.
 * Undo 시 동일한 ID/파라미터로 SendBus를 복원합니다.
 */
export class RemoveSendBusCommand implements UndoableCommand {
  private _removedSendBus?: SendBus;

  constructor(private readonly payload: RemoveSendBusPayload) {}

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const sendBus = engine.session.getSendBus(this.payload.sendBusId);
    if (!sendBus) {
      logger.warn(
        "RemoveSendBusCommand",
        `SendBus not found: ${this.payload.sendBusId}`,
      );
      return;
    }
    // Snapshot before removal for undo
    this._removedSendBus = sendBus;
    engine.session.removeSendBus(this.payload.sendBusId);
    logger.debug(
      "RemoveSendBusCommand",
      `Removed send bus ${this.payload.sendBusId}`,
    );
  }

  public async undo(): Promise<void> {
    if (!this._removedSendBus) return;
    const engine = AudioEngine.getInstance();
    const sb = this._removedSendBus;
    engine.session.addSendBus(
      sb.sourceTrackId,
      sb.destId,
      sb.level,
      sb.preFader,
      sb.id,
    );
    logger.debug("RemoveSendBusCommand", `Undo: restored send bus ${sb.id}`);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
