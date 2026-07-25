import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";

export class AddBusTrackCommand implements UndoableCommand {
  private name: string;
  private trackId: string | null = null;

  constructor(name: string) {
    this.name = name;
  }

  public get id(): string | null {
    return this.trackId;
  }

  public async execute(): Promise<void> {
    const track = AudioEngine.getInstance().session.addBusTrack(
      this.name,
      this.trackId || undefined,
    );
    this.trackId = track.id;
  }

  public async undo(): Promise<void> {
    if (this.trackId) {
      AudioEngine.getInstance().removeTrack(this.trackId);
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
