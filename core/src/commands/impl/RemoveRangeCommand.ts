import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { Range } from "../../domain/Range";
import { RangeId } from "../../domain/types";

import { logger } from "../../utils/Logger";
/**
 * Remove Range Command
 * Timeline에서 range를 제거합니다.
 */
export class RemoveRangeCommand implements Command {
  private rangeId: RangeId;
  private removedRange?: Range;

  constructor(rangeId: RangeId) {
    this.rangeId = rangeId;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    const range = session.getRange(this.rangeId);
    if (!range) {
      throw new Error(`Range not found: ${this.rangeId}`);
    }

    // Store for undo
    this.removedRange = range.clone();

    session.removeRange(this.rangeId);
    logger.debug("RemoveRangeCommand", `Removed range: ${range.name}`);
  }

  public async undo(): Promise<void> {
    if (!this.removedRange) return;

    const engine = AudioEngine.getInstance();
    const session = engine.session;

    session.addRange(
      this.removedRange.name,
      this.removedRange.start,
      this.removedRange.end,
      this.removedRange.id,
      this.removedRange.color,
    );

    logger.debug(
      "RemoveRangeCommand",
      `Restored range: ${this.removedRange.name}`,
    );
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
