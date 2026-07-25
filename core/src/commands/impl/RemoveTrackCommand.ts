import { UndoableCommand } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackType } from "../../domain/Track";

export class RemoveTrackCommand implements UndoableCommand {
  private trackId: string;
  // Backup data for undo
  private trackName: string | null = null;
  private trackType: TrackType = TrackType.AUDIO;

  constructor(trackId: string) {
    this.trackId = trackId;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const track = engine.session.getTrack(this.trackId);

    if (track) {
      this.trackName = track.name;
      this.trackType = track.type;
      engine.removeTrack(this.trackId);
    }
  }

  public async undo(): Promise<void> {
    if (this.trackName) {
      AudioEngine.getInstance().addTrack(
        this.trackName,
        this.trackType,
        this.trackId,
      );
    }
  }

  public async redo(): Promise<void> {
    AudioEngine.getInstance().removeTrack(this.trackId);
  }
}
