import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId } from "../../domain/types";

export class SetTrackPanCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private newPan: number;
  private oldPan: number | null = null;

  constructor(session: Session, trackId: TrackId, pan: number) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.newPan = pan;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    this.oldPan = track.route.pan;
    track.route.pan = this.newPan;
  }

  public async undo(): Promise<void> {
    if (this.oldPan === null) return;

    const track = this.session.getTrack(this.trackId);
    if (track) {
      track.route.pan = this.oldPan;
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
