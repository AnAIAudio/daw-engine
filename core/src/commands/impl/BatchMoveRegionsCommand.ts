import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";
import { MoveRegionCommand } from "./MoveRegionCommand";

export interface BatchMoveEntry {
  trackId: TrackId;
  regionId: RegionId;
  newStart: FrameCount;
  targetTrackId?: TrackId;
}

/**
 * Moves multiple regions atomically.
 * Typically used when the selection contains grouped regions:
 * the UI computes a delta from the primary (clicked) region and
 * applies the same delta to every selected region.
 */
export class BatchMoveRegionsCommand implements UndoableCommand {
  private subCommands: MoveRegionCommand[] = [];

  constructor(
    private session: Session,
    private entries: BatchMoveEntry[],
  ) {}

  public async execute(): Promise<void> {
    this.subCommands = this.entries.map(
      (e) =>
        new MoveRegionCommand(
          this.session,
          e.trackId,
          e.regionId,
          e.newStart,
          e.targetTrackId,
        ),
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
}
