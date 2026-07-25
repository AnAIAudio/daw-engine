import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";

export class RemoveTempoChangeCommand implements UndoableCommand {
  private frame: number;
  /** Backup of the removed event for undo */
  private removedEvent: {
    bpm: number;
    timeSigNum?: number;
    timeSigDen?: number;
  } | null = null;

  constructor(frame: number) {
    this.frame = frame;
  }

  public async execute(): Promise<void> {
    const tempoMap = AudioEngine.getInstance().session.tempoMap;

    // Backup the event before removing
    const existing = tempoMap
      .getAllEvents()
      .find((e) => e.frame === this.frame);
    if (existing) {
      this.removedEvent = {
        bpm: existing.bpm,
        timeSigNum: existing.timeSigNum,
        timeSigDen: existing.timeSigDen,
      };
    }

    tempoMap.removeTempoChange(this.frame);
  }

  public async undo(): Promise<void> {
    if (this.removedEvent) {
      const tempoMap = AudioEngine.getInstance().session.tempoMap;
      tempoMap.addTempoChange(
        this.frame,
        this.removedEvent.bpm,
        this.removedEvent.timeSigNum,
        this.removedEvent.timeSigDen,
      );
    }
  }

  public async redo(): Promise<void> {
    const tempoMap = AudioEngine.getInstance().session.tempoMap;
    tempoMap.removeTempoChange(this.frame);
  }
}
