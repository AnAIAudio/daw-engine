import { Signal } from "../lib/Signal";
import { RegionId, FrameCount, TrackId } from "./types";

/**
 * Take
 *
 * A Take represents one recording pass during loop recording.
 * Multiple takes are stacked in a take lane for comping.
 */
export class Take {
  public readonly id: string;
  public readonly takeNumber: number;
  public readonly regionId: RegionId;
  public readonly trackId: TrackId;
  public readonly startFrame: FrameCount;
  public readonly endFrame: FrameCount;
  public selected: boolean = false;
  public readonly timestamp: number;

  public readonly selectionChanged = new Signal<boolean>();

  constructor(
    id: string,
    takeNumber: number,
    regionId: RegionId,
    trackId: TrackId,
    startFrame: FrameCount,
    endFrame: FrameCount,
  ) {
    this.id = id;
    this.takeNumber = takeNumber;
    this.regionId = regionId;
    this.trackId = trackId;
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.timestamp = Date.now();
  }

  public get duration(): FrameCount {
    return this.endFrame - this.startFrame;
  }

  public setSelected(selected: boolean): void {
    if (this.selected !== selected) {
      this.selected = selected;
      this.selectionChanged.emit(selected);
    }
  }

  public toJSON(): TakeSnapshot {
    return {
      id: this.id,
      takeNumber: this.takeNumber,
      regionId: this.regionId,
      trackId: this.trackId,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      selected: this.selected,
      timestamp: this.timestamp,
    };
  }

  public static fromJSON(data: TakeSnapshot): Take {
    const take = new Take(
      data.id,
      data.takeNumber,
      data.regionId as RegionId,
      data.trackId as TrackId,
      data.startFrame,
      data.endFrame,
    );
    take.selected = data.selected;
    return take;
  }
}

export interface TakeSnapshot {
  id: string;
  takeNumber: number;
  regionId: string;
  trackId: string;
  startFrame: number;
  endFrame: number;
  selected: boolean;
  timestamp: number;
}

/**
 * TakeLane manages multiple takes for a single loop recording session.
 */
export class TakeLane {
  public readonly id: string;
  public readonly trackId: TrackId;
  private _takes: Take[] = [];

  public readonly takeAdded = new Signal<Take>();
  public readonly takeRemoved = new Signal<string>();
  public readonly activeChanged = new Signal<Take | null>();

  constructor(id: string, trackId: TrackId) {
    this.id = id;
    this.trackId = trackId;
  }

  public addTake(take: Take): void {
    this._takes.push(take);
    this.takeAdded.emit(take);
  }

  public removeTake(takeId: string): void {
    this._takes = this._takes.filter((t) => t.id !== takeId);
    this.takeRemoved.emit(takeId);
  }

  public getTake(takeId: string): Take | undefined {
    return this._takes.find((t) => t.id === takeId);
  }

  public get takes(): ReadonlyArray<Take> {
    return this._takes;
  }

  public get takeCount(): number {
    return this._takes.length;
  }

  /**
   * Select a specific take (deselects all others).
   */
  public selectTake(takeId: string): void {
    let activeTake: Take | null = null;
    for (const take of this._takes) {
      const shouldSelect = take.id === takeId;
      take.setSelected(shouldSelect);
      if (shouldSelect) activeTake = take;
    }
    this.activeChanged.emit(activeTake);
  }

  /**
   * Get the currently selected (active) take.
   */
  public getActiveTake(): Take | undefined {
    return this._takes.find((t) => t.selected);
  }

  /**
   * Comp: merge selected portions from multiple takes into one.
   * Returns the regionIds of selected takes.
   */
  public getSelectedTakeRegionIds(): RegionId[] {
    return this._takes.filter((t) => t.selected).map((t) => t.regionId);
  }
}
