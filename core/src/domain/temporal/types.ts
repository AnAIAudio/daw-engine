/** Time domain for position/duration */
export enum TimeDomain {
  /** Absolute time (samples/seconds), BPM-independent */
  AudioTime = 0,
  /** Musical time (beats/bars), BPM-dependent */
  BeatTime = 1,
}

/** Ticks per beat (subdivision for precise fractional beats) */
export const TICKS_PER_BEAT = 1920;

/** Beats as fractional quarters */
export class Beats {
  private _ticks: number; // Internal representation in ticks

  constructor(beats: number = 0) {
    this._ticks = Math.round(beats * TICKS_PER_BEAT);
  }

  static fromTicks(ticks: number): Beats {
    const b = new Beats();
    b._ticks = Math.round(ticks);
    return b;
  }

  toNumber(): number {
    return this._ticks / TICKS_PER_BEAT;
  }

  toTicks(): number {
    return this._ticks;
  }

  add(other: Beats): Beats {
    return Beats.fromTicks(this._ticks + other._ticks);
  }

  subtract(other: Beats): Beats {
    return Beats.fromTicks(this._ticks - other._ticks);
  }

  multiply(factor: number): Beats {
    return Beats.fromTicks(Math.round(this._ticks * factor));
  }

  equals(other: Beats): boolean {
    return this._ticks === other._ticks;
  }

  lessThan(other: Beats): boolean {
    return this._ticks < other._ticks;
  }

  greaterThan(other: Beats): boolean {
    return this._ticks > other._ticks;
  }
}

/** Position with time domain */
export interface TimePosition {
  domain: TimeDomain;
  /** Value in domain-specific units (samples or ticks) */
  value: number;
}

/** Create position from frames */
export function fromFrames(frames: number): TimePosition {
  return { domain: TimeDomain.AudioTime, value: frames };
}

/** Create position from beats */
export function fromBeats(beats: Beats): TimePosition {
  return { domain: TimeDomain.BeatTime, value: beats.toTicks() };
}
