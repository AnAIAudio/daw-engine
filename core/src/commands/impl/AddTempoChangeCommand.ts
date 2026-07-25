import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";

export class AddTempoChangeCommand implements UndoableCommand {
  private frame: number;
  private bpm: number;
  private timeSigNum?: number;
  private timeSigDen?: number;
  /** Backup of previous event at this frame for undo (null if none existed) */
  private previousEvent: {
    bpm: number;
    timeSigNum?: number;
    timeSigDen?: number;
  } | null = null;
  private wasNew: boolean = true;

  constructor(
    frame: number,
    bpm: number,
    timeSigNum?: number,
    timeSigDen?: number,
  ) {
    this.frame = frame;
    this.bpm = bpm;
    this.timeSigNum = timeSigNum;
    this.timeSigDen = timeSigDen;
  }

  public async execute(): Promise<void> {
    const tempoMap = AudioEngine.getInstance().session.tempoMap;

    // Check if an event already exists at this frame (for undo backup)
    const existing = tempoMap
      .getAllEvents()
      .find((e) => e.frame === this.frame);
    if (existing) {
      this.previousEvent = {
        bpm: existing.bpm,
        timeSigNum: existing.timeSigNum,
        timeSigDen: existing.timeSigDen,
      };
      this.wasNew = false;
    } else {
      this.wasNew = true;
    }

    tempoMap.addTempoChange(
      this.frame,
      this.bpm,
      this.timeSigNum,
      this.timeSigDen,
    );
  }

  public async undo(): Promise<void> {
    const tempoMap = AudioEngine.getInstance().session.tempoMap;

    if (this.wasNew) {
      // It was a new event, so remove it
      tempoMap.removeTempoChange(this.frame);
    } else if (this.previousEvent) {
      // Restore the previous values
      tempoMap.addTempoChange(
        this.frame,
        this.previousEvent.bpm,
        this.previousEvent.timeSigNum,
        this.previousEvent.timeSigDen,
      );
    }
  }

  public async redo(): Promise<void> {
    const tempoMap = AudioEngine.getInstance().session.tempoMap;
    tempoMap.addTempoChange(
      this.frame,
      this.bpm,
      this.timeSigNum,
      this.timeSigDen,
    );
  }
}
