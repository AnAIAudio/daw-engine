import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";
import { TrimRegionCommand } from "./TrimRegionCommand";

export interface BatchTrimEntry {
  trackId: TrackId;
  regionId: RegionId;
  amount: FrameCount;
  direction: "front" | "back";
  noOverlap?: boolean;
}

/**
 * Trims multiple regions atomically.
 * Each entry carries the same delta amount so grouped regions
 * are trimmed uniformly.
 */
export class BatchTrimRegionsCommand implements UndoableCommand {
  private subCommands: TrimRegionCommand[] = [];

  constructor(
    private session: Session,
    private entries: BatchTrimEntry[],
  ) {}

  public async execute(): Promise<void> {
    this.subCommands = this.entries.map(
      (e) =>
        new TrimRegionCommand(
          this.session,
          e.trackId,
          e.regionId,
          e.amount,
          e.direction,
          e.noOverlap,
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
