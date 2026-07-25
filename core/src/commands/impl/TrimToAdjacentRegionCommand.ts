import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";

/**
 * Trim region to an adjacent region's boundary to eliminate gaps/overlaps.
 *
 * - 'forward': trim end to the start of the next region
 * - 'backward': trim start to the end of the previous region
 */
export class TrimToAdjacentRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private direction: "forward" | "backward";

  private oldStart: FrameCount | null = null;
  private oldLength: FrameCount | null = null;
  private oldSourceStart: FrameCount | null = null;
  private oldFadeIn: FrameCount | null = null;
  private oldFadeOut: FrameCount | null = null;

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    direction: "forward" | "backward",
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.direction = direction;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const region = track.playlist.getRegion(this.regionId);
    if (!region) throw new Error(`Region ${this.regionId} not found`);

    const regions = track.playlist
      .getRegions()
      .filter((r) => r.id !== this.regionId && r.layer === region.layer)
      .sort((a, b) => a.start - b.start);

    // Save state for undo
    this.oldStart = region.start;
    this.oldLength = region.length;
    this.oldSourceStart = region.sourceStart;
    this.oldFadeIn = region.fadeIn;
    this.oldFadeOut = region.fadeOut;

    const source = this.session.getSource(region.sourceId);
    const sourceDuration = source?.duration;

    if (this.direction === "forward") {
      // Find next region (starts after this region's start)
      const next = regions.find((r) => r.start > region.start);
      if (!next) return; // No next region
      // Trim end to start of next region
      region.trimEndTo(next.start, sourceDuration);
    } else {
      // Find previous region (ends before this region's end)
      const prev = [...regions]
        .reverse()
        .find((r) => r.end <= region.end && r.start < region.start);
      if (!prev) return; // No previous region
      // Trim front to end of previous region
      region.trimFrontTo(prev.end, sourceDuration);
    }
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
