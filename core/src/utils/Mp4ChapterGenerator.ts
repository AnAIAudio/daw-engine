/**
 * MP4 Chapter Generator
 *
 * Generates Nero-style MP4 chapter metadata (used by ffmpeg -i chapters.txt).
 * Format: CHAPTER01=HH:MM:SS.mmm / CHAPTER01NAME=Title
 */

import { CDMarker } from "../domain/CDMarker";

/**
 * Generate MP4 chapter markers in Nero chapter format.
 *
 * @param markers CD markers
 * @param sampleRate Audio sample rate
 * @returns Chapter metadata string
 */
export function generateMp4Chapters(
  markers: CDMarker[],
  sampleRate: number,
): string {
  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const lines: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const marker = sorted[i];
    const chNum = String(i + 1).padStart(2, "0");

    // Convert position to HH:MM:SS.mmm
    const totalSeconds = marker.position / sampleRate;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const millis = Math.floor((totalSeconds % 1) * 1000);

    const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;

    lines.push(`CHAPTER${chNum}=${timeStr}`);
    lines.push(`CHAPTER${chNum}NAME=${marker.title || `Chapter ${i + 1}`}`);
  }

  return lines.join("\n");
}
