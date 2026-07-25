import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId } from "../../domain/types";
import { RemoveRegionCommand } from "./RemoveRegionCommand";

export interface BatchRemoveEntry {
  trackId: TrackId;
  regionId: RegionId;
}

/**
 * Removes multiple regions atomically.
 * Regions are removed in reverse-start-position order so that
 * ripple-edit shifts don't corrupt subsequent indices.
 */
export class BatchRemoveRegionsCommand implements UndoableCommand {
  private subCommands: RemoveRegionCommand[] = [];

  constructor(
    private session: Session,
    private entries: BatchRemoveEntry[],
  ) {}

  public async execute(): Promise<void> {
    // Sort by start position descending so ripple shifts don't affect later removals
    const sorted = [...this.entries].sort((a, b) => {
      const regionA = this.findRegionStart(a.trackId, a.regionId);
      const regionB = this.findRegionStart(b.trackId, b.regionId);
      return regionB - regionA;
    });

    this.subCommands = sorted.map(
      (e) => new RemoveRegionCommand(this.session, e.trackId, e.regionId),
    );
    for (const cmd of this.subCommands) {
      await cmd.execute();
    }
  }

  public async undo(): Promise<void> {
    for (let i = this.subCommands.length - 1; i >= 0; i--) {
      await this.subCommands[i].undo();
    }
  }

  public async redo(): Promise<void> {
    for (const cmd of this.subCommands) {
      await cmd.redo();
    }
  }

  private findRegionStart(trackId: TrackId, regionId: RegionId): number {
    const track = this.session.getTrack(trackId);
    const region = track?.playlist.getRegion(regionId);
    return region?.start ?? 0;
  }
}
