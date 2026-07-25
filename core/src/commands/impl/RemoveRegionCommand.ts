import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";
import { Region } from "../../domain/Region";

export class RemoveRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private removedRegion: Region | null = null;
  private rippleApplied: boolean = false;
  private oldRegionStarts: Map<RegionId, FrameCount> = new Map();

  constructor(session: Session, trackId: TrackId, regionId: RegionId) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
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

    this.removedRegion = region;
    const regionEnd = region.end;
    const regionLength = region.length;

    // Save all region starts for undo
    track.playlist.getRegions().forEach((r) => {
      this.oldRegionStarts.set(r.id, r.start);
    });

    track.playlist.removeRegion(this.regionId);

    // Ripple: pull subsequent regions left by removed region's length
    if (this.session.rippleEdit) {
      this.rippleApplied = true;
      track.playlist.rippleShift(regionEnd, -regionLength);
    }
  }

  public async undo(): Promise<void> {
    if (!this.removedRegion) return;

    const track = this.session.getTrack(this.trackId);
    if (track) {
      // Restore all region positions if ripple was applied
      if (this.rippleApplied) {
        track.playlist.getRegions().forEach((r) => {
          const oldStart = this.oldRegionStarts.get(r.id);
          if (oldStart !== undefined) {
            r.move(oldStart);
          }
        });
      }

      track.playlist.addRegion(this.removedRegion);
    }
  }

  public async redo(): Promise<void> {
    // Reset state for re-execution
    this.rippleApplied = false;
    this.oldRegionStarts.clear();
    await this.execute();
  }
}
