import { FrameCount, TrackId } from "../domain/types";
import { ExportConfig, ExportFormat } from "../domain/ExportConfig";
import { ExportStatus, ExportProgress } from "../domain/ExportStatus";
import { AudioBufferToWav } from "../utils/AudioBufferToWav";
import { OggEncoder } from "../utils/OggEncoder";
import { FlacEncoder } from "../utils/FlacEncoder";
import { DitherProcessor, DitherType } from "../utils/DitherProcessor";
import { normalizeLUFS } from "./LufsNormalizer";
import { applyTruePeakLimiter } from "../processing/TruePeakLimiter";
import * as lamejs from "lamejs";

import { logger } from "../utils/Logger";
/**
 * Offline Audio Exporter
 *
 * Web Audio의 OfflineAudioContext를 활용하여 실시간보다 빠르게 렌더링합니다.
 */
export class OfflineExporter {
  /**
   * Export audio using Offline Rendering
   *
   * @param config Export configuration
   * @param status Export status (for progress tracking)
   * @param getTrackAudio Callback to get track audio for a given time range
   */
  public static async export(
    config: ExportConfig,
    status: ExportStatus,
    getTrackAudio: (
      trackIds: TrackId[],
      startFrame: FrameCount,
      endFrame: FrameCount,
    ) => Promise<AudioBuffer>,
  ): Promise<void> {
    try {
      if (!config.validate()) {
        throw new Error("Invalid export configuration");
      }

      const duration = config.getDuration();
      const durationSeconds = duration / config.sampleRate;

      logger.debug(
        "OfflineExporter",
        `Starting export: ${durationSeconds}s at ${config.sampleRate}Hz`,
      );
      logger.debug(
        "OfflineExporter",
        `Export config trackIds:`,
        config.trackIds,
        `exportMasterOnly:`,
        config.exportMasterOnly,
      );

      // Initialize status
      status.init(duration, config.getFullPath());

      // Render Phase
      status.setProgress(ExportProgress.RENDERING);

      // Get trackIds to pass to getTrackAudio
      const trackIdsToExport =
        config.trackIds && config.trackIds.length > 0
          ? config.trackIds
          : undefined; // undefined means "all tracks"

      logger.debug(
        "OfflineExporter",
        `Calling getTrackAudio with trackIds:`,
        trackIdsToExport,
      );

      const renderedBuffer = await getTrackAudio(
        trackIdsToExport as TrackId[],
        config.startFrame,
        config.endFrame,
      );

      // Update progress
      status.updateProcessedFrames(duration);

      // Normalize Phase (if enabled)
      if (config.normalize) {
        status.setProgress(ExportProgress.NORMALIZING);

        if (config.normalizeMode === "lufs") {
          // LUFS normalization (ITU-R BS.1770-4)
          const gainDb = normalizeLUFS(renderedBuffer, config.targetLufs);
          logger.debug(
            "OfflineExporter",
            `LUFS normalization applied: ${gainDb.toFixed(2)} dB gain`,
          );
        } else {
          // Peak normalization (legacy)
          await this.normalizeBuffer(renderedBuffer, config.targetPeakDb);
        }
      }

      // True Peak Limiter (after normalization, before encoding)
      if (config.truePeakLimit) {
        const limited = applyTruePeakLimiter(
          renderedBuffer,
          config.truePeakCeiling,
        );
        if (limited) {
          logger.debug(
            "OfflineExporter",
            `True peak limiter applied (ceiling: ${config.truePeakCeiling} dBTP)`,
          );
        }
      }

      // Dithering Phase (before encoding, when reducing bit depth)
      if (config.ditherType !== DitherType.NONE) {
        const targetBits =
          config.sampleFormat === "int16"
            ? 16
            : config.sampleFormat === "int24"
              ? 24
              : 32;
        if (targetBits < 32) {
          for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
            DitherProcessor.apply(
              renderedBuffer.getChannelData(ch),
              targetBits,
              config.ditherType,
            );
          }
        }
      }

      // Encoding Phase
      status.setProgress(ExportProgress.ENCODING);
      const blob = await this.encodeToBlob(renderedBuffer, config);

      // Create object URL
      const url = URL.createObjectURL(blob);

      // Complete
      status.complete(blob, url);

      logger.debug("OfflineExporter", `Export completed: ${blob.size} bytes`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("OfflineExporter", `Export failed:`, error);
      status.setError(message);
    }
  }

