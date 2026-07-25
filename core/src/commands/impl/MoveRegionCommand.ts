import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";
import { CrossfadeEngine } from "../../domain/CrossfadeEngine";

export class MoveRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private targetTrackId: TrackId;
  private regionId: RegionId;
  private newStart: FrameCount;
  private oldStart: FrameCount | null = null;
  private oldFades: Map<RegionId, { fadeIn: FrameCount; fadeOut: FrameCount }> =
    new Map();
  private targetTrackOldFades: Map<
    RegionId,
    { fadeIn: FrameCount; fadeOut: FrameCount }
  > = new Map();
  private rippleApplied: boolean = false;
  private oldRegionStarts: Map<RegionId, FrameCount> = new Map();
  private isCrossTrack: boolean = false;

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    newStart: FrameCount,
    targetTrackId?: TrackId,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.targetTrackId = targetTrackId || trackId;
    this.regionId = regionId;
    this.newStart = newStart;
    this.isCrossTrack = this.targetTrackId !== this.trackId;
  }

  public async execute(): Promise<void> {
    const sourceTrack = this.session.getTrack(this.trackId);
    if (!sourceTrack) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    const region = sourceTrack.playlist.getRegion(this.regionId);
    if (!region) {
      throw new Error(`Region ${this.regionId} not found`);
    }

    this.oldStart = region.start;

    if (this.isCrossTrack) {
      const targetTrack = this.session.getTrack(this.targetTrackId);
      if (!targetTrack) {
        throw new Error(`Target track ${this.targetTrackId} not found`);
      }

      // Save fades on both tracks
      sourceTrack.playlist.getRegions().forEach((r) => {
        this.oldFades.set(r.id, { fadeIn: r.fadeIn, fadeOut: r.fadeOut });
      });
      targetTrack.playlist.getRegions().forEach((r) => {
        this.targetTrackOldFades.set(r.id, {
          fadeIn: r.fadeIn,
          fadeOut: r.fadeOut,
        });
      });

      // Remove from source track
      sourceTrack.playlist.removeRegion(this.regionId);

      // Move to new position
      region.move(this.newStart);

      // Add to target track
      targetTrack.playlist.addRegion(region);

      // Recalculate crossfades on both tracks
      CrossfadeEngine.calculateCrossfades([
        ...sourceTrack.playlist.getRegions(),
      ]);
      CrossfadeEngine.calculateCrossfades([
        ...targetTrack.playlist.getRegions(),
      ]);
    } else {
      // Same-track move (original logic)

      // Save all region starts before any modification (for undo)
      sourceTrack.playlist.getRegions().forEach((r) => {
        this.oldRegionStarts.set(r.id, r.start);
      });

      // Save state of all regions on the track before crossfades are applied
      sourceTrack.playlist.getRegions().forEach((r) => {
        this.oldFades.set(r.id, { fadeIn: r.fadeIn, fadeOut: r.fadeOut });
      });

      // Remove region first so rippleShift does not affect it
      sourceTrack.playlist.removeRegion(this.regionId);

      // Ripple edit logic
      if (this.session.rippleEdit) {
        this.rippleApplied = true;
        const delta = this.newStart - this.oldStart;

        if (delta > 0) {
          sourceTrack.playlist.rippleShift(this.newStart, delta);
        } else if (delta < 0) {
          sourceTrack.playlist.rippleShift(
            this.oldStart + region.length,
            delta,
          );
        }
      }

      region.move(this.newStart);

      // Re-add region to trigger AudioEngine update and sort
      sourceTrack.playlist.addRegion(region);

      // Apply automatic crossfades to the sorted playlist
      CrossfadeEngine.calculateCrossfades([
        ...sourceTrack.playlist.getRegions(),
      ]);
    }
  }

  public async undo(): Promise<void> {
    if (this.oldStart === null) return;

    if (this.isCrossTrack) {
      const targetTrack = this.session.getTrack(this.targetTrackId);
      const sourceTrack = this.session.getTrack(this.trackId);
      if (!targetTrack || !sourceTrack) return;

      const region = targetTrack.playlist.getRegion(this.regionId);
      if (!region) return;

      // Remove from target track
      targetTrack.playlist.removeRegion(this.regionId);

      // Restore position
      region.move(this.oldStart);

      // Add back to source track
      sourceTrack.playlist.addRegion(region);

      // Restore fades on source track
      this.oldFades.forEach((fades, id) => {
        const r = sourceTrack.playlist.getRegion(id);
        if (r) {
          r.fadeIn = fades.fadeIn;
          r.fadeOut = fades.fadeOut;
        }
      });

      // Restore fades on target track
      this.targetTrackOldFades.forEach((fades, id) => {
        const r = targetTrack.playlist.getRegion(id);
        if (r) {
          r.fadeIn = fades.fadeIn;
          r.fadeOut = fades.fadeOut;
        }
      });
    } else {
      const track = this.session.getTrack(this.trackId);
      if (track) {
        const region = track.playlist.getRegion(this.regionId);
        if (region) {
          // Restore all region positions if ripple was applied
          if (this.rippleApplied) {
            track.playlist.getRegions().forEach((r) => {
              const oldStart = this.oldRegionStarts.get(r.id);
              if (oldStart !== undefined && r.id !== this.regionId) {
                r.move(oldStart);
                track.playlist.regionChanged.emit(r);
              }
            });
          }

          track.playlist.removeRegion(this.regionId);
          region.move(this.oldStart);

          // Restore previous fades for all regions on the track
          this.oldFades.forEach((fades, id) => {
            const r = track.playlist.getRegion(id);
            if (r) {
              r.fadeIn = fades.fadeIn;
              r.fadeOut = fades.fadeOut;
            }
          });

          track.playlist.addRegion(region);
        }
      }
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
