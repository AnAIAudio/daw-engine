/**
 * Clock Display Mode
 */
export enum ClockMode {
  /** HH:MM:SS.mmm */
  MINSEC = "minsec",
  /** BBB|BB|TTTT (Bars|Beats|Ticks) */
  BBT = "bbt",
  /** HH:MM:SS:FF (Timecode frames) */
  TIMECODE = "timecode",
  /** Raw sample count */
  SAMPLES = "samples",
}

/**
 * Format frame count based on clock mode
 */
export function formatClock(
  frame: number,
  sampleRate: number,
  mode: ClockMode,
  bpm: number = 120,
  timeSigNum: number = 4,
): string {
  if (sampleRate <= 0) return "---";

  switch (mode) {
    case ClockMode.MINSEC: {
      const totalSeconds = frame / sampleRate;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const millis = Math.floor((totalSeconds % 1) * 1000);
      return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0") +
        "." +
        String(millis).padStart(3, "0")
      );
    }

    case ClockMode.BBT: {
      const secondsPerBeat = 60 / bpm;
      const framesPerBeat = secondsPerBeat * sampleRate;
      const totalBeats = frame / framesPerBeat;
      const bar = Math.floor(totalBeats / timeSigNum) + 1;
      const beat = Math.floor(totalBeats % timeSigNum) + 1;
      const ticksPerBeat = 1920; // Standard MIDI resolution
      const tick = Math.floor((totalBeats % 1) * ticksPerBeat);
      return (
        String(bar).padStart(3, "0") +
        "|" +
        String(beat).padStart(2, "0") +
        "|" +
        String(tick).padStart(4, "0")
      );
    }

    case ClockMode.TIMECODE: {
      const fps = 30; // Standard NTSC
      const totalSeconds = frame / sampleRate;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const frames = Math.floor((totalSeconds % 1) * fps);
      return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0") +
        ":" +
        String(frames).padStart(2, "0")
      );
    }

    case ClockMode.SAMPLES: {
      return String(Math.floor(frame)).padStart(10, "0");
    }

    default:
      return "---";
  }
}
