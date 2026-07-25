/**
 * MIDI Importer — bridges MidiFileParser output to domain models.
 * Creates MidiClip/MidiRegion/Track from parsed MIDI file data.
 */

import { MidiFileData, MidiFileTrack, parseMidiFile } from "./MidiFileParser";
import { MidiClip } from "../domain/MidiClip";
import { MidiNote } from "../domain/MidiNote";
import { MidiRegion } from "../domain/MidiRegion";

export interface MidiImportResult {
  /** Parsed file metadata */
  fileData: MidiFileData;
  /** One MidiClip per track in the file */
  clips: MidiClip[];
  /** One MidiRegion per track, positioned at startFrame */
  regions: MidiRegion[];
}

/**
 * Import a MIDI file from an ArrayBuffer.
 *
 * @param data Raw .mid file bytes
 * @param sampleRate Session sample rate (for tick-to-frame conversion)
 * @param startFrame Where to place the imported regions on the timeline
 */
export function importMidiFile(
  data: ArrayBuffer,
  sampleRate: number = 44100,
  startFrame: number = 0,
): MidiImportResult {
  const fileData = parseMidiFile(data, sampleRate);

  const clips: MidiClip[] = [];
  const regions: MidiRegion[] = [];

  for (let i = 0; i < fileData.tracks.length; i++) {
    const track = fileData.tracks[i];

    // Skip empty tracks (common in Type 1 — track 0 is often tempo-only)
    if (track.notes.length === 0) continue;

    const clipId = crypto.randomUUID();
    const regionId = crypto.randomUUID();

    // Create MidiNotes from parsed data
    const midiNotes: MidiNote[] = track.notes.map((n) => {
      return new MidiNote(
        crypto.randomUUID(),
        n.pitch,
        n.velocity,
        n.startFrame,
        n.durationFrames,
        n.channel,
      );
    });

    // Create MidiClip
    const clip = new MidiClip(clipId, track.name, midiNotes);
    clips.push(clip);

    // Create MidiRegion
    const clipDuration = clip.getDuration();
    const region = new MidiRegion(
      regionId,
      track.name,
      startFrame,
      clipDuration,
    );

    // Add notes to region
    for (const note of midiNotes) {
      // Clone notes for the region (they're separate from clip notes)
      const regionNote = new MidiNote(
        crypto.randomUUID(),
        note.pitch,
        note.velocity,
        note.startFrame,
        note.durationFrames,
        note.channel,
      );
      region.addNote(regionNote);
    }

    regions.push(region);
  }

  return { fileData, clips, regions };
}

/**
 * Export MidiRegions to MIDI file data for the writer.
 */
export function exportMidiRegions(
  regions: MidiRegion[],
  sampleRate: number = 44100,
): {
  name: string;
  notes: Array<{
    pitch: number;
    velocity: number;
    channel: number;
    startFrame: number;
    durationFrames: number;
  }>;
}[] {
  return regions.map((region) => ({
    name: region.name,
    notes: region.getNotes().map((n) => ({
      pitch: n.pitch,
      velocity: n.velocity,
      channel: n.channel,
      startFrame: n.startFrame,
      durationFrames: n.durationFrames,
    })),
  }));
}
