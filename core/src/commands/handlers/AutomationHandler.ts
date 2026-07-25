import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { AddAutomationPointCommand } from "../impl/AddAutomationPointCommand";
import { MoveAutomationPointCommand } from "../impl/MoveAutomationPointCommand";
import { RemoveAutomationPointCommand } from "../impl/RemoveAutomationPointCommand";
import { AddPluginCommand } from "../impl/AddPluginCommand";
import { RemovePluginCommand } from "../impl/RemovePluginCommand";
import { InterpolationType } from "../../automation/types";
import { AutomationMode } from "../../automation/AutomationMode";

/**
 * Automation & Plugin Command Handler
 *
 * Automation Point 관리, Plugin 추가/제거 등 처리
 */
export class AutomationHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.ADD_AUTOMATION,
    CommandType.MOVE_AUTOMATION_POINT,
    CommandType.REMOVE_AUTOMATION_POINT,
    CommandType.ADD_PLUGIN,
    CommandType.REMOVE_PLUGIN,
    CommandType.SET_AUTOMATION_MODE,
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
      case CommandType.ADD_AUTOMATION: {
        const cmd = new AddAutomationPointCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.processorId as string,
          payload.parameter as string,
          payload.time as number,
          payload.value as number,
          payload.interpolation as InterpolationType | undefined,
        );
        await history.execute(cmd);
        return {
          success: true,
          message: `Automation point added to ${payload.parameter}`,
        };
      }

      case CommandType.MOVE_AUTOMATION_POINT: {
        const cmd = new MoveAutomationPointCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.processorId as string,
          payload.parameter as string,
          payload.pointId as string,
          payload.newTime as number,
          payload.newValue as number,
        );
        await history.execute(cmd);
        return { success: true, message: "Automation point moved" };
      }

      case CommandType.REMOVE_AUTOMATION_POINT: {
        const cmd = new RemoveAutomationPointCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.processorId as string,
          payload.parameter as string,
          payload.pointId as string,
        );
        await history.execute(cmd);
        return { success: true, message: "Automation point removed" };
      }

      case CommandType.ADD_PLUGIN: {
        const cmd = new AddPluginCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.pluginId as string,
          (payload.index as number) || 0,
          payload.position as "pre" | "post" | undefined,
        );
        await history.execute(cmd);
        return {
          success: true,
          message: `Plugin ${payload.pluginId} added (Processor ID: ${cmd.createdProcessor?.id})`,
        };
      }

      case CommandType.REMOVE_PLUGIN: {
        const cmd = new RemovePluginCommand(
          audioEngine.session,
          payload.trackId as string,
          payload.processorId as string,
        );
        await history.execute(cmd);
        return { success: true, message: "Plugin removed" };
      }

      case CommandType.SET_AUTOMATION_MODE: {
        const track = audioEngine.session.getTrack(payload.trackId as string);
        if (!track) {
          return {
            success: false,
            message: `Track not found: ${payload.trackId}`,
          };
        }
        // Search processors including panner
        const allProcessors = [...track.route.processors, track.route.panner];
        const processor = allProcessors.find(
          (p) => p.id === (payload!.processorId as string),
        );
        if (!processor) {
          return {
            success: false,
            message: `Processor not found: ${payload.processorId}`,
          };
        }
        // Use getAutomation to lazily create the list if needed
        const list = processor.getAutomation(payload.parameter as string);
        list.mode = payload.mode as AutomationMode;
        return {
          success: true,
          message: `Automation mode set to ${payload.mode}`,
        };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
