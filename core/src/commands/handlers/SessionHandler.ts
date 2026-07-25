import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { SaveSessionCommand } from "../impl/SaveSessionCommand";
import { LoadSessionCommand } from "../impl/LoadSessionCommand";
import { NewSessionCommand } from "../impl/NewSessionCommand";
import { SaveSnapshotCommand } from "../impl/SaveSnapshotCommand";
import { SessionSnapshot } from "../../domain/Session";
import { SessionStorage } from "../../storage/SessionStorage";

/**
 * Session Command Handler
 *
 * Handles session save / load / new / snapshot commands.
 */
export class SessionHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.SAVE_SESSION,
    CommandType.LOAD_SESSION,
    CommandType.NEW_SESSION,
    CommandType.SAVE_SNAPSHOT,
  ]);

  canHandle(commandType: string): boolean {
    return this.supportedCommands.has(commandType);
  }

  async execute(
    commandType: string,
    payload: CommandHandlerPayload | undefined,
    audioEngine: AudioEngine,
    history: CommandHistory,
  ): Promise<CommandResult> {
    switch (commandType) {
      case CommandType.SAVE_SESSION: {
        const cmd = new SaveSessionCommand();
        await cmd.execute();
        return {
          success: true,
          message: `Session saved: ${audioEngine.session.name}`,
        };
      }

      case CommandType.LOAD_SESSION: {
        let snapshot: SessionSnapshot | null = null;

        if (payload?.snapshot) {
          // Load from a provided snapshot object
          snapshot = payload.snapshot as unknown as SessionSnapshot;
        } else if (payload?.sessionId) {
          // Load from IndexedDB by session ID
          const storage = SessionStorage.getInstance();
          snapshot = await storage.loadSession(payload.sessionId as string);
          if (!snapshot) {
            return {
              success: false,
              message: `Session not found: ${payload.sessionId}`,
            };
          }
        }

        if (!snapshot) {
          return {
            success: false,
            message: "LOAD_SESSION: snapshot or sessionId is required",
          };
        }

        const cmd = new LoadSessionCommand(snapshot);
        await history.execute(cmd);
        return { success: true, message: `Session loaded: ${snapshot.name}` };
      }

      case CommandType.NEW_SESSION: {
        const name = payload?.name as string | undefined;
        const templateId = payload?.templateId as string | undefined;
        const cmd = new NewSessionCommand(name, templateId);
        await history.execute(cmd);
        return {
          success: true,
          message: `New session created: ${audioEngine.session.name}`,
        };
      }

      case CommandType.SAVE_SNAPSHOT: {
        const snapshotName = payload?.name as string;
        if (!snapshotName) {
          return { success: false, message: "SAVE_SNAPSHOT: name is required" };
        }
        const cmd = new SaveSnapshotCommand(snapshotName);
        await cmd.execute();
        return {
          success: true,
          message: `Snapshot "${snapshotName}" saved`,
          data: { snapshotId: cmd.snapshotId },
        };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
