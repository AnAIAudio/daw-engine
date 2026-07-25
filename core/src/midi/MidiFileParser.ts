/**
 * Standard MIDI File (SMF) Parser
 *
 * Parses SMF Type 0 (single track) and Type 1 (multi-track) files.
 * Converts MIDI ticks to frames based on tempo.
 */

export interface MidiFileNote {
  pitch: number; // 0-127
  velocity: number; // 0-127
  channel: number; // 0-15
  startTick: number; // MIDI ticks from file start
  durationTicks: number;
  startFrame: number; // Computed from tempo
  durationFrames: number;
}

export interface MidiFileTrack {
  name: string;
  notes: MidiFileNote[];
  channel: number;
}

export interface MidiFileData {
  format: number; // 0 or 1
  numTracks: number;
  ticksPerBeat: number;
  tempo: number; // BPM (from first tempo event, default 120)
  tracks: MidiFileTrack[];
}

/**
 * Parse a Standard MIDI File from an ArrayBuffer.
 */
export function parseMidiFile(
  data: ArrayBuffer,
  sampleRate: number = 44100,
): MidiFileData {
  const view = new DataView(data);
  let offset = 0;

  // Read header chunk "MThd"
  const headerTag = readString(view, offset, 4);
  if (headerTag !== "MThd") {
    throw new Error("Not a valid MIDI file: missing MThd header");
  }
  offset += 4;

  const headerLength = view.getUint32(offset, false);
  offset += 4;

  const format = view.getUint16(offset, false);
  offset += 2;
  const numTracks = view.getUint16(offset, false);
  offset += 2;
  const division = view.getUint16(offset, false);
  offset += 2;

  // Skip any remaining header bytes
  offset += headerLength - 6;

  let ticksPerBeat: number;
  if (division & 0x8000) {
    // SMPTE-based: frames per second + ticks per frame
    const fps = -((((division >> 8) & 0xff) << 24) >> 24); // sign-extend
    const tpf = division & 0xff;
    ticksPerBeat = fps * tpf; // approximate
  } else {
    ticksPerBeat = division;
  }

  // Parse track chunks
  let globalTempo = 120; // Default BPM
  const tracks: MidiFileTrack[] = [];

  for (let t = 0; t < numTracks && offset < data.byteLength; t++) {
    const trackTag = readString(view, offset, 4);
    if (trackTag !== "MTrk") {
      throw new Error(`Expected MTrk at offset ${offset}, got ${trackTag}`);
    }
    offset += 4;

    const trackLength = view.getUint32(offset, false);
    offset += 4;

    const trackEnd = offset + trackLength;
    const track = parseTrack(view, offset, trackEnd, ticksPerBeat, sampleRate);

    // Extract tempo if present (first track in Type 1)
    if (track.tempo > 0) {
      globalTempo = track.tempo;
    }

    tracks.push({
      name: track.name || `Track ${t + 1}`,
      notes: track.notes,
      channel: track.channel,
    });

    offset = trackEnd;
  }

  // Apply tempo to convert ticks to frames
  const secondsPerTick = 60 / (globalTempo * ticksPerBeat);
  for (const track of tracks) {
    for (const note of track.notes) {
      note.startFrame = Math.round(
        note.startTick * secondsPerTick * sampleRate,
      );
      note.durationFrames = Math.round(
        note.durationTicks * secondsPerTick * sampleRate,
      );
    }
  }

  return {
    format,
    numTracks,
    ticksPerBeat,
    tempo: globalTempo,
    tracks,
  };
}

interface TrackParseResult {
  name: string;
  notes: MidiFileNote[];
  channel: number;
  tempo: number;
}

