import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";

/**
 * Trim region to fit within a specified range (loop, punch, or selection).
 *
 * The region must overlap the range. Both front and back are clipped
 * to the range boundaries.
 */
export class TrimRegionToRangeCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private rangeStart: FrameCount;
  private rangeEnd: FrameCount;

  private oldStart: FrameCount | null = null;
  private oldLength: FrameCount | null = null;
  private oldSourceStart: FrameCount | null = null;
  private oldFadeIn: FrameCount | null = null;
  private oldFadeOut: FrameCount | null = null;

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    rangeStart: FrameCount,
    rangeEnd: FrameCount,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.rangeStart = rangeStart;
    this.rangeEnd = rangeEnd;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const region = track.playlist.getRegion(this.regionId);
    if (!region) throw new Error(`Region ${this.regionId} not found`);

    // Region must overlap the range
    if (region.end <= this.rangeStart || region.start >= this.rangeEnd) return;

    // Save state for undo
    this.oldStart = region.start;
    this.oldLength = region.length;
    this.oldSourceStart = region.sourceStart;
    this.oldFadeIn = region.fadeIn;
    this.oldFadeOut = region.fadeOut;

    const source = this.session.getSource(region.sourceId);
    const sourceDuration = source?.duration;

    // Calculate new position and length clipped to range
    const newPosition = Math.max(region.start, this.rangeStart);
    const newEnd = Math.min(region.end, this.rangeEnd);
    const newLength = newEnd - newPosition;

    if (newLength <= 0) return;

    region.trimTo(newPosition, newLength, sourceDuration);
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

    region.start = this.oldStart;
    region.length = this.oldLength;
    region.sourceStart = this.oldSourceStart;
    if (this.oldFadeIn !== null) region.fadeIn = this.oldFadeIn;
    if (this.oldFadeOut !== null) region.fadeOut = this.oldFadeOut;
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
