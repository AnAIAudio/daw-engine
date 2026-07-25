import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";

import { logger } from "../../utils/Logger";
/**
 * Toggle Loop Command
 * Loop 활성화/비활성화를 토글합니다.
 */
export class ToggleLoopCommand implements Command {
  private oldValue: boolean = false;
  private autoAssignedRangeId: string | undefined;

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    this.oldValue = session.loopEnabled;

    // If no loop range is set but ranges exist, auto-assign the first one
    if (!session.loopRangeId && session.ranges.length > 0) {
      this.autoAssignedRangeId = session.ranges[0].id;
      session.setLoopRange(session.ranges[0].id);
    }

    session.toggleLoop();

    logger.debug(
      "ToggleLoopCommand",
      `Loop ${session.loopEnabled ? "enabled" : "disabled"}`,
    );
  }

  public async undo(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    session.setLoopEnabled(this.oldValue);

    // If we auto-assigned a loop range, clear it on undo
    if (this.autoAssignedRangeId) {
      session.clearLoopRange();
      this.autoAssignedRangeId = undefined;
    }

    logger.debug("ToggleLoopCommand", `Restored loop state: ${this.oldValue}`);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
