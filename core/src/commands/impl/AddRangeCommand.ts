import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { Range } from "../../domain/Range";
import { FrameCount, RangeId } from "../../domain/types";

import { logger } from "../../utils/Logger";
/**
 * Add Range Command
 * Timeline에 named range를 추가합니다.
 */
export class AddRangeCommand implements Command {
  private rangeId?: RangeId;
  private name: string;
  private start: FrameCount;
  private end: FrameCount;
  private color?: string;
  private addedRange?: Range;

  constructor(
    name: string,
    start: FrameCount,
    end: FrameCount,
    color?: string,
  ) {
    this.name = name;
    this.start = start;
    this.end = end;
    this.color = color;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    this.addedRange = session.addRange(
      this.name,
      this.start,
      this.end,
      this.rangeId,
      this.color,
    );

    this.rangeId = this.addedRange.id;

    logger.debug(
      "AddRangeCommand",
      `Added range: ${this.name} (${this.start} - ${this.end})`,
    );
  }

  public async undo(): Promise<void> {
    if (!this.rangeId) return;

    const engine = AudioEngine.getInstance();
    const session = engine.session;

    session.removeRange(this.rangeId);
    logger.debug("AddRangeCommand", `Removed range: ${this.name}`);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
