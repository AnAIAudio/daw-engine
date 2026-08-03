/**
 * BWF (Broadcast WAV) Metadata Writer
 *
 * Adds a 'bext' chunk to a WAV file for broadcast metadata (EBU Tech 3285).
 *
 * BWF extends WAV by adding a 'bext' chunk with:
 *   - Description (256 chars)
 *   - Originator (32 chars)
 *   - OriginatorReference (32 chars)
 *   - OriginationDate (10 chars: YYYY-MM-DD)
 *   - OriginationTime (8 chars: HH:MM:SS)
 *   - TimeReference (64-bit sample count since midnight)
 *   - Version (2 bytes)
 *   - UMID (64 bytes)
 *   - LoudnessValue (2 bytes)
 *   - LoudnessRange (2 bytes)
 *   - MaxTruePeakLevel (2 bytes)
 *   - MaxMomentaryLoudness (2 bytes)
 *   - MaxShortTermLoudness (2 bytes)
 */

export interface BwfChunkData {
  description?: string; // max 256 chars
  originator?: string; // max 32 chars
  originatorReference?: string; // max 32 chars
  originationDate?: string; // YYYY-MM-DD (10 chars)
  originationTime?: string; // HH:MM:SS (8 chars)
  timeReference?: number; // sample count since midnight
  loudnessValue?: number; // LUFS * 100 (e.g., -14.0 = -1400)
  loudnessRange?: number; // LU * 100
  maxTruePeakLevel?: number; // dBTP * 100
}

/**
 * Build a BWF 'bext' chunk as a Uint8Array.
 */
export function buildBextChunk(data: BwfChunkData): Uint8Array {
  // Fixed-size bext chunk (version 2): 602 bytes minimum
  const BEXT_SIZE = 602;
  const chunk = new Uint8Array(8 + BEXT_SIZE); // 8 for chunk ID + size
  const view = new DataView(chunk.buffer);

  // Chunk ID: "bext"
  chunk[0] = 0x62; // b
  chunk[1] = 0x65; // e
  chunk[2] = 0x78; // x
  chunk[3] = 0x74; // t

  // Chunk size
  view.setUint32(4, BEXT_SIZE, true);

  const encoder = new TextEncoder();

  // All data offsets below are relative to chunk start (includes 8-byte header)
  const H = 8; // chunk header size (ID + size)

  // Description (256 bytes, data offset 0)
  writeFixedString(chunk, H + 0, data.description || "", 256);

  // Originator (32 bytes, data offset 256)
  writeFixedString(chunk, H + 256, data.originator || "daw-engine Web DAW", 32);

  // OriginatorReference (32 bytes, data offset 288)
  writeFixedString(chunk, H + 288, data.originatorReference || "", 32);

  // OriginationDate (10 bytes, data offset 320)
  const now = new Date();
  const dateStr =
    data.originationDate ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  writeFixedString(chunk, H + 320, dateStr, 10);

  // OriginationTime (8 bytes, data offset 330)
  const timeStr =
    data.originationTime ||
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  writeFixedString(chunk, H + 330, timeStr, 8);

  // TimeReference (64-bit, data offset 338)
  const timeRef = data.timeReference ?? 0;
  view.setUint32(H + 338, timeRef & 0xffffffff, true);
  view.setUint32(H + 342, Math.floor(timeRef / 0x100000000) & 0xffffffff, true);

  // Version (2 bytes, data offset 346) — BWF version 2
  view.setUint16(H + 346, 2, true);

  // UMID (64 bytes, data offset 348) — zeros (no UMID)
  // Already zeros

  // LoudnessValue (2 bytes, data offset 412)
  if (data.loudnessValue !== undefined) {
    view.setInt16(H + 412, Math.round(data.loudnessValue * 100), true);
  }

  // LoudnessRange (2 bytes, data offset 414)
  if (data.loudnessRange !== undefined) {
    view.setInt16(H + 414, Math.round(data.loudnessRange * 100), true);
  }

  // MaxTruePeakLevel (2 bytes, data offset 416)
  if (data.maxTruePeakLevel !== undefined) {
    view.setInt16(H + 416, Math.round(data.maxTruePeakLevel * 100), true);
  }

  // MaxMomentaryLoudness (2 bytes, data offset 418) — skip
  // MaxShortTermLoudness (2 bytes, data offset 420) — skip

  // Reserved (180 bytes, data offset 422) — already zeros

  return chunk;
}

function writeFixedString(
  target: Uint8Array,
  offset: number,
  str: string,
  maxLen: number,
) {
  for (let i = 0; i < maxLen; i++) {
    target[offset + i] = i < str.length ? str.charCodeAt(i) & 0xff : 0;
  }
}

/**
 * Insert a bext chunk into a WAV blob, creating a BWF file.
 * Inserts after the 'fmt ' chunk and before the 'data' chunk.
 */
export function insertBextIntoWav(
  wavBlob: Blob,
  bextData: BwfChunkData,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wavBuffer = reader.result as ArrayBuffer;
        const wavBytes = new Uint8Array(wavBuffer);
        const bextChunk = buildBextChunk(bextData);

        // Find 'data' chunk position
        let dataOffset = 12; // skip RIFF header
        while (dataOffset < wavBytes.length - 8) {
          const chunkId = String.fromCharCode(
            wavBytes[dataOffset],
            wavBytes[dataOffset + 1],
            wavBytes[dataOffset + 2],
            wavBytes[dataOffset + 3],
          );
          const chunkSize = new DataView(wavBuffer).getUint32(
            dataOffset + 4,
            true,
          );

          if (chunkId === "data") {
            break;
          }

          dataOffset += 8 + chunkSize;
          // Align to even boundary
          if (dataOffset % 2 !== 0) dataOffset++;
        }

        // Insert bext chunk before 'data'
        const before = wavBytes.slice(0, dataOffset);
        const after = wavBytes.slice(dataOffset);

        // Update RIFF size
        const newSize = wavBytes.length + bextChunk.length;
        const result = new Uint8Array(newSize);
        result.set(before, 0);
        result.set(bextChunk, dataOffset);
        result.set(after, dataOffset + bextChunk.length);

        // Update RIFF chunk size (offset 4)
        const resultView = new DataView(result.buffer);
        resultView.setUint32(4, newSize - 8, true);

        resolve(new Blob([result], { type: "audio/wav" }));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(wavBlob);
  });
}
