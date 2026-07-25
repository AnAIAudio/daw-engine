import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";

import { logger } from "../../utils/Logger";
export interface SetSendLevelPayload {
  sendBusId: string;
  level: number; // dB
}

/**
 * SetSendLevelCommand – Send Bus의 전송 레벨(dB)을 변경합니다.
 * Undo 시 이전 레벨로 복원합니다.
 */
export class SetSendLevelCommand implements UndoableCommand {
  private _previousLevel?: number;

  constructor(private readonly payload: SetSendLevelPayload) {}

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const sendBus = engine.session.getSendBus(this.payload.sendBusId);
    if (!sendBus) {
      logger.warn(
        "SetSendLevelCommand",
        `SendBus not found: ${this.payload.sendBusId}`,
      );
      return;
    }
    this._previousLevel = sendBus.level;
    sendBus.setLevel(this.payload.level);
    logger.debug(
      "SetSendLevelCommand",
      `Set level ${this.payload.sendBusId}: ${this._previousLevel} -> ${this.payload.level}`,
    );
  }

  public async undo(): Promise<void> {
    if (this._previousLevel === undefined) return;
    const engine = AudioEngine.getInstance();
    const sendBus = engine.session.getSendBus(this.payload.sendBusId);
    if (!sendBus) return;
    sendBus.setLevel(this._previousLevel);
    logger.debug(
      "SetSendLevelCommand",
      `Undo: restored level ${this.payload.sendBusId} -> ${this._previousLevel}`,
    );
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
