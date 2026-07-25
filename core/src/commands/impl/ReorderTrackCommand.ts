import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId } from "../../domain/types";

export class ReorderTrackCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private newIndex: number;
  private oldIndex: number = -1;

  constructor(session: Session, trackId: TrackId, newIndex: number) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.newIndex = newIndex;
  }

  public async execute(): Promise<void> {
    this.oldIndex = this.session.getTrackIndex(this.trackId);
    if (this.oldIndex === -1) {
      throw new Error(`Track not found: ${this.trackId}`);
    }
    this.session.reorderTrack(this.trackId, this.newIndex);
  }

  public async undo(): Promise<void> {
    if (this.oldIndex === -1) return;
    this.session.reorderTrack(this.trackId, this.oldIndex);
  }

  public async redo(): Promise<void> {
    this.session.reorderTrack(this.trackId, this.newIndex);
  }
}
