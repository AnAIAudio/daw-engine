/**
 * Standard MIDI File (SMF) Writer
 *
 * Generates SMF Type 1 files from MidiRegion/MidiNote data.
 */

export interface MidiWriteNote {
  pitch: number; // 0-127
  velocity: number; // 0-127
  channel: number; // 0-15
  startFrame: number;
  durationFrames: number;
}

export interface MidiWriteTrack {
  name: string;
  notes: MidiWriteNote[];
}

export interface MidiWriteOptions {
  ticksPerBeat?: number;
  tempo?: number; // BPM
  sampleRate?: number;
}

/**
 * Write a Standard MIDI File (Type 1) to an ArrayBuffer.
 */
export function writeMidiFile(
  tracks: MidiWriteTrack[],
  options: MidiWriteOptions = {},
): ArrayBuffer {
  const ticksPerBeat = options.ticksPerBeat ?? 480;
  const tempo = options.tempo ?? 120;
  const sampleRate = options.sampleRate ?? 44100;

  // Convert frames to ticks
  const secondsPerTick = 60 / (tempo * ticksPerBeat);
  const framesToTicks = (frames: number) =>
    Math.round(frames / (secondsPerTick * sampleRate));

  const trackChunks: Uint8Array[] = [];

  // Track 0: tempo track
  trackChunks.push(buildTempoTrack(tempo, ticksPerBeat));

  // Subsequent tracks: note data
  for (const track of tracks) {
    trackChunks.push(buildNoteTrack(track, framesToTicks));
  }

  // Build file header
  const numTracks = trackChunks.length;
  const headerChunk = buildHeaderChunk(1, numTracks, ticksPerBeat);

  // Calculate total size
  let totalSize = headerChunk.byteLength;
  for (const chunk of trackChunks) {
    totalSize += chunk.byteLength;
  }

  // Combine all chunks
  const result = new Uint8Array(totalSize);
  let offset = 0;

  result.set(new Uint8Array(headerChunk), offset);
  offset += headerChunk.byteLength;

  for (const chunk of trackChunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}

function buildHeaderChunk(
  format: number,
  numTracks: number,
  ticksPerBeat: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);

  // "MThd"
  view.setUint8(0, 0x4d);
  view.setUint8(1, 0x54);
  view.setUint8(2, 0x68);
  view.setUint8(3, 0x64);

  // Header length (always 6)
  view.setUint32(4, 6, false);

  // Format
  view.setUint16(8, format, false);

  // Number of tracks
  view.setUint16(10, numTracks, false);

  // Division (ticks per beat)
  view.setUint16(12, ticksPerBeat, false);

  return buffer;
}

function buildTempoTrack(tempo: number, ticksPerBeat: number): Uint8Array {
  const events: number[] = [];

  // Delta time 0
  events.push(0x00);

  // Set Tempo meta event (FF 51 03 tt tt tt)
  const uspqn = Math.round(60000000 / tempo);
  events.push(0xff, 0x51, 0x03);
  events.push((uspqn >> 16) & 0xff);
  events.push((uspqn >> 8) & 0xff);
  events.push(uspqn & 0xff);

  // End of Track (delta=0)
  events.push(0x00, 0xff, 0x2f, 0x00);

  return wrapTrackChunk(new Uint8Array(events));
}

function buildNoteTrack(
  track: MidiWriteTrack,
  framesToTicks: (frames: number) => number,
): Uint8Array {
  // Build sorted event list
  interface MidiEvent {
    tick: number;
    data: number[];
  }

  const events: MidiEvent[] = [];

  // Track Name meta event
  if (track.name) {
    const nameBytes = new TextEncoder().encode(track.name);
    events.push({
      tick: 0,
      data: [0xff, 0x03, ...writeVLQ(nameBytes.length), ...nameBytes],
    });
  }

  // Note events
  for (const note of track.notes) {
    const startTick = framesToTicks(note.startFrame);
    const endTick = framesToTicks(note.startFrame + note.durationFrames);
    const channel = Math.max(0, Math.min(15, note.channel));

    // Note On
    events.push({
      tick: startTick,
      data: [0x90 | channel, note.pitch & 0x7f, note.velocity & 0x7f],
    });

    // Note Off
    events.push({
      tick: endTick,
      data: [0x80 | channel, note.pitch & 0x7f, 0x40], // release velocity 64
    });
  }

  // Sort by tick, Note Off before Note On at same tick
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    // Note Off (0x80) should come before Note On (0x90)
    const aIsOff = (a.data[0] & 0xf0) === 0x80 ? 0 : 1;
    const bIsOff = (b.data[0] & 0xf0) === 0x80 ? 0 : 1;
    return aIsOff - bIsOff;
  });

  // Convert to byte stream with delta times
  const bytes: number[] = [];
  let prevTick = 0;

  for (const event of events) {
    const delta = Math.max(0, event.tick - prevTick);
    bytes.push(...writeVLQ(delta));
    bytes.push(...event.data);
    prevTick = event.tick;
  }

  // End of Track
  bytes.push(0x00, 0xff, 0x2f, 0x00);

  return wrapTrackChunk(new Uint8Array(bytes));
}

function wrapTrackChunk(trackData: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + trackData.length);
  const view = new DataView(chunk.buffer);

  // "MTrk"
  chunk[0] = 0x4d;
  chunk[1] = 0x54;
  chunk[2] = 0x72;
  chunk[3] = 0x6b;

  // Track length
  view.setUint32(4, trackData.length, false);

  // Track data
  chunk.set(trackData, 8);

  return chunk;
}

function writeVLQ(value: number): number[] {
  if (value < 0) value = 0;
  if (value < 0x80) return [value];

  const bytes: number[] = [];
  let v = value;

  bytes.unshift(v & 0x7f);
  v >>= 7;

  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }

  return bytes;
}

/**
 * Convenience: create a MIDI file Blob from tracks.
 */
export function createMidiBlob(
  tracks: MidiWriteTrack[],
  options?: MidiWriteOptions,
): Blob {
  const buffer = writeMidiFile(tracks, options);
  return new Blob([buffer], { type: "audio/midi" });
}
