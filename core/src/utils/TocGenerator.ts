/**
 * TOC (Table of Contents) Generator for CD burning
 *
 * Generates cdrdao-compatible TOC files from CD markers.
 */

import { CDMarker } from "../domain/CDMarker";

/**
 * Generate a cdrdao-compatible TOC file from CD markers.
 *
 * @param markers Sorted CD markers
 * @param sampleRate Audio sample rate
 * @param filename Audio filename
 * @returns TOC file content string
 */
export function generateTocSheet(
  markers: CDMarker[],
  sampleRate: number,
  filename: string = "audio.wav",
): string {
  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const lines: string[] = [];

  lines.push("CD_DA");
  lines.push("");

  for (const marker of sorted) {
    lines.push("// Track " + marker.index);
    lines.push("TRACK AUDIO");

    if (marker.title) {
      lines.push(`CD_TEXT {`);
      lines.push(`  LANGUAGE 0 {`);
      lines.push(`    TITLE "${marker.title}"`);
      if (marker.performer) {
        lines.push(`    PERFORMER "${marker.performer}"`);
      }
      lines.push(`  }`);
      lines.push(`}`);
    }

    if (marker.isrc) {
      lines.push(`ISRC "${marker.isrc}"`);
    }

    // Convert frame position to MM:SS:FF (75 frames/sec for CD)
    const totalSeconds = marker.position / sampleRate;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const cdFrames = Math.floor((totalSeconds % 1) * 75);

    const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(cdFrames).padStart(2, "0")}`;

    lines.push(`FILE "${filename}" ${timeStr}`);
    lines.push("");
  }

  return lines.join("\n");
}