  /**
   * Normalize audio buffer using peak normalization.
   *
   * @param buffer Audio data (modified in-place)
   * @param targetPeakDb Target peak level in dBFS (default: -1 dBFS)
   */
  private static async normalizeBuffer(
    buffer: AudioBuffer,
    targetPeakDb?: number,
  ): Promise<void> {
    const target = targetPeakDb ?? -1;

    let maxPeak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        maxPeak = Math.max(maxPeak, Math.abs(data[i]));
      }
    }

    if (maxPeak === 0) return;

    // Convert dBFS target to linear gain and scale so the peak hits that level
    const targetLinear = Math.pow(10, target / 20);
    const gain = targetLinear / maxPeak;

    // Apply gain
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] *= gain;
      }
    }
  }

  /**
   * Encode AudioBuffer to Blob
   */
  private static async encodeToBlob(
    buffer: AudioBuffer,
    config: ExportConfig,
  ): Promise<Blob> {
    switch (config.format) {
      case "wav":
        return AudioBufferToWav.encode(buffer, config.sampleFormat);
      case "mp3":
        return this.encodeMP3(buffer, config);
      case "ogg":
        return await OggEncoder.encode(buffer, config.quality ?? 0.5);
      case "flac":
        return FlacEncoder.encode(
          buffer,
          config.sampleFormat === "int24" ? 24 : 16,
        );
      default:
        throw new Error(`Unknown format: ${config.format}`);
    }
  }

  /**
   * Encode to MP3 format using lamejs
   */
  private static encodeMP3(buffer: AudioBuffer, config: ExportConfig): Blob {
    const channels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const kbps = config.bitrate || 128; // Default 128kbps

    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const mp3Data: Int8Array[] = [];

    // Convert Float32 to Int16
    // Lamejs expects Int16 PCM data
    const left = buffer.getChannelData(0);
    const right = channels > 1 ? buffer.getChannelData(1) : undefined;

    const leftInt16 = new Int16Array(left.length);
    const rightInt16 = right ? new Int16Array(right.length) : undefined;

    for (let i = 0; i < left.length; i++) {
      // Clamp and convert
      const s = Math.max(-1, Math.min(1, left[i]));
      leftInt16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (right && rightInt16) {
        const sR = Math.max(-1, Math.min(1, right[i]));
        rightInt16[i] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
      }
    }

    // Encode blocks
    const mp3buf = mp3encoder.encodeBuffer(leftInt16, rightInt16);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    // Flush
    const mp3bufFlush = mp3encoder.flush();
    if (mp3bufFlush.length > 0) {
      mp3Data.push(mp3bufFlush);
    }

    return new Blob(mp3Data as unknown as BlobPart[], { type: "audio/mp3" });
  }

  /**
   * Stem Export: export each track individually as separate files.
   * Returns a map of trackId -> { blob, filename }.
   */
  public static async exportStems(
    config: ExportConfig,
    status: ExportStatus,
    trackIds: TrackId[],
    trackNames: Map<TrackId, string>,
    getTrackAudio: (
      ids: TrackId[],
      startFrame: FrameCount,
      endFrame: FrameCount,
    ) => Promise<AudioBuffer>,
  ): Promise<Map<TrackId, { blob: Blob; filename: string }>> {
    const results = new Map<TrackId, { blob: Blob; filename: string }>();

    if (!config.validate()) {
      throw new Error("Invalid export configuration");
    }

    const totalTracks = trackIds.length;
    const duration = config.getDuration();
    status.init(duration * totalTracks, config.getFullPath());
    status.setProgress(ExportProgress.RENDERING);

    for (let i = 0; i < trackIds.length; i++) {
      if (status.aborted) break;

      const trackId = trackIds[i];
      const trackName = trackNames.get(trackId) || `Track_${i + 1}`;
      const safeTrackName = trackName.replace(/[^a-zA-Z0-9_-]/g, "_");

      logger.debug(
        "OfflineExporter",
        `Stem ${i + 1}/${totalTracks}: ${trackName}`,
      );

      // Render single track
      const renderedBuffer = await getTrackAudio(
        [trackId],
        config.startFrame,
        config.endFrame,
      );

      // Normalize if enabled
      if (config.normalize) {
        if (config.normalizeMode === "lufs") {
          normalizeLUFS(renderedBuffer, config.targetLufs);
        } else {
          await this.normalizeBuffer(renderedBuffer, config.targetPeakDb);
        }
      }

      // True Peak Limiter
      if (config.truePeakLimit) {
        applyTruePeakLimiter(renderedBuffer, config.truePeakCeiling);
      }

      // Encode
      const blob = await this.encodeToBlob(renderedBuffer, config);
      const filename = `${config.filename}_${safeTrackName}.${config.format}`;

      results.set(trackId, { blob, filename });

      status.updateProcessedFrames(duration * (i + 1));
    }

    if (!status.aborted) {
      // Create a combined blob (or return individual stems)
      const firstResult = results.values().next().value;
      if (firstResult) {
        const url = URL.createObjectURL(firstResult.blob);
        status.complete(firstResult.blob, url);
      }
    }

    return results;
  }
}