function parseTrack(
  view: DataView,
  start: number,
  end: number,
  ticksPerBeat: number,
  sampleRate: number,
): TrackParseResult {
  let offset = start;
  let tick = 0;
  let name = "";
  let tempo = 0;
  let primaryChannel = 0;

  // Track active notes for Note-On/Note-Off pairing
  const activeNotes = new Map<
    string,
    { pitch: number; velocity: number; channel: number; startTick: number }
  >();
  const notes: MidiFileNote[] = [];

  let prevStatus = 0;

  while (offset < end) {
    // Read delta time (variable-length quantity)
    const [deltaTime, bytesRead] = readVLQ(view, offset);
    offset += bytesRead;
    tick += deltaTime;

    if (offset >= end) break;

    let statusByte = view.getUint8(offset);

    // Running status
    if (statusByte < 0x80) {
      statusByte = prevStatus;
    } else {
      offset++;
      prevStatus = statusByte;
    }

    const type = statusByte & 0xf0;
    const channel = statusByte & 0x0f;

    switch (type) {
      case 0x90: {
        // Note On
        const pitch = view.getUint8(offset++);
        const velocity = view.getUint8(offset++);

        if (velocity === 0) {
          // Note On with velocity 0 = Note Off
          finishNote(activeNotes, notes, channel, pitch, tick);
        } else {
          const key = `${channel}-${pitch}`;
          // End any existing note on same key
          finishNote(activeNotes, notes, channel, pitch, tick);
          activeNotes.set(key, { pitch, velocity, channel, startTick: tick });
          primaryChannel = channel;
        }
        break;
      }

      case 0x80: {
        // Note Off
        const pitch = view.getUint8(offset++);
        offset++; // velocity (ignored)
        finishNote(activeNotes, notes, channel, pitch, tick);
        break;
      }

      case 0xa0: // Aftertouch
      case 0xb0: // Control Change
      case 0xe0: // Pitch Bend
        offset += 2;
        break;

      case 0xc0: // Program Change
      case 0xd0: // Channel Pressure
        offset += 1;
        break;

      case 0xf0: {
        if (statusByte === 0xff) {
          // Meta event
          const metaType = view.getUint8(offset++);
          const [metaLength, metaLenBytes] = readVLQ(view, offset);
          offset += metaLenBytes;

          if (metaType === 0x03) {
            // Track Name
            name = readString(view, offset, metaLength);
          } else if (metaType === 0x51) {
            // Tempo (microseconds per quarter note)
            if (metaLength >= 3) {
              const uspqn =
                (view.getUint8(offset) << 16) |
                (view.getUint8(offset + 1) << 8) |
                view.getUint8(offset + 2);
              tempo = 60000000 / uspqn;
            }
          } else if (metaType === 0x2f) {
            // End of Track
            offset += metaLength;
            // Close any remaining active notes
            for (const [key, note] of activeNotes) {
              notes.push({
                pitch: note.pitch,
                velocity: note.velocity,
                channel: note.channel,
                startTick: note.startTick,
                durationTicks: tick - note.startTick,
                startFrame: 0,
                durationFrames: 0,
              });
            }
            activeNotes.clear();
            return { name, notes, channel: primaryChannel, tempo };
          }

          offset += metaLength;
        } else if (statusByte === 0xf0 || statusByte === 0xf7) {
          // SysEx
          const [sysexLen, sysexLenBytes] = readVLQ(view, offset);
          offset += sysexLenBytes + sysexLen;
        } else {
          // Other system messages
          break;
        }
        break;
      }

      default:
        // Unknown — skip
        break;
    }
  }

  // Close remaining notes
  for (const [key, note] of activeNotes) {
    notes.push({
      pitch: note.pitch,
      velocity: note.velocity,
      channel: note.channel,
      startTick: note.startTick,
      durationTicks: tick - note.startTick,
      startFrame: 0,
      durationFrames: 0,
    });
  }

  return { name, notes, channel: primaryChannel, tempo };
}

function finishNote(
  activeNotes: Map<
    string,
    { pitch: number; velocity: number; channel: number; startTick: number }
  >,
  notes: MidiFileNote[],
  channel: number,
  pitch: number,
  tick: number,
): void {
  const key = `${channel}-${pitch}`;
  const active = activeNotes.get(key);
  if (active) {
    notes.push({
      pitch: active.pitch,
      velocity: active.velocity,
      channel: active.channel,
      startTick: active.startTick,
      durationTicks: tick - active.startTick,
      startFrame: 0,
      durationFrames: 0,
    });
    activeNotes.delete(key);
  }
}

function readVLQ(view: DataView, offset: number): [number, number] {
  let value = 0;
  let bytesRead = 0;

  while (offset + bytesRead < view.byteLength) {
    const byte = view.getUint8(offset + bytesRead);
    value = (value << 7) | (byte & 0x7f);
    bytesRead++;

    if ((byte & 0x80) === 0) break;
    if (bytesRead > 4) break; // VLQ can't be more than 4 bytes
  }

  return [value, bytesRead];
}

function readString(view: DataView, offset: number, length: number): string {
  let str = "";
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    str += String.fromCharCode(view.getUint8(offset + i));
  }
  return str;
}
