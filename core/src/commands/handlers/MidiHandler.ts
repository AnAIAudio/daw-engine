import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
  getTrackOrThrow,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { UndoableCommand } from "../Command";
import { CommandType } from "../types";
import { AddMidiNoteCommand } from "../impl/AddMidiNoteCommand";
import { RemoveMidiNoteCommand } from "../impl/RemoveMidiNoteCommand";
import { MoveMidiNoteCommand } from "../impl/MoveMidiNoteCommand";

/**
 * MIDI Command Handler
 *
 * Handles MIDI note editing, quantization, transposition, and instrument changes.
 */
export class MidiHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.ADD_MIDI_NOTE,
    CommandType.REMOVE_MIDI_NOTE,
    CommandType.MOVE_MIDI_NOTE,
    CommandType.RESIZE_MIDI_NOTE,
    CommandType.QUANTIZE_MIDI,
    CommandType.TRANSPOSE_MIDI,
    CommandType.SET_MIDI_INSTRUMENT,
  ]);

  canHandle(commandType: string): boolean {
    return this.supportedCommands.has(commandType);
  }

  async execute(
    commandType: string,
    payload: CommandHandlerPayload | undefined,
    audioEngine: AudioEngine,
    history: CommandHistory,
  ): Promise<CommandResult> {
    if (!payload) {
      return { success: false, message: `${commandType} requires a payload` };
    }

    switch (commandType) {
      case CommandType.ADD_MIDI_NOTE: {
        const cmd = new AddMidiNoteCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.regionId as string,
          payload.pitch as number,
          payload.velocity as number,
          payload.startFrame as number,
          payload.durationFrames as number,
          payload.channel as number,
        );
        await history.execute(cmd);
        return {
          success: true,
          message: `MIDI note added (pitch: ${payload.pitch})`,
          data: { noteId: cmd.getNoteId() },
        };
      }

      case CommandType.REMOVE_MIDI_NOTE: {
        const cmd = new RemoveMidiNoteCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.regionId as string,
          payload.noteId as string,
        );
        await history.execute(cmd);
        return { success: true, message: "MIDI note removed" };
      }

      case CommandType.MOVE_MIDI_NOTE: {
        const cmd = new MoveMidiNoteCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.regionId as string,
          payload.noteId as string,
          payload.newStartFrame as number | undefined,
          payload.newPitch as number | undefined,
        );
        await history.execute(cmd);
        return { success: true, message: "MIDI note moved" };
      }

      case CommandType.RESIZE_MIDI_NOTE: {
        const track = getTrackOrThrow(audioEngine, payload.trackId as string);
        const midiRegion = track.playlist.getMidiRegion(
          payload.regionId as string,
        );
        if (!midiRegion) {
          return {
            success: false,
            message: `MIDI Region ${payload.regionId} not found`,
          };
        }

        const note = midiRegion.getNote(payload.noteId as string);
        if (!note) {
          return {
            success: false,
            message: `MIDI Note ${payload.noteId} not found`,
          };
        }

        note.resize(payload.newDurationFrames as number);
        return {
          success: true,
          message: `MIDI note resized to ${payload.newDurationFrames} frames`,
        };
      }

      case CommandType.QUANTIZE_MIDI: {
        const track = getTrackOrThrow(audioEngine, payload.trackId as string);
        const midiRegion = track.playlist.getMidiRegion(
          payload.regionId as string,
        );
        if (!midiRegion) {
          return {
            success: false,
            message: `MIDI Region ${payload.regionId} not found`,
          };
        }

        const subdivisionFrames = payload.subdivisionFrames as number;
        const notes = midiRegion.getNotes();

        // Save original positions for undo
        const originalPositions = new Map<string, number>();
        for (const note of notes) {
          originalPositions.set(note.id, note.startFrame);
        }

        const quantizeCmd: UndoableCommand = {
          async execute() {
            for (const note of notes) {
              const quantized =
                Math.round(note.startFrame / subdivisionFrames) *
                subdivisionFrames;
              note.move(quantized);
            }
          },
          async undo() {
            for (const note of notes) {
              const original = originalPositions.get(note.id);
              if (original !== undefined) {
                note.move(original);
              }
            }
          },
          async redo() {
            for (const note of notes) {
              const quantized =
                Math.round(
                  (originalPositions.get(note.id) ?? note.startFrame) /
                    subdivisionFrames,
                ) * subdivisionFrames;
              note.move(quantized);
            }
          },
        };
        await history.execute(quantizeCmd);

        return {
          success: true,
          message: `MIDI region quantized (subdivision: ${subdivisionFrames} frames)`,
        };
      }

      case CommandType.TRANSPOSE_MIDI: {
        const track = getTrackOrThrow(audioEngine, payload.trackId as string);
        const midiRegion = track.playlist.getMidiRegion(
          payload.regionId as string,
        );
        if (!midiRegion) {
          return {
            success: false,
            message: `MIDI Region ${payload.regionId} not found`,
          };
        }

        const semitones = payload.semitones as number;
        const notes = midiRegion.getNotes();

        // Save original pitches for undo
        const originalPitches = new Map<string, number>();
        for (const note of notes) {
          originalPitches.set(note.id, note.pitch);
        }

        const transposeCmd: UndoableCommand = {
          async execute() {
            for (const note of notes) {
              note.transpose(semitones);
            }
          },
          async undo() {
            for (const note of notes) {
              const original = originalPitches.get(note.id);
              if (original !== undefined) {
                note.setPitch(original);
              }
            }
          },
          async redo() {
            for (const note of notes) {
              note.transpose(semitones);
            }
          },
        };
        await history.execute(transposeCmd);

        return {
          success: true,
          message: `MIDI region transposed by ${semitones} semitones`,
        };
      }

      case CommandType.SET_MIDI_INSTRUMENT: {
        audioEngine.setMidiInstrument(
          payload.trackId as string,
          payload.instrumentType as string,
        );
        return {
          success: true,
          message: `MIDI instrument set to ${payload.instrumentType}`,
        };
      }

      default:
        throw new Error(`Unsupported MIDI command: ${commandType}`);
    }
  }
}
