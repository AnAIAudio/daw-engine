import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";

export class ResizeRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private newLength: FrameCount;
  private oldLength: FrameCount | null = null;
  private rippleApplied: boolean = false;
  private oldRegionStarts: Map<RegionId, FrameCount> = new Map();

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    newLength: FrameCount,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.newLength = newLength;
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

    this.oldLength = region.length;
    const oldEnd = region.end;

    // Save all region starts for undo
    track.playlist.getRegions().forEach((r) => {
      this.oldRegionStarts.set(r.id, r.start);
    });

    track.playlist.removeRegion(this.regionId);
    region.resize(this.newLength);

    // Ripple: shift subsequent regions by the length difference
    if (this.session.rippleEdit) {
      this.rippleApplied = true;
      const delta = this.newLength - this.oldLength;
      track.playlist.rippleShift(oldEnd, delta);
    }

    track.playlist.addRegion(region);
  }

  public async undo(): Promise<void> {
    if (this.oldLength === null) return;

    const track = this.session.getTrack(this.trackId);
    if (track) {
      const region = track.playlist.getRegion(this.regionId);
      if (region) {
        track.playlist.removeRegion(this.regionId);

        // Restore all region positions if ripple was applied
        if (this.rippleApplied) {
          track.playlist.getRegions().forEach((r) => {
            const oldStart = this.oldRegionStarts.get(r.id);
            if (oldStart !== undefined) {
              r.move(oldStart);
            }
          });
        }

        region.resize(this.oldLength);
        track.playlist.addRegion(region);
      }
    }
  }

  public async redo(): Promise<void> {
    this.rippleApplied = false;
    this.oldRegionStarts.clear();
    await this.execute();
  }
}
