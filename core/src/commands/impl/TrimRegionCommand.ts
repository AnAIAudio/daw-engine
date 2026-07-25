import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";
import { CrossfadeEngine } from "../../domain/CrossfadeEngine";

/**
 * Trim a region's front or back by a delta amount.
 * Features:
 * - Source boundary constraints
 * - Non-overlap trim (automatically adjusts adjacent regions)
 * - Ripple editing support
 * - Crossfade recalculation
 * - Fade clamping
 */
export class TrimRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private amount: FrameCount;
  private direction: "front" | "back";
  private noOverlap: boolean;

  private oldStart: FrameCount | null = null;
  private oldLength: FrameCount | null = null;
  private oldSourceStart: FrameCount | null = null;
  private oldFadeIn: FrameCount | null = null;
  private oldFadeOut: FrameCount | null = null;
  private oldFades: Map<RegionId, { fadeIn: FrameCount; fadeOut: FrameCount }> =
    new Map();
  private rippleApplied: boolean = false;
  private oldRegionStarts: Map<RegionId, FrameCount> = new Map();
  private adjacentTrimmed: {
    regionId: RegionId;
    oldStart: FrameCount;
    oldLength: FrameCount;
    oldSourceStart: FrameCount;
  } | null = null;

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    amount: FrameCount,
    direction: "front" | "back",
    noOverlap: boolean = false,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.amount = amount;
    this.direction = direction;
    this.noOverlap = noOverlap;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const region = track.playlist.getRegion(this.regionId);
    if (!region) throw new Error(`Region ${this.regionId} not found`);

    // Reject if locked
    if (region.locked) {
      throw new Error(`Region ${this.regionId} is locked`);
    }

    // Save state for undo
    this.oldStart = region.start;
    this.oldLength = region.length;
    this.oldSourceStart = region.sourceStart;
    this.oldFadeIn = region.fadeIn;
    this.oldFadeOut = region.fadeOut;

    track.playlist.getRegions().forEach((r) => {
      this.oldFades.set(r.id, { fadeIn: r.fadeIn, fadeOut: r.fadeOut });
      this.oldRegionStarts.set(r.id, r.start);
    });

    const oldEnd = region.end;

    // Get source duration for boundary constraint
    const source = this.session.getSource(region.sourceId);
    const sourceDuration = source?.duration;

    // Clamp amount to source boundaries
    let clampedAmount = this.amount;

    if (this.direction === "front") {
      // Cannot move sourceStart before 0
      if (region.sourceStart + clampedAmount < 0) {
        clampedAmount = -region.sourceStart;
      }
      // Cannot trim past end
      if (clampedAmount >= region.length) {
        return;
      }
      // Source boundary: sourceStart + clampedAmount + newLength <= sourceDuration
      if (sourceDuration !== undefined) {
        const newSourceStart = region.sourceStart + clampedAmount;
        const newLength = region.length - clampedAmount;
        if (newSourceStart + newLength > sourceDuration) {
          // Cannot extend beyond source
          return;
        }
      }
    } else {
      // Cannot make length <= 0
      if (region.length + clampedAmount < 1) {
        return;
      }
      // Source boundary: sourceStart + newLength <= sourceDuration
      if (sourceDuration !== undefined) {
        const newLength = region.length + clampedAmount;
        if (region.sourceStart + newLength > sourceDuration) {
          clampedAmount = sourceDuration - region.sourceStart - region.length;
          if (clampedAmount <= 0) return;
        }
      }
    }

    if (clampedAmount === 0) return;

    track.playlist.removeRegion(this.regionId);

    if (this.direction === "front") {
      region.trimFront(clampedAmount);
    } else {
      region.trimBack(clampedAmount);
    }

    // Non-overlap trim: adjust adjacent regions
    if (this.noOverlap) {
      const regions = track.playlist
        .getRegions()
        .filter((r) => r.layer === region.layer)
        .sort((a, b) => a.start - b.start);

      if (this.direction === "front" && clampedAmount < 0) {
        // Extending front: find previous region and trim its end
        const prev = [...regions]
          .reverse()
          .find((r) => r.end > region.start && r.start < region.start);
        if (prev) {
          this.adjacentTrimmed = {
            regionId: prev.id,
            oldStart: prev.start,
            oldLength: prev.length,
            oldSourceStart: prev.sourceStart,
          };
          prev.trimEndTo(region.start, sourceDuration);
        }
      } else if (this.direction === "back" && clampedAmount > 0) {
        // Extending back: find next region and trim its front
        const next = regions.find(
          (r) => r.start < region.end && r.start > region.start,
        );
        if (next) {
          this.adjacentTrimmed = {
            regionId: next.id,
            oldStart: next.start,
            oldLength: next.length,
            oldSourceStart: next.sourceStart,
          };
          const nextSource = this.session.getSource(next.sourceId);
          next.trimFrontTo(region.end, nextSource?.duration);
        }
      }
    }

    // Ripple: shift subsequent regions by the length change
    if (this.session.rippleEdit) {
      this.rippleApplied = true;
      const delta = region.length - this.oldLength!;
      if (this.direction === "back") {
        track.playlist.rippleShift(oldEnd, delta);
      }
    }

    track.playlist.addRegion(region);

    // Update crossfades
    CrossfadeEngine.calculateCrossfades([...track.playlist.getRegions()]);
  }

  public async undo(): Promise<void> {
    if (
      this.oldStart === null ||
      this.oldLength === null ||
      this.oldSourceStart === null
    )
      return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    track.playlist.removeRegion(this.regionId);

    // Restore adjacent region if non-overlap was applied
    if (this.adjacentTrimmed) {
      const adj = track.playlist.getRegion(this.adjacentTrimmed.regionId);
      if (adj) {
        adj.start = this.adjacentTrimmed.oldStart;
        adj.length = this.adjacentTrimmed.oldLength;
        adj.sourceStart = this.adjacentTrimmed.oldSourceStart;
      }
    }

    // Restore all region positions if ripple was applied
    if (this.rippleApplied) {
      track.playlist.getRegions().forEach((r) => {
        const oldStart = this.oldRegionStarts.get(r.id);
        if (oldStart !== undefined) {
          r.move(oldStart);
        }
      });
    }

    region.start = this.oldStart;
    region.length = this.oldLength;
    region.sourceStart = this.oldSourceStart;
    if (this.oldFadeIn !== null) region.fadeIn = this.oldFadeIn;
    if (this.oldFadeOut !== null) region.fadeOut = this.oldFadeOut;

    this.oldFades.forEach((fades, id) => {
      const r = track.playlist.getRegion(id);
      if (r) {
        r.fadeIn = fades.fadeIn;
        r.fadeOut = fades.fadeOut;
      }
    });

    track.playlist.addRegion(region);

    CrossfadeEngine.calculateCrossfades([...track.playlist.getRegions()]);
  }

  public async redo(): Promise<void> {
    this.rippleApplied = false;
    this.adjacentTrimmed = null;
    this.oldRegionStarts.clear();
    this.oldFades.clear();
    await this.execute();
  }
}
