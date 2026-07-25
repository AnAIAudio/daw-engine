import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { AddSendBusCommand } from "../impl/AddSendBusCommand";
import { RemoveSendBusCommand } from "../impl/RemoveSendBusCommand";
import { SetSendLevelCommand } from "../impl/SetSendLevelCommand";

/**
 * SendBus Command Handler
 *
 * Side-chain / Parallel Processing Send Bus 추가·제거·레벨 변경을 처리합니다.
 */
export class SendBusHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.ADD_SEND_BUS,
    CommandType.REMOVE_SEND_BUS,
    CommandType.SET_SEND_LEVEL,
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
    if (!payload) {
      return { success: false, message: `${commandType} requires a payload` };
    }

    switch (commandType) {
      case CommandType.ADD_SEND_BUS: {
        const cmd = new AddSendBusCommand({
          sourceTrackId: payload.sourceTrackId as string,
          destId: payload.destId as string,
          level: payload.level as number | undefined,
          preFader: payload.preFader as boolean | undefined,
          id: payload.id as string | undefined,
        });
        await history.execute(cmd);
        return {
          success: true,
          message: `Send Bus added (${payload.sourceTrackId} -> ${payload.destId})`,
        };
      }

      case CommandType.REMOVE_SEND_BUS: {
        const cmd = new RemoveSendBusCommand({
          sendBusId: payload.sendBusId as string,
        });
        await history.execute(cmd);
        return {
          success: true,
          message: `Send Bus removed (${payload.sendBusId})`,
        };
      }

      case CommandType.SET_SEND_LEVEL: {
        const cmd = new SetSendLevelCommand({
          sendBusId: payload.sendBusId as string,
          level: payload.level as number,
        });
        await history.execute(cmd);
        return {
          success: true,
          message: `Send Bus level set: ${payload.sendBusId} -> ${payload.level}dB`,
        };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
