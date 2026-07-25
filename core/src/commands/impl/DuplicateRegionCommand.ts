import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { AddRegionCommand } from "./AddRegionCommand";

import { logger } from "../../utils/Logger";
/**
 * Duplicate Region Command
 *
 * 선택된 Region들을 바로 뒤에 복제합니다.
 */
export class DuplicateRegionCommand implements UndoableCommand {
  private addedRegionCommands: AddRegionCommand[] = [];

  constructor() {}

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;
    const selectedIds = Array.from(session.getSelectedRegionIds());

    if (selectedIds.length === 0) {
      logger.debug("DuplicateRegionCommand", "No regions selected");
      return;
    }

    // 선택된 Region들 수집
    for (const regionId of selectedIds) {
      for (const track of session.tracks) {
        const region = track.playlist.getRegion(regionId);
        if (region) {
          // 원본 region 바로 뒤에 복제
          const duplicateStart = region.end;

          const addCmd = new AddRegionCommand(
            session,
            track.id,
            region.sourceId,
            duplicateStart,
            region.length,
            region.sourceStart,
          );

          await addCmd.execute();
          this.addedRegionCommands.push(addCmd);
          break;
        }
      }
    }

    logger.debug(
      "DuplicateRegionCommand",
      `Duplicated ${selectedIds.length} region(s)`,
    );
  }

  public async undo(): Promise<void> {
    // Undo in reverse order
    for (let i = this.addedRegionCommands.length - 1; i >= 0; i--) {
      await this.addedRegionCommands[i].undo();
    }
    this.addedRegionCommands = [];
    logger.debug("DuplicateRegionCommand", "Undo duplicate");
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
