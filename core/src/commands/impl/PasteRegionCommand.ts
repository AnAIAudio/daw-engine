import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { RegionClipboard } from "../../domain/RegionClipboard";
import { TrackId, FrameCount } from "../../domain/types";
import { AddRegionCommand } from "./AddRegionCommand";

import { logger } from "../../utils/Logger";
/**
 * Paste Region Command
 *
 * 클립보드의 Region들을 현재 playhead 위치에 붙여넣기합니다.
 */
export class PasteRegionCommand implements UndoableCommand {
  private targetTrackId?: TrackId;
  private pastePosition?: FrameCount;
  private addedRegionCommands: AddRegionCommand[] = [];

  constructor(targetTrackId?: TrackId, pastePosition?: FrameCount) {
    this.targetTrackId = targetTrackId;
    this.pastePosition = pastePosition;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;
    const clipboard = RegionClipboard.getInstance();

    if (clipboard.isEmpty()) {
      logger.debug("PasteRegionCommand", "Clipboard is empty");
      return;
    }

    const clipboardData = clipboard.getClipboardData();

    // Paste 위치 결정 (기본: transportFrame)
    const basePosition = this.pastePosition ?? session.transportFrame;

    // 각 region의 원래 시작 위치의 최솟값 계산
    const minOriginalStart = Math.min(
      ...clipboardData.map((data) => data.start),
    );

    for (const data of clipboardData) {
      // Target track 결정
      let targetTrack = this.targetTrackId
        ? session.getTrack(this.targetTrackId)
        : session.getTrack(data.originalTrackId);

      // Track이 없으면 첫 번째 track 사용
      if (!targetTrack && session.tracks.length > 0) {
        targetTrack = session.tracks[0];
      }

      if (!targetTrack) {
        logger.warn("PasteRegionCommand", "No target track found");
        continue;
      }

      // 상대적 위치 유지하며 paste
      const relativeOffset = data.start - minOriginalStart;
      const newStart = basePosition + relativeOffset;

      // AddRegionCommand로 region 추가
      const addCmd = new AddRegionCommand(
        session,
        targetTrack.id,
        data.sourceId,
        newStart,
        data.length,
        data.start, // sourceStart
      );

      await addCmd.execute();
      this.addedRegionCommands.push(addCmd);
    }

    logger.debug(
      "PasteRegionCommand",
      `Pasted ${clipboardData.length} region(s) at frame ${basePosition}`,
    );
  }

  public async undo(): Promise<void> {
    // Undo in reverse order
    for (let i = this.addedRegionCommands.length - 1; i >= 0; i--) {
      await this.addedRegionCommands[i].undo();
    }
    this.addedRegionCommands = [];
    logger.debug("PasteRegionCommand", "Undo paste");
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
