import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId } from "../../domain/types";

export class SetTrackVolumeCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private newVolume: number;
  /** Snapshot of volume for the primary track and all linked siblings. */
  private oldStates: Map<TrackId, number> = new Map();

  constructor(session: Session, trackId: TrackId, volume: number) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.newVolume = volume;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    // Snapshot the primary track + any linked siblings
    this.oldStates.set(this.trackId, track.route.volume);

    const group = this.session.getTrackGroupForTrack(this.trackId);
    if (group?.gainLinked) {
      for (const memberId of group.memberTrackIds) {
        if (memberId === this.trackId) continue;
        const sibling = this.session.getTrack(memberId);
        if (sibling) this.oldStates.set(memberId, sibling.route.volume);
      }
    }

    // Setting volume triggers gainChanged signal → TrackGroupLinkingService propagates
    track.route.volume = this.newVolume;
  }

  public async undo(): Promise<void> {
    for (const [trackId, oldVolume] of this.oldStates) {
      const track = this.session.getTrack(trackId);
      if (track) track.route.volume = oldVolume;
    }
  }

  public async redo(): Promise<void> {
    this.oldStates.clear();
    await this.execute();
  }
}
