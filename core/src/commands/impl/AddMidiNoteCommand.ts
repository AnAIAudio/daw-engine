import { UndoableCommand } from "../Command";
import { Session } from "../../domain/Session";
import { MidiNote, MidiNoteId } from "../../domain/MidiNote";
import { FrameCount } from "../../domain/types";

export class AddMidiNoteCommand implements UndoableCommand {
  public readonly id: string;
  private session: Session;
  private trackId: string;
  private regionId: string;
  private pitch: number;
  private velocity: number;
  private startFrame: FrameCount;
  private durationFrames: FrameCount;
  private channel: number;

  private noteId: MidiNoteId | null = null;

  constructor(
    session: Session,
    trackId: string,
    regionId: string,
    pitch: number,
    velocity: number,
    startFrame: FrameCount,
    durationFrames: FrameCount,
    channel: number = 0,
  ) {
    this.id = crypto.randomUUID();
    this.session = session;
    this.trackId = trackId;
    this.regionId = regionId;
    this.pitch = pitch;
    this.velocity = velocity;
    this.startFrame = startFrame;
    this.durationFrames = durationFrames;
    this.channel = channel;
  }

  public async execute(): Promise<void> {
    const track = this.session.getTrack(this.trackId);
    if (!track) throw new Error(`Track ${this.trackId} not found`);

    const midiRegion = track.playlist.getMidiRegion(this.regionId);
    if (!midiRegion) throw new Error(`MIDI Region ${this.regionId} not found`);

    const id = this.noteId || crypto.randomUUID();
    const note = new MidiNote(
      id,
      this.pitch,
      this.velocity,
      this.startFrame,
      this.durationFrames,
      this.channel,
    );
    midiRegion.addNote(note);
    this.noteId = note.id;
  }

  public async undo(): Promise<void> {
    if (!this.noteId) return;

    const track = this.session.getTrack(this.trackId);
    if (!track) return;

    const midiRegion = track.playlist.getMidiRegion(this.regionId);
    if (midiRegion) {
      midiRegion.removeNote(this.noteId);
    }
  }

  public async redo(): Promise<void> {
    await this.execute();
  }

  public getNoteId(): MidiNoteId | null {
    return this.noteId;
  }
}
