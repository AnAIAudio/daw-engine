import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { RegionClipboard } from "../../domain/RegionClipboard";
import { Region } from "../../domain/Region";
import { TrackId } from "../../domain/types";

import { logger } from "../../utils/Logger";
/**
 * Copy Region Command
 *
 * 선택된 Region들을 클립보드에 복사합니다.
 */
export class CopyRegionCommand implements Command {
  constructor() {}

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;
    const selectedIds = Array.from(session.getSelectedRegionIds());

    if (selectedIds.length === 0) {
      logger.debug("CopyRegionCommand", "No regions selected");
      return;
    }

    const regions: Region[] = [];
    const trackIds: TrackId[] = [];

    // 선택된 Region들 수집
    for (const regionId of selectedIds) {
      for (const track of session.tracks) {
        const region = track.playlist.getRegion(regionId);
        if (region) {
          regions.push(region);
          trackIds.push(track.id);
          break;
        }
      }
    }

    if (regions.length === 0) {
      logger.debug("CopyRegionCommand", "No valid regions found");
      return;
    }

    // 클립보드에 복사
    const clipboard = RegionClipboard.getInstance();
    clipboard.copy(regions, trackIds);

    logger.debug(
      "CopyRegionCommand",
      `Copied ${regions.length} region(s) to clipboard`,
    );
  }
}
