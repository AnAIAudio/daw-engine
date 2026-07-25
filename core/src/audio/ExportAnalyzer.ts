/**
 * Export Analyzer — post-export analysis report.
 *
 * Computes: Peak, RMS, LUFS, True Peak, Dynamic Range, DC offset.
 */

import { measureLUFS, LufsResult } from "./LufsNormalizer";
import { measureTruePeakDbTP } from "../processing/TruePeakLimiter";

export interface ExportAnalysisReport {
  /** Duration in seconds */
  duration: number;
  /** Sample rate */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Peak level per channel in dBFS */
  peakLevels: number[];
  /** RMS level per channel in dBFS */
  rmsLevels: number[];
  /** True peak per channel in dBTP */
  truePeakLevels: number[];
  /** Integrated LUFS */
  integratedLufs: number;
  /** Short-term LUFS max */
  shortTermMax: number;
  /** Loudness Range (LRA) in LU */
  loudnessRange: number;
  /** Dynamic range (peak - RMS) in dB */
  dynamicRange: number;
  /** DC offset per channel */
  dcOffset: number[];
  /** Whether clipping was detected */
  clipping: boolean;
  /** Number of clipped samples */
  clippedSamples: number;
}

/**
 * Analyze an AudioBuffer and produce a comprehensive report.
 */
export function analyzeExport(buffer: AudioBuffer): ExportAnalysisReport {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  const peakLevels: number[] = [];
  const rmsLevels: number[] = [];
  const truePeakLevels: number[] = [];
  const dcOffset: number[] = [];

  let totalClipped = 0;
  let hasClipping = false;

  for (let ch = 0; ch < numChannels; ch++) {
    const data = buffer.getChannelData(ch);

    let peak = 0;
    let sumSq = 0;
    let sum = 0;
    let clipped = 0;

    for (let i = 0; i < length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
      sumSq += data[i] * data[i];
      sum += data[i];

      if (abs >= 1.0) {
        clipped++;
      }
    }

    const rms = Math.sqrt(sumSq / length);
    const dc = sum / length;

    peakLevels.push(peak > 0 ? 20 * Math.log10(peak) : -Infinity);
    rmsLevels.push(rms > 0 ? 20 * Math.log10(rms) : -Infinity);
    truePeakLevels.push(measureTruePeakDbTP(data));
    dcOffset.push(dc);

    totalClipped += clipped;
    if (clipped > 0) hasClipping = true;
  }

  // LUFS measurement
  const lufsResult = measureLUFS(buffer);

  // Short-term max
  const shortTermMax =
    lufsResult.shortTerm.length > 0
      ? Math.max(...lufsResult.shortTerm.filter((l) => isFinite(l)))
      : -Infinity;

  // Dynamic range (overall peak - overall RMS)
  const overallPeak = Math.max(...peakLevels);
  const overallRms = Math.max(...rmsLevels);
  const dynamicRange =
    isFinite(overallPeak) && isFinite(overallRms)
      ? overallPeak - overallRms
      : 0;

  return {
    duration: length / sampleRate,
    sampleRate,
    channels: numChannels,
    peakLevels,
    rmsLevels,
    truePeakLevels,
    integratedLufs: lufsResult.integrated,
    shortTermMax,
    loudnessRange: lufsResult.range,
    dynamicRange,
    dcOffset,
    clipping: hasClipping,
    clippedSamples: totalClipped,
  };
}
