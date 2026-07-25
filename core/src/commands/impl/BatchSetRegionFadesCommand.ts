import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { SetRegionFadesCommand } from "./SetRegionFadesCommand";

export interface BatchFadeEntry {
  trackId: string;
  regionId: string;
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Sets fades on multiple regions atomically.
 */
export class BatchSetRegionFadesCommand implements UndoableCommand {
  private subCommands: SetRegionFadesCommand[] = [];

  constructor(
    private session: Session,
    private entries: BatchFadeEntry[],
  ) {}

  public async execute(): Promise<void> {
    this.subCommands = this.entries.map(
      (e) =>
        new SetRegionFadesCommand(
          this.session,
          e.trackId,
          e.regionId,
          e.fadeIn,
          e.fadeOut,
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
