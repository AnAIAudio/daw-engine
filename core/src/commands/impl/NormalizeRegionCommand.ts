import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackId, RegionId } from "../../domain/types";

/**
 * NormalizeRegionCommand
 *
 * Adjusts a region's gain so peak reaches target level.
 */
export class NormalizeRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private audioEngine: AudioEngine;
  private trackId: TrackId;
  private regionId: RegionId;
  private targetDb: number;

  // Saved state for undo
  private previousGain: number | null = null;
  private newGain: number = 1.0;

  constructor(
    session: Session,
    audioEngine: AudioEngine,
    trackId: TrackId,
    regionId: RegionId,
    targetDb: number = 0,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.audioEngine = audioEngine;
    this.trackId = trackId;
    this.regionId = regionId;
    this.targetDb = targetDb;
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

    // Save old gain
    this.previousGain = region.gain;

    // Get the gain needed to normalize
    const gainNeeded = await this.audioEngine.normalizeRegion(
      this.trackId,
      this.regionId,
      this.targetDb,
    );

    // Apply gain (multiply existing gain by normalization factor)
    this.newGain = region.gain * gainNeeded;
    region.gain = this.newGain;

    // Notify backend
    track.playlist.regionChanged.emit(region);
  }

  public async undo(): Promise<void> {
    if (this.previousGain === null) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    region.gain = this.previousGain;
    track.playlist.regionChanged.emit(region);
  }

  public async redo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    region.gain = this.newGain;
    track.playlist.regionChanged.emit(region);
  }
}
