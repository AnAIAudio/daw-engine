import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { Region } from "../../domain/Region";
import { FrameCount, RegionId } from "../../domain/types";

export class AddRegionCommand implements UndoableCommand {
  private session: Session;
  private trackId: string;
  private sourceId: string;
  private start: FrameCount;
  private duration: FrameCount;
  private sourceStart: FrameCount;

  // State
  private regionId: string | null = null;
  private rippleApplied: boolean = false;
  private oldRegionStarts: Map<RegionId, FrameCount> = new Map();

  constructor(
    session: Session,
    trackId: string,
    sourceId: string,
    start: FrameCount,
    duration: FrameCount,
    sourceStart: FrameCount = 0,
  ) {
    this.session = session;
    this.trackId = trackId;
    this.sourceId = sourceId;
    this.start = start;
    this.duration = duration;
    this.sourceStart = sourceStart;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    // Save all region starts for undo
    track.playlist.getRegions().forEach((r) => {
      this.oldRegionStarts.set(r.id as RegionId, r.start);
    });

    // Ripple: push subsequent regions right to make room
    if (this.session.rippleEdit) {
      this.rippleApplied = true;
      track.playlist.rippleShift(this.start, this.duration);
    }

    // Create region (reuse ID on redo)
    const id = this.regionId || crypto.randomUUID();
    const region = new Region(
      id,
      this.sourceId,
      this.start,
      this.duration,
      this.sourceStart,
      "Region",
    );

    track.playlist.addRegion(region);
    this.regionId = region.id;
  }

  public async undo(): Promise<void> {
    if (!this.regionId) return;

    const track = this.session.getTrack(this.trackId);
    if (track) {
      track.playlist.removeRegion(this.regionId);

      // Restore all region positions if ripple was applied
      if (this.rippleApplied) {
        track.playlist.getRegions().forEach((r) => {
          const oldStart = this.oldRegionStarts.get(r.id as RegionId);
          if (oldStart !== undefined) {
            r.move(oldStart);
          }
        });
      }
    }
  }

  public async redo(): Promise<void> {
    this.rippleApplied = false;
    this.oldRegionStarts.clear();
    await this.execute();
  }
}
