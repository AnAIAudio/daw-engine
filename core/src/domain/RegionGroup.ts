import { Signal } from "../lib/Signal";

export type RegionGroupId = string;

export class RegionGroup {
  public readonly id: RegionGroupId;
  public name: string;
  private _regionIds: Set<string> = new Set();

  // Signals
  public readonly changed = new Signal<RegionGroup>();

  constructor(id: RegionGroupId, name: string, regionIds?: string[]) {
    this.id = id;
    this.name = name;
    if (regionIds) {
      for (const rid of regionIds) {
        this._regionIds.add(rid);
      }
    }
  }

  public get regionIds(): ReadonlySet<string> {
    return this._regionIds;
  }

  public addRegion(regionId: string): void {
    this._regionIds.add(regionId);
    this.changed.emit(this);
  }

  public removeRegion(regionId: string): void {
    this._regionIds.delete(regionId);
    this.changed.emit(this);
  }

  public hasRegion(regionId: string): boolean {
    return this._regionIds.has(regionId);
  }

  public get size(): number {
    return this._regionIds.size;
  }

  public getRegionIds(): string[] {
    return Array.from(this._regionIds);
  }
}
