import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackType } from "../../domain/Track";

export class AddTrackCommand implements UndoableCommand {
  private name: string;
  private trackId: string | null = null;
  private type: TrackType;

  constructor(name: string, type: TrackType = TrackType.AUDIO) {
    this.name = name;
    this.type = type;
  }

  public get id(): string | null {
    return this.trackId;
  }

  public async execute(): Promise<void> {
    // redo logic utilizes the stored trackId if it exists to maintain identity
    const track = AudioEngine.getInstance().addTrack(
      this.name,
      this.type,
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
