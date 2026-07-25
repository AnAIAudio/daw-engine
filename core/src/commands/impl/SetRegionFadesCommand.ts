import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";

export class SetRegionFadesCommand implements UndoableCommand {
  private session: Session;
  private trackId: string;
  private regionId: string;

  private newFadeIn?: number;
  private newFadeOut?: number;

  private oldFadeIn: number = 0;
  private oldFadeOut: number = 0;

  constructor(
    session: Session,
    trackId: string,
    regionId: string,
    fadeIn?: number,
    fadeOut?: number,
  ) {
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.newFadeIn = fadeIn;
    this.newFadeOut = fadeOut;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const region = track.playlist.getRegion(this.regionId);
    if (!region) throw new Error(`Region ${this.regionId} not found`);

    this.oldFadeIn = region.fadeIn;
    this.oldFadeOut = region.fadeOut;

    // Force a removal and addition to let any UI components naturally re-render if they rely on playlist events
    track.playlist.removeRegion(this.regionId);

    if (this.newFadeIn !== undefined) {
      region.setFadeIn(this.newFadeIn);
    }

    if (this.newFadeOut !== undefined) {
      region.setFadeOut(this.newFadeOut);
    }

    track.playlist.addRegion(region); // Trigger update event
  }

  public async undo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const region = track.playlist.getRegion(this.regionId);
    if (!region) return;

    track.playlist.removeRegion(this.regionId);
    region.fadeIn = this.oldFadeIn; // direct assignment to restore exactly, bypassing guard assertions just in case
    region.fadeOut = this.oldFadeOut;
    track.playlist.addRegion(region);
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
