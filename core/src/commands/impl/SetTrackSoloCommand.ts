import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId } from "../../domain/types";

export class SetTrackSoloCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private newSolo: boolean;
  /** Snapshot of solo state for the primary track and all linked siblings. */
  private oldStates: Map<TrackId, boolean> = new Map();

  constructor(session: Session, trackId: TrackId, solo: boolean) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.newSolo = solo;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    // Snapshot the primary track + any linked siblings
    this.oldStates.set(this.trackId, track.solo);

    const group = this.session.getTrackGroupForTrack(this.trackId);
    if (group?.soloLinked) {
      for (const memberId of group.memberTrackIds) {
        if (memberId === this.trackId) continue;
        const sibling = this.session.getTrack(memberId);
        if (sibling) this.oldStates.set(memberId, sibling.solo);
      }
    }

    // setSolo triggers the signal → TrackGroupLinkingService propagates to siblings
    track.setSolo(this.newSolo);
  }

  public async undo(): Promise<void> {
    for (const [trackId, oldSolo] of this.oldStates) {
      const track = this.session.getTrack(trackId);
      if (track) track.setSolo(oldSolo);
    }
  }

  public async redo(): Promise<void> {
    this.oldStates.clear();
    await this.execute();
  }
}
