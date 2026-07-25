import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackId, RegionId } from "../../domain/types";

/**
 * TimeStretchRegionCommand
 *
 * Applies pitch-preserving time stretch to a region. Unlike simple playbackRate which
 * changes both speed and pitch, this preserves pitch while changing speed
 * (or changes pitch while preserving speed).
 */
export class TimeStretchRegionCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private audioEngine: AudioEngine;
  private trackId: TrackId;
  private regionId: RegionId;
  private stretch: number;
  private pitchSemitones: number;

  private previousStretch: number | null = null;
  private previousPitchSemitones: number | null = null;

  constructor(
    session: Session,
    audioEngine: AudioEngine,
    trackId: TrackId,
    regionId: RegionId,
    stretch: number,
    pitchSemitones: number,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.audioEngine = audioEngine;
    this.trackId = trackId;
    this.regionId = regionId;
    this.stretch = stretch;
    this.pitchSemitones = pitchSemitones;
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

    this.previousStretch = region.stretch;
    this.previousPitchSemitones = region.pitchSemitones;

    region.stretch = this.stretch;
    region.pitchSemitones = this.pitchSemitones;

    // Notify backend to re-render with new stretch parameters
    this.audioEngine.updateRegion(this.trackId, region);
  }

  public async undo(): Promise<void> {
    if (this.previousStretch === null) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    region.stretch = this.previousStretch;
    region.pitchSemitones = this.previousPitchSemitones ?? 0;
    this.audioEngine.updateRegion(this.trackId, region);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
