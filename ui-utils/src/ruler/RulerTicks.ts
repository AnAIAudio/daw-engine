import type { FrameCount } from "@anaidev/daw-engine-core";
import { ClockMode, formatClock } from "@anaidev/daw-engine-core";
import type { TimelineViewport } from "../viewport/TimelineViewport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RulerTick {
  /** Pixel X position (absolute, not viewport-relative). */
  x: number;
  /** Frame position corresponding to this tick. */
  frame: FrameCount;
  /** Display label (e.g. "1:30.000", "25", "01:02:03:00"). */
  label: string;
  /** True for major ticks (e.g. minute marks, bar starts). */
  major: boolean;
}

export interface RulerTicksOptions {
  viewport: TimelineViewport;
  mode: ClockMode;
  /** BPM — required for BBT mode. */
  bpm?: number;
  /** Time signature numerator — required for BBT mode (default: 4). */
  timeSigNum?: number;
  /** Time signature denominator — required for BBT mode (default: 4). */
  timeSigDen?: number;
}

// ---------------------------------------------------------------------------
// Tick interval selection
// ---------------------------------------------------------------------------

/**
 * Choose a nice tick interval (in seconds) based on the current zoom level,
 * so ticks are never too crowded or too sparse.
 */
function chooseTimeInterval(pixelsPerSecond: number): number {
  // Target roughly 80–150 px between major ticks
  const targetPxGap = 100;
  const rawInterval = targetPxGap / pixelsPerSecond;

  // Snap to a "nice" interval
  const nice = [
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
  ];
  for (const n of nice) {
    if (n >= rawInterval) return n;
  }
  return 600;
}

// ---------------------------------------------------------------------------
// computeRulerTicks
// ---------------------------------------------------------------------------

/**
 * Compute ruler tick positions and labels for the visible viewport.
 *
 * Returns only ticks that fall within the current scroll window, so
 * the caller can render them efficiently.
 *
 * ```ts
 * const ticks = computeRulerTicks({
 *     viewport,
 *     mode: ClockMode.MINSEC,
 * });
 * for (const tick of ticks) {
 *     ctx.fillText(tick.label, tick.x - viewport.scrollX, 18);
 * }
 * ```
 */
export function computeRulerTicks(options: RulerTicksOptions): RulerTick[] {
  const { viewport, mode, bpm = 120, timeSigNum = 4, timeSigDen = 4 } = options;
  const { sampleRate, pixelsPerSecond, scrollX, viewportWidth } = viewport;

  const ticks: RulerTick[] = [];

  if (mode === ClockMode.BBT) {
    return computeBBTTicks(
      sampleRate,
      pixelsPerSecond,
      scrollX,
      viewportWidth,
      bpm,
      timeSigNum,
      timeSigDen,
    );
  }

  // Time-based modes: MINSEC, TIMECODE, SAMPLES
  const interval = chooseTimeInterval(pixelsPerSecond);
  const startSec = scrollX / pixelsPerSecond;
  const endSec = (scrollX + viewportWidth) / pixelsPerSecond;

  // Start from the first tick at or before the visible range
  const firstTick = Math.floor(startSec / interval) * interval;

  for (let sec = firstTick; sec <= endSec; sec += interval) {
    if (sec < 0) continue;
    const frame = Math.round(sec * sampleRate);
    const x = sec * pixelsPerSecond;

    // Determine if major (e.g. every minute for MINSEC, every 10s if interval < 10)
    const majorInterval =
      interval < 1 ? 1 : interval < 10 ? 10 : interval < 60 ? 60 : 600;
    const major = Math.abs(sec % majorInterval) < 0.001;

    const label = formatClock(frame, sampleRate, mode, bpm, timeSigNum);

    ticks.push({ x, frame, label, major });
  }

  return ticks;
}

// ---------------------------------------------------------------------------
// BBT ticks (bar/beat based)
// ---------------------------------------------------------------------------

function computeBBTTicks(
  sampleRate: number,
  pixelsPerSecond: number,
  scrollX: number,
  viewportWidth: number,
  bpm: number,
  timeSigNum: number,
  _timeSigDen: number,
): RulerTick[] {
  const ticks: RulerTick[] = [];

  const beatsPerSecond = bpm / 60;
  const secondsPerBeat = 1 / beatsPerSecond;
  const secondsPerBar = secondsPerBeat * timeSigNum;
  const pixelsPerBar = secondsPerBar * pixelsPerSecond;

  // If bars are too narrow, skip some
  const barSkip = pixelsPerBar < 20 ? Math.ceil(20 / pixelsPerBar) : 1;
  const showBeats = pixelsPerBar > 60;

  const startSec = scrollX / pixelsPerSecond;
  const endSec = (scrollX + viewportWidth) / pixelsPerSecond;

  const firstBar = Math.max(0, Math.floor(startSec / secondsPerBar));
  const lastBar = Math.ceil(endSec / secondsPerBar);

  for (let bar = firstBar; bar <= lastBar; bar += barSkip) {
    const barSec = bar * secondsPerBar;
    const barX = barSec * pixelsPerSecond;
    const frame = Math.round(barSec * sampleRate);

    ticks.push({
      x: barX,
      frame,
      label: `${bar + 1}`,
      major: true,
    });

    // Beat ticks within this bar
    if (showBeats && barSkip === 1) {
      for (let beat = 1; beat < timeSigNum; beat++) {
        const beatSec = barSec + beat * secondsPerBeat;
        const beatX = beatSec * pixelsPerSecond;
        const beatFrame = Math.round(beatSec * sampleRate);

        ticks.push({
          x: beatX,
          frame: beatFrame,
          label: `${bar + 1}.${beat + 1}`,
          major: false,
        });
      }
    }
  }

  return ticks;
}
