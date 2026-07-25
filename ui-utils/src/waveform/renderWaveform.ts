import type { PeakData, FrameCount } from "@daw-engine/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaveformRenderOptions {
  /** Canvas 2D rendering context to draw into. */
  ctx: CanvasRenderingContext2D;
  /** Pre-computed peak data. */
  peaks: PeakData;
  /** Pixel width of the canvas / draw area. */
  width: number;
  /** Pixel height of the canvas / draw area. */
  height: number;
  /** Fill color for the waveform (default: '#1a1a1a'). */
  color?: string;
  /** Start frame offset within the source (default: 0). */
  sourceStart?: FrameCount;
  /** Number of frames to render (default: entire peak data). */
  sourceLength?: FrameCount;
  /** Y offset for drawing (for stereo: top/bottom half). */
  yOffset?: number;
  /** Use logarithmic dB scaling (default: false). */
  logScale?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scaleAmpLog(v: number): number {
  if (v === 0) return 0;
  const sign = v < 0 ? -1 : 1;
  const db = 20 * Math.log10(Math.abs(v));
  const clamped = Math.max(-60, db);
  return sign * ((clamped + 60) / 60);
}

// ---------------------------------------------------------------------------
// renderWaveform
// ---------------------------------------------------------------------------

/**
 * Draw a waveform from pre-computed `PeakData` onto a Canvas 2D context.
 *
 * This is a pure rendering function — it doesn't fetch buffers or manage
 * state. Feed it the output of `computePeaks()` and a canvas context.
 *
 * ```ts
 * const peaks = computePeaks(audioBuffer, 512);
 * const ctx = canvas.getContext('2d')!;
 * renderWaveform({ ctx, peaks, width: 800, height: 120 });
 * ```
 */
export function renderWaveform(options: WaveformRenderOptions): void {
  const {
    ctx,
    peaks,
    width,
    height,
    color = "#1a1a1a",
    sourceStart = 0,
    sourceLength,
    yOffset = 0,
    logScale = false,
  } = options;

  const scale = logScale ? scaleAmpLog : (v: number) => v;

  // Determine the range of peak entries to render
  const peakStart = Math.floor(sourceStart / peaks.resolution);
  const totalPeakEntries =
    sourceLength != null
      ? Math.ceil(sourceLength / peaks.resolution)
      : peaks.length - peakStart;
  const peakEnd = Math.min(peakStart + totalPeakEntries, peaks.length);
  const peakCount = peakEnd - peakStart;

  if (peakCount <= 0) return;

  ctx.fillStyle = color;
  const amp = height / 2;

  // How many peak entries map to one pixel column
  const entriesPerPixel = peakCount / width;

  for (let px = 0; px < width; px++) {
    const entryStart = peakStart + Math.floor(px * entriesPerPixel);
    const entryEnd = Math.min(
      peakStart + Math.floor((px + 1) * entriesPerPixel),
      peakEnd,
    );

    let lo = Infinity;
    let hi = -Infinity;

    for (let e = entryStart; e < entryEnd; e++) {
      if (peaks.min[e] < lo) lo = peaks.min[e];
      if (peaks.max[e] > hi) hi = peaks.max[e];
    }

    // Fallback for very zoomed in (< 1 entry per pixel)
    if (lo === Infinity) {
      const idx = Math.min(entryStart, peaks.length - 1);
      lo = peaks.min[idx];
      hi = peaks.max[idx];
    }

    const sMin = scale(lo);
    const sMax = scale(hi);
    const y = yOffset + (1 - sMax) * amp;
    const h = Math.max(1, (sMax - sMin) * amp);
    ctx.fillRect(px, y, 1, h);
  }
}

/**
 * Convenience: render a stereo waveform (L top half, R bottom half).
 */
export function renderStereoWaveform(
  ctx: CanvasRenderingContext2D,
  peaksL: PeakData,
  peaksR: PeakData,
  width: number,
  height: number,
  options?: Omit<
    WaveformRenderOptions,
    "ctx" | "peaks" | "width" | "height" | "yOffset"
  >,
): void {
  const halfHeight = height / 2;

  renderWaveform({
    ctx,
    peaks: peaksL,
    width,
    height: halfHeight,
    yOffset: 0,
    ...options,
  });

  // Draw separator
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(0, halfHeight);
  ctx.lineTo(width, halfHeight);
  ctx.stroke();

  renderWaveform({
    ctx,
    peaks: peaksR,
    width,
    height: halfHeight,
    yOffset: halfHeight,
    ...options,
  });
}

/**
 * Render a waveform directly from raw samples (no pre-computed peaks).
 *
 * Convenient for small regions or one-off rendering where pre-computing
 * peaks isn't worth it. For large buffers, prefer `computePeaks()` +
 * `renderWaveform()`.
 */
export function renderWaveformFromSamples(
  ctx: CanvasRenderingContext2D,
  channelData: Float32Array,
  width: number,
  height: number,
  options?: {
    color?: string;
    sourceStart?: number;
    sourceLength?: number;
    yOffset?: number;
    logScale?: boolean;
  },
): void {
  const {
    color = "#1a1a1a",
    sourceStart = 0,
    sourceLength,
    yOffset = 0,
    logScale = false,
  } = options ?? {};

  const scale = logScale ? scaleAmpLog : (v: number) => v;
  const sampleOffset = Math.max(0, Math.floor(sourceStart));
  const sampleCount =
    sourceLength != null
      ? Math.min(Math.floor(sourceLength), channelData.length - sampleOffset)
      : channelData.length - sampleOffset;

  ctx.fillStyle = color;
  const amp = height / 2;
  const step = Math.ceil(sampleCount / width);

  for (let px = 0; px < width; px++) {
    let lo = 1.0;
    let hi = -1.0;

    for (let j = 0; j < step; j++) {
      const idx = sampleOffset + px * step + j;
      if (idx >= channelData.length) break;
      const v = channelData[idx];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }

    const sMin = scale(lo);
    const sMax = scale(hi);
    const y = yOffset + (1 - sMax) * amp;
    const h = Math.max(1, (sMax - sMin) * amp);
    ctx.fillRect(px, y, 1, h);
  }
}
