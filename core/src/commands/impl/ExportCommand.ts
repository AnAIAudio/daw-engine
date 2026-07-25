import { Command } from "../Command";
import { AudioEngine } from "../../audio/AudioEngine";
import { ExportConfig } from "../../domain/ExportConfig";
import { ExportStatus } from "../../domain/ExportStatus";
import { OfflineExporter } from "../../audio/OfflineExporter";
import { AudioProvider } from "../../audio/AudioProvider";

import { logger } from "../../utils/Logger";
/**
 * Export Command
 *
 * Export 기능을 실행하는 Command입니다.
 * Undo는 지원하지 않습니다 (export는 되돌릴 수 없는 작업).
 */
export class ExportCommand implements Command {
  private config: ExportConfig;
  private status: ExportStatus;

  constructor(config: ExportConfig, status: ExportStatus) {
    this.config = config;
    this.status = status;
  }

  public async execute(): Promise<void> {
    const engine = AudioEngine.getInstance();
    const session = engine.session;

    // If rangeId is set, use that range (BEFORE validation)
    if (this.config.rangeId) {
      const range = session.getRange(this.config.rangeId);
      if (!range) {
        throw new Error(`Export range not found: ${this.config.rangeId}`);
      }
      this.config.setRange(range.start, range.end);
      logger.debug(
        "ExportCommand",
        `Using named range: ${range.name} (${range.start} - ${range.end})`,
      );
    }

    // If no range set, use session range (0 to max region end)
    if (this.config.endFrame === 0) {
      let maxEnd = 0;
      let regionCount = 0;
      session.tracks.forEach((track) => {
        const regions = track.playlist.getRegions();
        regionCount += regions.length;
        regions.forEach((region) => {
          maxEnd = Math.max(maxEnd, region.end);
          logger.debug(
            "ExportCommand",
            `Found region: ${region.name}, start=${region.start}, end=${region.end}`,
          );
        });
      });

      logger.debug(
        "ExportCommand",
        `Total regions found: ${regionCount}, maxEnd: ${maxEnd}`,
      );

      if (maxEnd === 0) {
        throw new Error(
          "No audio content found to export. Please add regions to tracks first.",
        );
      }

      this.config.setRange(0, maxEnd);
    }

    // Validate configuration (AFTER setting range)
    if (!this.config.validate()) {
      throw new Error(
        "Invalid export configuration: endFrame must be greater than startFrame",
      );
    }

    logger.debug(
      "ExportCommand",
      `Export range: ${this.config.startFrame} to ${this.config.endFrame} (${(this.config.endFrame - this.config.startFrame) / this.config.sampleRate}s)`,
    );

    // Pause transport if playing
    const wasPlaying = session.isPlaying;
    if (wasPlaying) {
      engine.pause();
    }

    try {
      // Get track IDs to export
      const trackIdsToExport = this.config.exportMasterOnly
        ? session.tracks.map((t) => t.id) // Export all tracks (will be mixed)
        : this.config.trackIds;

      logger.debug(
        "ExportCommand",
        `Session tracks: ${session.tracks.length}, IDs:`,
        trackIdsToExport,
      );

      // Verify tracks exist in backend
      const backend = (
        engine as unknown as {
          backend: AudioProvider & { tracks?: Map<string, unknown> };
        }
      ).backend;
      const availableTracks = backend.tracks
        ? Array.from(backend.tracks.keys())
        : [];
      logger.debug("ExportCommand", `Backend tracks:`, availableTracks);

      if (trackIdsToExport.length === 0) {
        throw new Error("No tracks found in session");
      }

      // ✅ FIX: Store trackIds in config so OfflineExporter can access them
      this.config.trackIds = trackIdsToExport;

      // Export using OfflineExporter
      await OfflineExporter.export(
        this.config,
        this.status,
        async (callbackTrackIds, startFrame, endFrame) => {
          // This callback uses the AudioProvider to render audio
          const audioProvider = (
            engine as unknown as { backend: AudioProvider }
          ).backend; // Access private backend
          // Use the trackIds passed from OfflineExporter (which got them from config)
          return await audioProvider.exportAudio(
            startFrame,
            endFrame,
            this.config.sampleRate,
            callbackTrackIds || trackIdsToExport, // Fallback to our calculated trackIds
          );
        },
      );

      logger.debug("ExportCommand", `Export completed successfully`);
    } catch (error) {
      logger.error("ExportCommand", `Export failed:`, error);
      throw error;
    } finally {
      // Resume transport if it was playing
      if (wasPlaying) {
        await engine.start();
      }
    }
  }
}
