import { Signal } from "../lib/Signal";
import { FrameCount } from "./types";

/**
 * CD Marker for Red Book-compliant CD mastering
 */
export class CDMarker {
  public readonly id: string;
  public index: number;
  public title: string;
  public performer: string;
  public isrc: string; // International Standard Recording Code
  public position: FrameCount;

  public readonly changed = new Signal<CDMarker>();
  public readonly removed = new Signal<void>();

  constructor(
    id: string,
    index: number,
    title: string,
    position: FrameCount,
    performer: string = "",
    isrc: string = "",
  ) {
    this.id = id;
    this.index = index;
    this.title = title;
    this.position = position;
    this.performer = performer;
    this.isrc = isrc;
  }

  public setTitle(title: string): void {
    if (this.title !== title) {
      this.title = title;
      this.changed.emit(this);
    }
  }

  public setPosition(position: FrameCount): void {
    if (this.position !== position) {
      this.position = Math.max(0, position);
      this.changed.emit(this);
    }
  }

  public setPerformer(performer: string): void {
    this.performer = performer;
    this.changed.emit(this);
  }

  public setISRC(isrc: string): void {
    this.isrc = isrc;
    this.changed.emit(this);
  }

  public toJSON(): CDMarkerSnapshot {
    return {
      id: this.id,
      index: this.index,
      title: this.title,
      performer: this.performer,
      isrc: this.isrc,
      position: this.position,
    };
  }

  public static fromJSON(data: CDMarkerSnapshot): CDMarker {
    return new CDMarker(
      data.id,
      data.index,
      data.title,
      data.position,
      data.performer,
      data.isrc,
    );
  }
}

export interface CDMarkerSnapshot {
  id: string;
  index: number;
  title: string;
  performer: string;
  isrc: string;
  position: number;
}

/**
 * Generate a CUE sheet from CD markers.
 */
export function generateCueSheet(
  markers: CDMarker[],
  sampleRate: number,
  albumTitle: string = "Untitled",
  albumPerformer: string = "",
  filename: string = "audio.wav",
): string {
  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const lines: string[] = [];

  if (albumPerformer) lines.push(`PERFORMER "${albumPerformer}"`);
  lines.push(`TITLE "${albumTitle}"`);
  lines.push(`FILE "${filename}" WAVE`);

  for (const marker of sorted) {
    lines.push(`  TRACK ${String(marker.index).padStart(2, "0")} AUDIO`);
    if (marker.title) lines.push(`    TITLE "${marker.title}"`);
    if (marker.performer) lines.push(`    PERFORMER "${marker.performer}"`);
    if (marker.isrc) lines.push(`    ISRC ${marker.isrc}`);

    // Convert frames to MM:SS:FF (where FF = frames at 75 fps for CD)
    const totalSeconds = marker.position / sampleRate;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const cdFrames = Math.floor((totalSeconds % 1) * 75);

    lines.push(
      `    INDEX 01 ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(cdFrames).padStart(2, "0")}`,
    );
  }

  return lines.join("\n") + "\n";
}
