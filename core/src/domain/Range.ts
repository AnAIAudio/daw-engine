import { FrameCount, RangeId } from "./types";
import { Signal } from "../lib/Signal";

/**
 * Range (Named Timespan)
 *
 * Timeline에서 특정 구간을 나타내는 named range입니다.
 * Export 시 사용하거나, Loop/Punch 영역으로 활용할 수 있습니다.
 */
export class Range {
  public readonly id: RangeId;
  public name: string;
  public start: FrameCount;
  public end: FrameCount;
  public color?: string;

  // Signals
  public readonly changed = new Signal<void>();
  public readonly removed = new Signal<void>();

  constructor(
    id: RangeId,
    name: string,
    start: FrameCount,
    end: FrameCount,
    color?: string,
  ) {
    this.id = id;
    this.name = name;
    this.start = start;
    this.end = end;
    this.color = color;
  }

  public setName(name: string): void {
    this.name = name;
    this.changed.emit();
  }

  public setRange(start: FrameCount, end: FrameCount): void {
    if (end <= start) {
      throw new Error("Range end must be greater than start");
    }
    this.start = start;
    this.end = end;
    this.changed.emit();
  }

  public setColor(color: string): void {
    this.color = color;
    this.changed.emit();
  }

  public get length(): FrameCount {
    return this.end - this.start;
  }

  public contains(frame: FrameCount): boolean {
    return frame >= this.start && frame < this.end;
  }

  public overlaps(other: Range): boolean {
    return this.start < other.end && this.end > other.start;
  }

  public clone(): Range {
    return new Range(
      crypto.randomUUID() as RangeId,
      this.name,
      this.start,
      this.end,
      this.color,
    );
  }

  public toDTO() {
    return {
      id: this.id,
      name: this.name,
      start: this.start,
      end: this.end,
      length: this.length,
      color: this.color,
    };
  }
}
