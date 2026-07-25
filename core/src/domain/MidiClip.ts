import { MidiNote, MidiNoteId, MidiNoteSnapshot } from "./MidiNote";
import { FrameCount } from "./types";
import { Signal } from "../lib/Signal";

/**
 * MidiClip - Container that holds MIDI note data.
 * Analogous to an audio Source but for MIDI data.
 * Provides batch operations like quantize, transpose, and velocity editing.
 */
export class MidiClip {
  public readonly id: string;
  public name: string;
  private _notes: MidiNote[] = [];

  // Signals
  public readonly changed = new Signal<void>();

  constructor(id: string, name: string, notes?: MidiNote[]) {
    this.id = id;
    this.name = name;
    if (notes) {
      this._notes = [...notes];
      this.sortNotes();
    }
  }

  public get notes(): ReadonlyArray<MidiNote> {
    return this._notes;
  }

  public addNote(note: MidiNote): void {
    this._notes.push(note);
    this.sortNotes();
    this.changed.emit();
  }

  public removeNote(noteId: MidiNoteId): MidiNote | undefined {
    const index = this._notes.findIndex((n) => n.id === noteId);
    if (index === -1) return undefined;
    const removed = this._notes.splice(index, 1)[0];
    this.changed.emit();
    return removed;
  }

  public getNote(noteId: MidiNoteId): MidiNote | undefined {
    return this._notes.find((n) => n.id === noteId);
  }

  /**
   * Quantize all note start positions to the given subdivision.
   * @param subdivisionFrames - Grid size in frames (e.g., frames per quarter note)
   */
  public quantize(subdivisionFrames: FrameCount): void {
    if (subdivisionFrames <= 0) return;

    for (const note of this._notes) {
      const quantized =
        Math.round(note.startFrame / subdivisionFrames) * subdivisionFrames;
      note.startFrame = quantized;
    }

    this.sortNotes();
    this.changed.emit();
  }

  /**
   * Transpose all notes by the given number of semitones.
   * @param semitones - Number of semitones to shift (positive = up, negative = down)
   */
  public transpose(semitones: number): void {
    if (semitones === 0) return;

    for (const note of this._notes) {
      note.transpose(semitones);
    }

    this.changed.emit();
  }

  /**
   * Set velocity of all notes.
   * @param velocity - MIDI velocity (0-127)
   */
  public setVelocityAll(velocity: number): void {
    const clamped = Math.max(0, Math.min(127, Math.round(velocity)));

    for (const note of this._notes) {
      note.velocity = clamped;
    }

    this.changed.emit();
  }

  /**
   * Scale all velocities by a factor.
   * @param factor - Multiplier (1.0 = no change)
   */
  public scaleVelocity(factor: number): void {
    for (const note of this._notes) {
      note.velocity = Math.max(
        0,
        Math.min(127, Math.round(note.velocity * factor)),
      );
    }

    this.changed.emit();
  }

  /**
   * Get total duration of the clip in frames.
   */
  public getDuration(): FrameCount {
    if (this._notes.length === 0) return 0;
    let maxEnd = 0;
    for (const note of this._notes) {
      maxEnd = Math.max(maxEnd, note.endFrame);
    }
    return maxEnd;
  }

  /**
   * Get notes in a given frame range.
   */
  public getNotesInRange(
    startFrame: FrameCount,
    endFrame: FrameCount,
  ): MidiNote[] {
    return this._notes.filter(
      (n) => n.endFrame > startFrame && n.startFrame < endFrame,
    );
  }

  private sortNotes(): void {
    this._notes.sort((a, b) => a.startFrame - b.startFrame);
  }

  public toJSON(): MidiClipSnapshot {
    return {
      id: this.id,
      name: this.name,
      notes: this._notes.map((n) => n.toJSON()),
    };
  }

  public static fromJSON(data: MidiClipSnapshot): MidiClip {
    const notes = data.notes.map((n) => MidiNote.fromJSON(n));
    return new MidiClip(data.id, data.name, notes);
  }
}

export interface MidiClipSnapshot {
  id: string;
  name: string;
  notes: MidiNoteSnapshot[];
}
