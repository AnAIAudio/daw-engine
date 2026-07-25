import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { RangeId } from "../../domain/types";

import { logger } from "../../utils/Logger";
/**
 * Set Punch Range Command
 *
 * Punch-in/out range를 설정합니다.
 * 녹음 시 이 range 내에서만 녹음이 활성화됩니다.
 */
export class SetPunchRangeCommand implements Command {
  private rangeId?: RangeId;
  private oldRangeId?: RangeId;

  constructor(rangeId?: RangeId) {
    this.rangeId = rangeId;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    // Store old value for undo
    this.oldRangeId = session.punchRangeId;

    if (this.rangeId) {
      session.setPunchRange(this.rangeId);
      logger.debug(
        "SetPunchRangeCommand",
        `Punch range set to: ${this.rangeId}`,
      );
    } else {
      session.clearPunchRange();
      logger.debug("SetPunchRangeCommand", `Punch range cleared`);
    }
  }

  public async undo(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    if (this.oldRangeId) {
      session.setPunchRange(this.oldRangeId);
    } else {
      session.clearPunchRange();
    }

    logger.debug(
      "SetPunchRangeCommand",
      `Restored punch range: ${this.oldRangeId}`,
    );
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
