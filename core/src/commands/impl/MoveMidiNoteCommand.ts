import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { MidiNoteId } from "../../domain/MidiNote";
import { FrameCount } from "../../domain/types";

export class MoveMidiNoteCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: string;
  private regionId: string;
  private noteId: MidiNoteId;
  private newStartFrame?: FrameCount;
  private newPitch?: number;

  private oldStartFrame: FrameCount | null = null;
  private oldPitch: number | null = null;

  constructor(
    session: Session,
    trackId: string,
    regionId: string,
    noteId: MidiNoteId,
    newStartFrame?: FrameCount,
    newPitch?: number,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.noteId = noteId;
    this.newStartFrame = newStartFrame;
    this.newPitch = newPitch;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const midiRegion = track.playlist.getMidiRegion(this.regionId);
    if (!midiRegion) throw new Error(`MIDI Region ${this.regionId} not found`);

    const note = midiRegion.getNote(this.noteId);
    if (!note) throw new Error(`MIDI Note ${this.noteId} not found`);

    // Save old state
    this.oldStartFrame = note.startFrame;
    this.oldPitch = note.pitch;

    // Apply changes
    if (this.newStartFrame !== undefined) {
      note.move(this.newStartFrame);
    }
    if (this.newPitch !== undefined) {
      note.setPitch(this.newPitch);
    }
  }

  public async undo(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const midiRegion = track.playlist.getMidiRegion(this.regionId);
    if (!midiRegion) return;

    const note = midiRegion.getNote(this.noteId);
    if (!note) return;

    if (this.oldStartFrame !== null) {
      note.move(this.oldStartFrame);
    }
    if (this.oldPitch !== null) {
      note.setPitch(this.oldPitch);
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
