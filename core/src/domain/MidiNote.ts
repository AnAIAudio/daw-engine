import { Signal } from "../lib/Signal";
import { FrameCount } from "./types";

export type MidiNoteId = string;

export class MidiNote {
  public readonly id: MidiNoteId;
  public pitch: number; // 0-127
  public velocity: number; // 0-127
  public startFrame: FrameCount;
  public durationFrames: FrameCount;
  public channel: number; // 0-15

  // Signals
  public readonly changed = new Signal<MidiNote>();

  constructor(
    id: MidiNoteId,
    pitch: number,
    velocity: number,
    startFrame: FrameCount,
    durationFrames: FrameCount,
    channel: number = 0,
  ) {
    this.id = id;
    this.pitch = Math.max(0, Math.min(127, Math.round(pitch)));
    this.velocity = Math.max(0, Math.min(127, Math.round(velocity)));
    this.startFrame = startFrame;
    this.durationFrames = durationFrames;
    this.channel = Math.max(0, Math.min(15, Math.round(channel)));
  }

  public get endFrame(): FrameCount {
    return this.startFrame + this.durationFrames;
  }

  public setPitch(pitch: number): void {
    const clamped = Math.max(0, Math.min(127, Math.round(pitch)));
    if (this.pitch !== clamped) {
      this.pitch = clamped;
      this.changed.emit(this);
    }
  }

  public setVelocity(velocity: number): void {
    const clamped = Math.max(0, Math.min(127, Math.round(velocity)));
    if (this.velocity !== clamped) {
      this.velocity = clamped;
      this.changed.emit(this);
    }
  }

  public move(newStartFrame: FrameCount): void {
    if (newStartFrame < 0) newStartFrame = 0;
    if (this.startFrame !== newStartFrame) {
      this.startFrame = newStartFrame;
      this.changed.emit(this);
    }
  }

  public resize(newDuration: FrameCount): void {
    if (newDuration < 1) newDuration = 1;
    if (this.durationFrames !== newDuration) {
      this.durationFrames = newDuration;
      this.changed.emit(this);
    }
  }

  public transpose(semitones: number): void {
    const newPitch = Math.max(0, Math.min(127, this.pitch + semitones));
    if (this.pitch !== newPitch) {
      this.pitch = newPitch;
      this.changed.emit(this);
    }
  }

  /**
   * Get MIDI note name (e.g., "C4", "A#3")
   */
  public getNoteName(): string {
    const noteNames = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ];
    const octave = Math.floor(this.pitch / 12) - 1;
    const noteName = noteNames[this.pitch % 12];
    return `${noteName}${octave}`;
  }

  /**
   * Convert pitch to frequency in Hz
   */
  public getFrequency(): number {
    return 440 * Math.pow(2, (this.pitch - 69) / 12);
  }

  public toJSON(): MidiNoteSnapshot {
    return {
      id: this.id,
      pitch: this.pitch,
      velocity: this.velocity,
      startFrame: this.startFrame,
      durationFrames: this.durationFrames,
      channel: this.channel,
    };
  }

  public static fromJSON(data: MidiNoteSnapshot): MidiNote {
    return new MidiNote(
      data.id,
      data.pitch,
      data.velocity,
      data.startFrame,
      data.durationFrames,
      data.channel,
    );
  }
}

export interface MidiNoteSnapshot {
  id: string;
  pitch: number;
  velocity: number;
  startFrame: number;
  durationFrames: number;
  channel: number;
}
