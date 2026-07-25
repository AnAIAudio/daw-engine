import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";

/**
 * IO Command Handler
 *
 * IO 연결/해제 등 처리
 */
export class IOHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.CONNECT_IO,
    CommandType.DISCONNECT_IO,
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
    if (!payload) {
      return { success: false, message: `${commandType} requires a payload` };
    }

    switch (commandType) {
      case CommandType.CONNECT_IO: {
        const sourceIO = audioEngine.session.getIO(payload.sourceId as string);
        const destIO = audioEngine.session.getIO(payload.destId as string);

        if (sourceIO && destIO) {
          try {
            sourceIO.connect(destIO.id);
            return {
              success: true,
              message: `Connected ${payload.sourceId} to ${payload.destId}`,
            };
          } catch (e) {
            return {
              success: false,
              message: `Connection failed: ${(e as Error).message}`,
            };
          }
        }
        return {
          success: false,
          message: "Source or Destination IO not found",
        };
      }

      case CommandType.DISCONNECT_IO: {
        const sourceIO = audioEngine.session.getIO(payload.sourceId as string);
        const destIO = audioEngine.session.getIO(payload.destId as string);

        if (sourceIO && destIO) {
          sourceIO.disconnect(destIO.id);
          return {
            success: true,
            message: `Disconnected ${payload.sourceId} from ${payload.destId}`,
          };
        }
        return {
          success: false,
          message: "Source or Destination IO not found",
        };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
