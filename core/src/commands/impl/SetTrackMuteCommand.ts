import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId } from "../../domain/types";

export class SetTrackMuteCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private newMute: boolean;
  /** Snapshot of mute state for the primary track and all linked siblings. */
  private oldStates: Map<TrackId, boolean> = new Map();

  constructor(session: Session, trackId: TrackId, mute: boolean) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.newMute = mute;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    // Snapshot the primary track + any linked siblings
    this.oldStates.set(this.trackId, track.mute);

    const group = this.session.getTrackGroupForTrack(this.trackId);
    if (group?.muteLinked) {
      for (const memberId of group.memberTrackIds) {
        if (memberId === this.trackId) continue;
        const sibling = this.session.getTrack(memberId);
        if (sibling) this.oldStates.set(memberId, sibling.mute);
      }
    }

    // setMute triggers the signal → TrackGroupLinkingService propagates to siblings
    track.setMute(this.newMute);
  }

  public async undo(): Promise<void> {
    // Restore all affected tracks to their pre-execute state
    for (const [trackId, oldMute] of this.oldStates) {
      const track = this.session.getTrack(trackId);
      if (track) track.setMute(oldMute);
    }
  }

  public async redo(): Promise<void> {
    this.oldStates.clear();
    await this.execute();
  }
}
