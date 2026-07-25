import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { AudioEngine } from "../../audio/AudioEngine";
import { TrackId, RegionId } from "../../domain/types";
import { Region } from "../../domain/Region";
import { Source } from "../../domain/Source";
import { Processor } from "../../processing/Processor";

/**
 * FreezeTrackCommand
 *
 * Renders the track's audio (with effects) to a single buffer, replacing
 * the plugin chain with direct playback.
 */
export class FreezeTrackCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private audioEngine: AudioEngine;
  private trackId: TrackId;

  // Saved state for undo
  private originalRegions: Region[] = [];
  private frozenRegion: Region | null = null;
  private frozenSource: Source | null = null;
  private disabledProcessorIds: string[] = [];

  constructor(session: Session, audioEngine: AudioEngine, trackId: TrackId) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.audioEngine = audioEngine;
    this.trackId = trackId;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) {
      throw new Error(`Track ${this.trackId} not found`);
    }

    if (track.frozen) {
      throw new Error(`Track ${this.trackId} is already frozen`);
    }

    const regions = track.playlist.getRegions();

    if (regions.length > 0) {
      // Save original regions
      this.originalRegions = [...regions];

      const regionIds = regions.map((r) => r.id);

      // Render all regions with effects to a single buffer
      const audioBuffer = await this.audioEngine.renderRegionsToBuffer(
        this.trackId,
        regionIds,
      );

      // Calculate bounds
      let minStart = Infinity;
      let maxEnd = -Infinity;
      for (const r of regions) {
        if (r.start < minStart) minStart = r.start;
        if (r.end > maxEnd) maxEnd = r.end;
      }

      // Create frozen source
      const sourceId = crypto.randomUUID();
      this.frozenSource = new Source(
        sourceId,
        `Frozen: ${track.name}`,
        `frozen://${sourceId}`,
        audioBuffer.length,
        audioBuffer.sampleRate,
        audioBuffer.numberOfChannels,
      );

      this.session.addSource(this.frozenSource);

      // Remove original regions
      for (const id of regionIds) {
        track.playlist.removeRegion(id);
      }

      // Create frozen region
      this.frozenRegion = new Region(
        crypto.randomUUID() as RegionId,
        this.frozenSource.id,
        minStart,
        audioBuffer.length,
        0,
        `${track.name} (Frozen)`,
      );

      track.playlist.addRegion(this.frozenRegion);

      // Save processor IDs that are active (we disable them during freeze)
      this.disabledProcessorIds = track.route.processors.map(
        (p: Processor) => p.id,
      );

      track.frozenSourceId = this.frozenSource.id;
    }

    // Mark track as frozen
    track.setFrozen(true);
  }

  public async undo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    if (this.frozenRegion) {
      // Remove frozen region
      track.playlist.removeRegion(this.frozenRegion.id);

      // Restore original regions
      for (const region of this.originalRegions) {
        track.playlist.addRegion(region);
      }
    }

    // Unfreeze
    track.frozenSourceId = null;
    track.setFrozen(false);
  }

  public async redo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track || !this.frozenRegion) return;

    // Remove restored regions
    for (const region of this.originalRegions) {
      track.playlist.removeRegion(region.id);
    }

    // Re-add frozen region
    track.playlist.addRegion(this.frozenRegion);

    // Re-freeze
    track.frozenSourceId = this.frozenSource?.id ?? null;
    track.setFrozen(true);
  }
}
