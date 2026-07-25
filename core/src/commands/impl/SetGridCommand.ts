import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { GridType, SnapMode } from "../../domain/GridSettings";

import { logger } from "../../utils/Logger";
/**
 * Set Grid Command
 * Grid와 Snap 설정을 변경합니다.
 */
export class SetGridCommand implements Command {
  private gridType?: GridType;
  private snapMode?: SnapMode;
  private snapToGrid?: boolean;
  private bpm?: number;

  constructor(options: {
    gridType?: GridType;
    snapMode?: SnapMode;
    snapToGrid?: boolean;
    bpm?: number;
  }) {
    this.gridType = options.gridType;
    this.snapMode = options.snapMode;
    this.snapToGrid = options.snapToGrid;
    this.bpm = options.bpm;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;
    const gridSettings = session.gridSettings;

    if (this.gridType !== undefined) {
      gridSettings.setGridType(this.gridType);
      logger.debug("SetGridCommand", `Grid type: ${this.gridType}`);
    }

    if (this.snapMode !== undefined) {
      gridSettings.setSnapMode(this.snapMode);
      logger.debug("SetGridCommand", `Snap mode: ${this.snapMode}`);
    }

    if (this.snapToGrid !== undefined) {
      gridSettings.setSnapToGrid(this.snapToGrid);
      logger.debug("SetGridCommand", `Snap to grid: ${this.snapToGrid}`);
    }

    if (this.bpm !== undefined) {
      gridSettings.setBPM(this.bpm);
      logger.debug("SetGridCommand", `BPM: ${this.bpm}`);
    }
  }
}
