import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackId } from "../../domain/types";

import { logger } from "../../utils/Logger";
export interface AddSendBusPayload {
  sourceTrackId: TrackId;
  destId: string;
  level?: number;
  preFader?: boolean;
  /** Undo/Redo 시 ID를 재사용하기 위해 외부에서 주입 가능 */
  id?: string;
}

/**
 * AddSendBusCommand – 트랙에서 목적지로 Send Bus를 추가합니다.
 * Undo 시 생성한 SendBus를 제거합니다.
 */
export class AddSendBusCommand implements UndoableCommand {
  private _createdSendBusId?: string;

  constructor(private readonly payload: AddSendBusPayload) {}

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const sendBus = engine.session.addSendBus(
      this.payload.sourceTrackId,
      this.payload.destId,
      this.payload.level ?? 0,
      this.payload.preFader ?? false,
      this.payload.id,
    );
    this._createdSendBusId = sendBus.id;
    logger.debug(
      "AddSendBusCommand",
      `Added send bus ${sendBus.id}: ${this.payload.sourceTrackId} -> ${this.payload.destId}`,
    );
  }

  public async undo(): Promise<void> {
    if (!this._createdSendBusId) return;
    const engine = AudioEngine.getInstance();
    engine.session.removeSendBus(this._createdSendBusId);
    logger.debug(
      "AddSendBusCommand",
      `Undo: removed send bus ${this._createdSendBusId}`,
    );
  }

  public async redo(): Promise<void> {
    // re-execute with same id so Undo still points to the same sendBusId
    this.payload.id = this._createdSendBusId;
    await this.execute();
  }
}
