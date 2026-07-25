import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId } from "../../domain/types";

export class LockRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private locked: boolean;
  private previousLocked: boolean | null = null;

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    locked: boolean,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.locked = locked;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    const region = track.playlist.getRegion(this.regionId);
    if (!region) {
      throw new Error(`Region ${this.regionId} not found`);
    }

    this.previousLocked = region.locked;
    region.setLocked(this.locked);
  }

  public async undo(): Promise<void> {
    if (this.previousLocked === null) return;

    const track = this.session.getTrack(this.trackId);
    if (track) {
      const region = track.playlist.getRegion(this.regionId);
      if (region) {
        region.setLocked(this.previousLocked);
      }
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
