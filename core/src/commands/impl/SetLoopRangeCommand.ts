import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { RangeId } from "../../domain/types";

import { logger } from "../../utils/Logger";
/**
 * Set Loop Range Command
 *
 * Loop range를 설정하거나 해제합니다.
 */
export class SetLoopRangeCommand implements Command {
  private rangeId?: RangeId;
  private oldRangeId?: RangeId;
  private oldLoopEnabled: boolean = false;

  constructor(rangeId?: RangeId) {
    this.rangeId = rangeId;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    // Store old values for undo
    this.oldRangeId = session.loopRangeId;
    this.oldLoopEnabled = session.loopEnabled;

    if (this.rangeId) {
      session.setLoopRange(this.rangeId);
      logger.debug("SetLoopRangeCommand", `Loop range set to: ${this.rangeId}`);
    } else {
      session.clearLoopRange();
      logger.debug("SetLoopRangeCommand", `Loop range cleared`);
    }
  }

  public async undo(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    if (this.oldRangeId) {
      session.setLoopRange(this.oldRangeId);
      session.setLoopEnabled(this.oldLoopEnabled);
    } else {
      session.clearLoopRange();
    }

    logger.debug(
      "SetLoopRangeCommand",
      `Restored loop range: ${this.oldRangeId}`,
    );
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
