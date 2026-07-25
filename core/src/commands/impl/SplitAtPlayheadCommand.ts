import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { SplitRegionCommand } from "./SplitRegionCommand";
import { RegionId, FrameCount } from "../../domain/types";
import { NoSelectionError } from "../../errors/DAWErrors";

import { logger } from "../../utils/Logger";
/**
 * Split At Playhead Command
 *
 * 선택된 모든 region을 playhead 위치에서 분할합니다.
 * - Playhead가 region 범위 밖에 있으면 skip
 * - 여러 region을 한 번에 처리
 * - Undo/Redo 지원
 */
export class SplitAtPlayheadCommand implements UndoableCommand {
  private splitCommands: SplitRegionCommand[] = [];
  private skippedRegions: Array<{ regionId: RegionId; reason: string }> = [];

  constructor() {}

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    const selectedRegionIds = session.getSelectedRegionIds();
    const playheadPosition: FrameCount = session.transportFrame;

    if (selectedRegionIds.size === 0) {
      throw new NoSelectionError();
    }

    this.splitCommands = [];
    this.skippedRegions = [];

    for (const regionId of selectedRegionIds) {
      // Find track containing this region
      let trackId: string | null = null;
      let region = null;

      for (const track of session.tracks) {
        const r = track.playlist.getRegion(regionId);
        if (r) {
          trackId = track.id;
          region = r;
          break;
        }
      }

      if (!trackId || !region) {
        this.skippedRegions.push({
          regionId,
          reason: "Track not found",
        });
        continue;
      }

      // Check if playhead is within region bounds
      if (playheadPosition <= region.start || playheadPosition >= region.end) {
        this.skippedRegions.push({
          regionId,
          reason: `Playhead (${playheadPosition}) is outside region bounds (${region.start}-${region.end})`,
        });
        continue;
      }

      try {
        const splitCmd = new SplitRegionCommand(
          trackId,
          regionId,
          playheadPosition,
        );
        await splitCmd.execute();
        this.splitCommands.push(splitCmd);
      } catch (error) {
        this.skippedRegions.push({
          regionId,
          reason: (error as Error).message,
        });
      }
    }

    if (this.splitCommands.length === 0) {
      throw new Error(
        `No regions could be split. ${this.skippedRegions.length} skipped. ` +
          `Tip: Move the playhead inside the region before splitting.`,
      );
    }

    logger.debug(
      "SplitAtPlayheadCommand",
      `Split ${this.splitCommands.length} region(s), ` +
        `skipped ${this.skippedRegions.length}`,
    );
  }

  public async undo(): Promise<void> {
    // Undo in reverse order
    for (let i = this.splitCommands.length - 1; i >= 0; i--) {
      await this.splitCommands[i].undo();
    }
    logger.debug("SplitAtPlayheadCommand", "Undo split at playhead");
  }

  public async redo(): Promise<void> {
    // Redo in original order
    for (const splitCmd of this.splitCommands) {
      await splitCmd.redo();
    }
    logger.debug("SplitAtPlayheadCommand", "Redo split at playhead");
  }

  /**
   * 실행 결과 요약 반환 (Console에서 사용)
   */
  public getSummary(): {
    successCount: number;
    skippedCount: number;
    skippedDetails: Array<{ regionId: RegionId; reason: string }>;
  } {
    return {
      successCount: this.splitCommands.length,
      skippedCount: this.skippedRegions.length,
      skippedDetails: this.skippedRegions,
    };
  }
}
