import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { MidiNote, MidiNoteId } from "../../domain/MidiNote";

export class RemoveMidiNoteCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: string;
  private regionId: string;
  private noteId: MidiNoteId;

  private removedNote: MidiNote | null = null;

  constructor(
    session: Session,
    trackId: string,
    regionId: string,
    noteId: MidiNoteId,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.noteId = noteId;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const midiRegion = track.playlist.getMidiRegion(this.regionId);
    if (!midiRegion) throw new Error(`MIDI Region ${this.regionId} not found`);

    const note = midiRegion.getNote(this.noteId);
    if (!note) throw new Error(`MIDI Note ${this.noteId} not found`);

    this.removedNote = note;
    midiRegion.removeNote(this.noteId);
  }

  public async undo(): Promise<void> {
    if (!this.removedNote) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const midiRegion = track.playlist.getMidiRegion(this.regionId);
    if (midiRegion) {
      midiRegion.addNote(this.removedNote);
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }
}
