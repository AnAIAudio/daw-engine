import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { RangeId } from "../../domain/types";
import { ExportCommand } from "../impl/ExportCommand";
import { ExportFormat, ExportSampleFormat } from "../../domain/ExportConfig";
import { OfflineExporter } from "../../audio/OfflineExporter";
import { TrackId } from "../../domain/types";
import { SetGridCommand } from "../impl/SetGridCommand";
import { GridType, SnapMode } from "../../domain/GridSettings";
import { Source } from "../../domain/Source";
import { RegionDTO } from "../../audio/dto";

/**
 * Export & Grid Command Handler
 *
 * Export, Grid 설정 등 처리
 */
export class ExportHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.EXPORT,
    CommandType.EXPORT_STEMS,
    CommandType.SET_GRID,
    CommandType.GET_GRID,
    CommandType.OPEN_EXPORT_DIALOG,
    CommandType.DEBUG_SESSION,
  ]);

  canHandle(commandType: string): boolean {
    return this.supportedCommands.has(commandType);
  }

  async execute(
    commandType: string,
    payload: CommandHandlerPayload | undefined,
    audioEngine: AudioEngine,
    _history: CommandHistory,
  ): Promise<CommandResult> {
    switch (commandType) {
      case CommandType.EXPORT: {
        const config = audioEngine.getExportConfig();
        const status = audioEngine.getExportStatus();

        // Configure export
        if (payload?.filename) config.setFilename(payload.filename as string);
        if (payload?.format) config.setFormat(payload.format as ExportFormat);
        if (payload?.sampleFormat)
          config.setSampleFormat(payload.sampleFormat as ExportSampleFormat);
        if (payload?.normalize !== undefined)
          config.setNormalize(payload.normalize as boolean);

        // Set range
        if (payload?.rangeId) {
          config.setRangeById(payload.rangeId as RangeId);
        } else {
          const startFrame = (payload?.startFrame as number) ?? 0;
          const endFrame =
            (payload?.endFrame as number) ??
            audioEngine.session.getSessionDuration();
          config.setRange(startFrame, endFrame);
        }

        // Execute export
        const exportCmd = new ExportCommand(config, status);
        await exportCmd.execute();

        // Trigger download if successful
        if (status.resultUrl) {
          if (typeof document !== "undefined") {
            const a = document.createElement("a");
            a.href = status.resultUrl;
            a.download = config.getFullPath();
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }

          return {
            success: true,
            message: `Export completed: ${config.getFullPath()}`,
            data: {
              filename: config.getFullPath(),
              size: status.resultBlob?.size,
              duration: config.getDuration() / config.sampleRate,
            },
          };
        }

        return { success: false, message: "Export failed" };
      }

      case CommandType.EXPORT_STEMS: {
        const stemConfig = audioEngine.getExportConfig();
        const stemStatus = audioEngine.getExportStatus();

        if (payload?.filename)
          stemConfig.setFilename(payload.filename as string);
        if (payload?.format)
          stemConfig.setFormat(payload.format as ExportFormat);
        if (payload?.normalize !== undefined)
          stemConfig.setNormalize(payload.normalize as boolean);

        const sessionStartFrame = 0;
        const sessionEndFrame = audioEngine.session.getSessionDuration();
        stemConfig.setRange(sessionStartFrame, sessionEndFrame);

        const allTrackIds = audioEngine.session.tracks.map((t) => t.id);
        const trackNameMap = new Map<TrackId, string>();
        audioEngine.session.tracks.forEach((t) =>
          trackNameMap.set(t.id, t.name),
        );

        const stemBackend = (
          audioEngine as unknown as {
            backend: import("../../audio/AudioProvider").AudioProvider;
          }
        ).backend;
        const stemResults = await OfflineExporter.exportStems(
          stemConfig,
          stemStatus,
          allTrackIds,
          trackNameMap,
          async (tids, start, end) =>
            stemBackend.exportAudio(start, end, stemConfig.sampleRate, tids),
        );

        return {
          success: true,
          message: `Exported ${stemResults.size} stems`,
          data: { stemCount: stemResults.size },
        };
      }

      case CommandType.SET_GRID: {
        const cmd = new SetGridCommand({
          gridType: payload?.gridType as GridType | undefined,
          snapMode: payload?.snapMode as SnapMode | undefined,
          snapToGrid: payload?.snapToGrid as boolean | undefined,
          bpm: payload?.bpm as number | undefined,
        });
        await cmd.execute();

        return {
          success: true,
          message: "Grid settings updated",
          data: audioEngine.session.gridSettings.toDTO(),
        };
      }

      case CommandType.GET_GRID: {
        return {
          success: true,
          message: "Grid settings",
          data: audioEngine.session.gridSettings.toDTO(),
        };
      }

      case CommandType.DEBUG_SESSION: {
        const session = audioEngine.session;

        interface DebugTrackContext {
          regions: RegionDTO[];
        }
        interface DebugBackend {
          tracks?: Map<string, DebugTrackContext>;
          bufferCache?: Map<string, unknown>;
        }
        const backend = (audioEngine as unknown as { backend: DebugBackend })
          .backend;

        const backendEntries: [string, DebugTrackContext][] = backend.tracks
          ? Array.from(backend.tracks.entries())
          : [];

        const debugInfo = {
          tracks: session.tracks.map((t) => ({
            id: t.id,
            name: t.name,
            regions: t.playlist.getRegions().map((r) => ({
              id: r.id,
              sourceId: r.sourceId,
              start: r.start,
              length: r.length,
              end: r.end,
            })),
          })),
          sources: Array.from(session.sources.values()).map((s: Source) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            duration: s.duration,
          })),
          bufferCache: backend.bufferCache
            ? Array.from(backend.bufferCache.keys())
            : [],
          backendRegions: backendEntries.map(([trackId, ctx]) => ({
            trackId,
            regions: ctx.regions.map((r: RegionDTO) => ({
              sourceId: r.sourceId,
              start: r.start,
              length: r.length,
            })),
          })),
          sessionDuration: session.getSessionDuration(),
        };

        return {
          success: true,
          message: "Session debug info",
          data: debugInfo,
        };
      }

      case CommandType.OPEN_EXPORT_DIALOG: {
        return { success: true, message: "Open export dialog" };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
