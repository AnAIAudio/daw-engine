import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackId, RegionId, FrameCount } from "../../domain/types";
import { RemoveRegionCommand } from "./RemoveRegionCommand";
import { AddRegionCommand } from "./AddRegionCommand";
import {
  TrackNotFoundError,
  RegionNotFoundError,
  RegionOutOfBoundsError,
} from "../../errors/DAWErrors";

import { logger } from "../../utils/Logger";
/**
 * Split Region Command
 *
 * Region을 지정된 위치에서 두 개로 분할합니다.
 */
export class SplitRegionCommand implements UndoableCommand {
  private trackId: TrackId;
  private regionId: RegionId;
  private splitPosition: FrameCount;

  private originalRegionData?: {
    sourceId: string;
    start: FrameCount;
    length: FrameCount;
    sourceStart: FrameCount;
    name: string;
  };
  private removeOriginalCmd?: RemoveRegionCommand;
  private addLeftCmd?: AddRegionCommand;
  private addRightCmd?: AddRegionCommand;

  constructor(trackId: TrackId, regionId: RegionId, splitPosition: FrameCount) {
    this.trackId = trackId;
    this.regionId = regionId;
    this.splitPosition = splitPosition;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;
    const track = session.getTrack(this.trackId);

    if (!track) {
      throw new TrackNotFoundError(this.trackId);
    }

    const region = track.playlist.getRegion(this.regionId);
    if (!region) {
      throw new RegionNotFoundError(this.regionId);
    }

    // Split 위치가 region 범위 내에 있는지 확인
    if (
      this.splitPosition <= region.start ||
      this.splitPosition >= region.end
    ) {
      throw new RegionOutOfBoundsError(
        this.regionId,
        this.splitPosition,
        region.start,
        region.end,
      );
    }

    // 원본 region 데이터 저장
    this.originalRegionData = {
      sourceId: region.sourceId,
      start: region.start,
      length: region.length,
      sourceStart: region.sourceStart,
      name: region.name,
    };

    // 원본 region 제거
    this.removeOriginalCmd = new RemoveRegionCommand(
      session,
      this.trackId,
      this.regionId,
    );
    await this.removeOriginalCmd.execute();

    // 왼쪽 region 생성
    const leftLength = this.splitPosition - region.start;
    this.addLeftCmd = new AddRegionCommand(
      session,
      this.trackId,
      region.sourceId,
      region.start,
      leftLength,
      region.sourceStart,
    );
    await this.addLeftCmd.execute();

    // 오른쪽 region 생성
    const rightLength = region.end - this.splitPosition;
    const rightSourceStart = region.sourceStart + leftLength;
    this.addRightCmd = new AddRegionCommand(
      session,
      this.trackId,
      region.sourceId,
      this.splitPosition,
      rightLength,
      rightSourceStart,
    );
    try {
      await this.addRightCmd.execute();
    } catch (err) {
      // Rollback: undo left region and restore original
      await this.addLeftCmd.undo();
      await this.removeOriginalCmd.undo();
      throw err;
    }

    logger.debug(
      "SplitRegionCommand",
      `Split region ${this.regionId} at frame ${this.splitPosition}`,
    );
  }

  public async undo(): Promise<void> {
    if (!this.addLeftCmd || !this.addRightCmd || !this.removeOriginalCmd) {
      throw new Error("Cannot undo: commands not initialized");
    }

    // 분할된 region들 제거
    await this.addRightCmd.undo();
    await this.addLeftCmd.undo();

    // 원본 region 복원
    await this.removeOriginalCmd.undo();

    logger.debug("SplitRegionCommand", "Undo split");
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
