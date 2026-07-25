import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { TrackId } from "../../domain/types";

/**
 * Track Group, VCA, CD Marker, Sidechain Command Handler
 *
 * Handles: CREATE_TRACK_GROUP, DELETE_TRACK_GROUP, ADD_TO_TRACK_GROUP,
 * REMOVE_FROM_TRACK_GROUP, SET_TRACK_PARENT, ADD_VCA_TRACK,
 * REMOVE_VCA_TRACK, SET_VCA_GAIN, ASSIGN_TO_VCA,
 * ADD_CD_MARKER, REMOVE_CD_MARKER, GENERATE_CUE_SHEET,
 * SET_SIDECHAIN_SOURCE
 */
export class TrackGroupHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.CREATE_TRACK_GROUP,
    CommandType.DELETE_TRACK_GROUP,
    CommandType.ADD_TO_TRACK_GROUP,
    CommandType.REMOVE_FROM_TRACK_GROUP,
    CommandType.SET_TRACK_PARENT,
    CommandType.ADD_VCA_TRACK,
    CommandType.REMOVE_VCA_TRACK,
    CommandType.SET_VCA_GAIN,
    CommandType.ASSIGN_TO_VCA,
    CommandType.ADD_CD_MARKER,
    CommandType.REMOVE_CD_MARKER,
    CommandType.GENERATE_CUE_SHEET,
    CommandType.SET_SIDECHAIN_SOURCE,
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
    const session = audioEngine.session;

    switch (commandType) {
      // ─── Track Groups ────────────────────────────────────────────
      case CommandType.CREATE_TRACK_GROUP: {
        if (!payload)
          return {
            success: false,
            message: "CREATE_TRACK_GROUP requires a payload",
          };
        const group = session.addTrackGroup(payload.name as string);
        const trackIds = payload.trackIds as string[] | undefined;
        if (trackIds) {
          for (const trackId of trackIds) {
            group.addMember(trackId as TrackId);
            const track = session.getTrack(trackId as TrackId);
            if (track) track.groupId = group.id;
          }
        }
        return {
          success: true,
          message: `Track group "${payload.name}" created`,
          data: { groupId: group.id },
        };
      }

      case CommandType.DELETE_TRACK_GROUP: {
        if (!payload)
          return {
            success: false,
            message: "DELETE_TRACK_GROUP requires a payload",
          };
        const group = session.getTrackGroup(payload.groupId as string);
        if (!group) {
          return {
            success: false,
            message: `Track group not found: ${payload.groupId}`,
          };
        }
        session.removeTrackGroup(payload.groupId as string);
        return {
          success: true,
          message: `Track group deleted: ${payload.groupId}`,
        };
      }

      case CommandType.ADD_TO_TRACK_GROUP: {
        if (!payload)
          return {
            success: false,
            message: "ADD_TO_TRACK_GROUP requires a payload",
          };
        const group = session.getTrackGroup(payload.groupId as string);
        if (!group) {
          return {
            success: false,
            message: `Track group not found: ${payload.groupId}`,
          };
        }
        group.addMember(payload.trackId as TrackId);
        const track = session.getTrack(payload.trackId as TrackId);
        if (track) track.groupId = group.id;
        return {
          success: true,
          message: `Track ${payload.trackId} added to group ${payload.groupId}`,
        };
      }

      case CommandType.REMOVE_FROM_TRACK_GROUP: {
        if (!payload)
          return {
            success: false,
            message: "REMOVE_FROM_TRACK_GROUP requires a payload",
          };
        const group = session.getTrackGroup(payload.groupId as string);
        if (!group) {
          return {
            success: false,
            message: `Track group not found: ${payload.groupId}`,
          };
        }
        group.removeMember(payload.trackId as TrackId);
        const track = session.getTrack(payload.trackId as TrackId);
        if (track) track.groupId = null;
        return {
          success: true,
          message: `Track ${payload.trackId} removed from group ${payload.groupId}`,
        };
      }

      case CommandType.SET_TRACK_PARENT: {
        if (!payload)
          return {
            success: false,
            message: "SET_TRACK_PARENT requires a payload",
          };
        session.setTrackParent(
          payload.trackId as TrackId,
          payload.parentId as TrackId | null,
        );
        return { success: true, message: `Track parent set` };
      }

      // ─── VCA Tracks ─────────────────────────────────────────────
      case CommandType.ADD_VCA_TRACK: {
        if (!payload)
          return {
            success: false,
            message: "ADD_VCA_TRACK requires a payload",
          };
        const vca = session.addVCATrack(payload.name as string);
        return {
          success: true,
          message: `VCA track "${payload.name}" added`,
          data: { vcaId: vca.id },
        };
      }

      case CommandType.REMOVE_VCA_TRACK: {
        if (!payload)
          return {
            success: false,
            message: "REMOVE_VCA_TRACK requires a payload",
          };
        const vca = session.getVCATrack(payload.trackId as string);
        if (!vca) {
          return {
            success: false,
            message: `VCA track not found: ${payload.trackId}`,
          };
        }
        session.removeVCATrack(payload.trackId as string);
        return {
          success: true,
          message: `VCA track removed: ${payload.trackId}`,
        };
      }

      case CommandType.SET_VCA_GAIN: {
        if (!payload)
          return { success: false, message: "SET_VCA_GAIN requires a payload" };
        const vca = session.getVCATrack(payload.trackId as string);
        if (!vca) {
          return {
            success: false,
            message: `VCA track not found: ${payload.trackId}`,
          };
        }
        const delta = vca.setGain(payload.gain as number);
        // Apply gain delta to all slave tracks
        for (const slaveId of vca.slaveTrackIds) {
          const slaveTrack = session.getTrack(slaveId);
          if (slaveTrack) {
            const currentVolume = slaveTrack.route.volume;
            slaveTrack.route.volume = currentVolume * delta;
          }
        }
        return { success: true, message: `VCA gain set to ${payload.gain}` };
      }

      case CommandType.ASSIGN_TO_VCA: {
        if (!payload)
          return {
            success: false,
            message: "ASSIGN_TO_VCA requires a payload",
          };
        const vca = session.getVCATrack(payload.vcaTrackId as string);
        if (!vca) {
          return {
            success: false,
            message: `VCA track not found: ${payload.vcaTrackId}`,
          };
        }
        vca.addSlave(payload.trackId as TrackId);
        return {
          success: true,
          message: `Track ${payload.trackId} assigned to VCA ${payload.vcaTrackId}`,
        };
      }

      // ─── CD Markers ─────────────────────────────────────────────
      case CommandType.ADD_CD_MARKER: {
        if (!payload)
          return {
            success: false,
            message: "ADD_CD_MARKER requires a payload",
          };
        const existingMarkers = session.cdMarkers;
        const nextIndex =
          existingMarkers.length > 0
            ? Math.max(...existingMarkers.map((m) => m.index)) + 1
            : 1;
        const cdMarker = session.addCDMarker(
          nextIndex,
          payload.name as string,
          payload.position as number,
        );
        return {
          success: true,
          message: `CD marker "${payload.name}" added at position ${payload.position}`,
          data: { markerId: cdMarker.id },
        };
      }

      case CommandType.REMOVE_CD_MARKER: {
        if (!payload)
          return {
            success: false,
            message: "REMOVE_CD_MARKER requires a payload",
          };
        const cdMarker = session.getCDMarker(payload.markerId as string);
        if (!cdMarker) {
          return {
            success: false,
            message: `CD marker not found: ${payload.markerId}`,
          };
        }
        session.removeCDMarker(payload.markerId as string);
        return {
          success: true,
          message: `CD marker removed: ${payload.markerId}`,
        };
      }

      case CommandType.GENERATE_CUE_SHEET: {
        const { generateCueSheet } = await import("../../domain/CDMarker");
        const markers = session.cdMarkers;
        if (markers.length === 0) {
          return {
            success: false,
            message: "No CD markers to generate cue sheet from",
          };
        }
        const cueSheet = generateCueSheet(
          [...markers],
          session.sampleRate,
          session.name,
        );
        return {
          success: true,
          message: "Cue sheet generated",
          data: { cueSheet },
        };
      }

      // ─── Sidechain ──────────────────────────────────────────────
      case CommandType.SET_SIDECHAIN_SOURCE: {
        if (!payload)
          return {
            success: false,
            message: "SET_SIDECHAIN_SOURCE requires a payload",
          };
        // Find or create sidechain config for the target track
        const configs = session.getSidechainConfigsForTrack(
          payload.trackId as TrackId,
        );
        if (configs.length > 0) {
          configs[0].setSource(payload.sourceTrackId as TrackId);
          configs[0].setEnabled(true);
        } else {
          // Create a new sidechain config
          const config = session.addSidechainConfig(
            payload.trackId as TrackId,
            "default",
          );
          config.setSource(payload.sourceTrackId as TrackId);
          config.setEnabled(true);
        }
        return {
          success: true,
          message: `Sidechain source set: ${payload.sourceTrackId} → ${payload.trackId}`,
        };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
