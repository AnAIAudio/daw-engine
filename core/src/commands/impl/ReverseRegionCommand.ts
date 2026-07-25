import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackId, RegionId } from "../../domain/types";

/**
 * ReverseRegionCommand
 *
 * Reverses the audio buffer of a region in-place.
 * Undo restores the original (un-reversed) buffer.
 */
export class ReverseRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private audioEngine: AudioEngine;
  private trackId: TrackId;
  private regionId: RegionId;

  constructor(
    session: Session,
    audioEngine: AudioEngine,
    trackId: TrackId,
    regionId: RegionId,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.audioEngine = audioEngine;
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

    await this.audioEngine.reverseRegionBuffer(this.trackId, this.regionId);

    // Notify listeners
    track.playlist.regionChanged.emit(region);
  }

  public async undo(): Promise<void> {
    // Reversing again restores the original
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    await this.audioEngine.reverseRegionBuffer(this.trackId, this.regionId);
    track.playlist.regionChanged.emit(region);
  }

  public async redo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    await this.audioEngine.reverseRegionBuffer(this.trackId, this.regionId);
    track.playlist.regionChanged.emit(region);
  }
}
