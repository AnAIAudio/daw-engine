import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { TrackId, RegionId, FrameCount } from "../../domain/types";

/**
 * Trim region start or end to the current playhead position.
 *
 * - 'front': trims region start to playhead (region must contain playhead)
 * - 'back': trims region end to playhead (region must contain playhead)
 */
export class TrimRegionToPlayheadCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: TrackId;
  private regionId: RegionId;
  private direction: "front" | "back";

  private oldStart: FrameCount | null = null;
  private oldLength: FrameCount | null = null;
  private oldSourceStart: FrameCount | null = null;
  private oldFadeIn: FrameCount | null = null;
  private oldFadeOut: FrameCount | null = null;

  constructor(
    session: Session,
    trackId: TrackId,
    regionId: RegionId,
    direction: "front" | "back",
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

    const playhead = this.session.transportFrame;

    // Playhead must be within the region
    if (playhead <= region.start || playhead >= region.end) return;

    // Save state for undo
    this.oldStart = region.start;
    this.oldLength = region.length;
    this.oldSourceStart = region.sourceStart;
    this.oldFadeIn = region.fadeIn;
    this.oldFadeOut = region.fadeOut;

    // Get source duration for boundary checking
    const source = this.session.getSource(region.sourceId);
    const sourceDuration = source?.duration;

    if (this.direction === "front") {
      region.trimFrontTo(playhead, sourceDuration);
    } else {
      region.trimEndTo(playhead, sourceDuration);
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
