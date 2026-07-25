import { Signal } from "../lib/Signal";
import { TrackId } from "./types";

/**
 * Track Group
 *
 * Groups multiple tracks so they share linked controls (gain, mute, solo, etc.).
 */
export class TrackGroup {
  public readonly id: string;
  public name: string;

  private _memberTrackIds: Set<TrackId> = new Set();

  // Linked properties
  public gainLinked: boolean = true;
  public muteLinked: boolean = true;
  public soloLinked: boolean = true;
  public colorLinked: boolean = false;
  /** When true, selecting a region on one member track auto-selects equivalent regions on siblings. */
  public regionSelectLinked: boolean = false;

  // Signals
  public readonly memberAdded = new Signal<TrackId>();
  public readonly memberRemoved = new Signal<TrackId>();
  public readonly changed = new Signal<void>();

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  public addMember(trackId: TrackId): void {
    if (!this._memberTrackIds.has(trackId)) {
      this._memberTrackIds.add(trackId);
      this.memberAdded.emit(trackId);
      this.changed.emit();
    }
  }

  public removeMember(trackId: TrackId): void {
    if (this._memberTrackIds.has(trackId)) {
      this._memberTrackIds.delete(trackId);
      this.memberRemoved.emit(trackId);
      this.changed.emit();
    }
  }

  public hasMember(trackId: TrackId): boolean {
    return this._memberTrackIds.has(trackId);
  }

  public get memberTrackIds(): ReadonlyArray<TrackId> {
    return Array.from(this._memberTrackIds);
  }

  public get size(): number {
    return this._memberTrackIds.size;
  }

  public setLinked(
    property: "gain" | "mute" | "solo" | "color" | "regionSelect",
    linked: boolean,
  ): void {
    switch (property) {
      case "gain":
        this.gainLinked = linked;
        break;
      case "mute":
        this.muteLinked = linked;
        break;
      case "solo":
        this.soloLinked = linked;
        break;
      case "color":
        this.colorLinked = linked;
        break;
      case "regionSelect":
        this.regionSelectLinked = linked;
        break;
    }
    this.changed.emit();
  }

  public toJSON(): TrackGroupSnapshot {
    return {
      id: this.id,
      name: this.name,
      memberTrackIds: Array.from(this._memberTrackIds),
      gainLinked: this.gainLinked,
      muteLinked: this.muteLinked,
      soloLinked: this.soloLinked,
      colorLinked: this.colorLinked,
      regionSelectLinked: this.regionSelectLinked,
    };
  }

  public static fromJSON(data: TrackGroupSnapshot): TrackGroup {
    const group = new TrackGroup(data.id, data.name);
    for (const trackId of data.memberTrackIds) {
      group._memberTrackIds.add(trackId);
    }
    group.gainLinked = data.gainLinked;
    group.muteLinked = data.muteLinked;
    group.soloLinked = data.soloLinked;
    group.colorLinked = data.colorLinked;
    group.regionSelectLinked = data.regionSelectLinked ?? false;
    return group;
  }
}

export interface TrackGroupSnapshot {
  id: string;
  name: string;
  memberTrackIds: string[];
  gainLinked: boolean;
  muteLinked: boolean;
  soloLinked: boolean;
  colorLinked: boolean;
  regionSelectLinked?: boolean;
}
