import { Command } from "../Command";
import { Session } from "../../domain/Session";
import { AudioEngine } from "../../audio/AudioEngine";
import { Region } from "../../domain/Region";
import { TimeDomain } from "../../domain/temporal/types";

import { logger } from "../../utils/Logger";
export class SetRegionTimeDomainCommand implements Command {
  private previousTimeDomain!: TimeDomain; // Definite assignment assertion

  constructor(
    private session: Session,
    private trackId: string,
    private regionId: string,
    private newTimeDomain: TimeDomain,
  ) {}

  async execute(): Promise<void> {
    logger.debug(
      "SetRegionTimeDomainCommand",
      `Executing: trackId=${this.trackId}, regionId=${this.regionId}, newTimeDomain=${this.newTimeDomain}`,
    );

    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const region = track.playlist.getRegion(this.regionId);
    if (!region) throw new Error(`Region ${this.regionId} not found`);

    logger.debug(
      "SetRegionTimeDomainCommand",
      `Found region "${region.name}", current timeDomain=${region.timeDomain}`,
    );

    this.previousTimeDomain = region.timeDomain;
    region.timeDomain = this.newTimeDomain;

    logger.debug(
      "SetRegionTimeDomainCommand",
      `Updated region timeDomain to ${this.newTimeDomain}`,
    );

    this.updateBackend(region);
  }

  async undo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    region.timeDomain = this.previousTimeDomain;
    this.updateBackend(region);
  }

  async redo(): Promise<void> {
    await this.execute();
  }

  private updateBackend(_region: Region) {
    const audioEngine = AudioEngine.getInstance();
    // updateRegion already builds clean DTOs from the track's regions
    audioEngine.updateRegion(this.trackId, _region);
  }
}
