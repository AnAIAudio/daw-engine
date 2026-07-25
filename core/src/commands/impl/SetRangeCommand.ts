import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { FrameCount, RangeId } from "../../domain/types";

import { logger } from "../../utils/Logger";
/**
 * Set Range Command
 * 기존 range의 위치나 이름을 수정합니다.
 */
export class SetRangeCommand implements Command {
  private rangeId: RangeId;
  private newName?: string;
  private newStart?: FrameCount;
  private newEnd?: FrameCount;
  private newColor?: string;

  // For undo
  private oldName?: string;
  private oldStart?: FrameCount;
  private oldEnd?: FrameCount;
  private oldColor?: string;

  constructor(
    rangeId: RangeId,
    options: {
      name?: string;
      start?: FrameCount;
      end?: FrameCount;
      color?: string;
    },
  ) {
    this.rangeId = rangeId;
    this.newName = options.name;
    this.newStart = options.start;
    this.newEnd = options.end;
    this.newColor = options.color;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    const range = session.getRange(this.rangeId);
    if (!range) {
      throw new Error(`Range not found: ${this.rangeId}`);
    }

    // Store old values for undo
    this.oldName = range.name;
    this.oldStart = range.start;
    this.oldEnd = range.end;
    this.oldColor = range.color;

    // Apply changes
    if (this.newName !== undefined) {
      range.setName(this.newName);
    }

    if (this.newStart !== undefined && this.newEnd !== undefined) {
      range.setRange(this.newStart, this.newEnd);
    } else if (this.newStart !== undefined) {
      range.setRange(this.newStart, range.end);
    } else if (this.newEnd !== undefined) {
      range.setRange(range.start, this.newEnd);
    }

    if (this.newColor !== undefined) {
      range.setColor(this.newColor);
    }

    logger.debug("SetRangeCommand", `Updated range: ${range.name}`);
  }

  public async undo(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    const range = session.getRange(this.rangeId);
    if (!range) return;

    // Restore old values
    if (this.oldName !== undefined) {
      range.setName(this.oldName);
    }

    if (this.oldStart !== undefined && this.oldEnd !== undefined) {
      range.setRange(this.oldStart, this.oldEnd);
    }

    if (this.oldColor !== undefined) {
      range.setColor(this.oldColor);
    }

    logger.debug("SetRangeCommand", `Restored range: ${range.name}`);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
