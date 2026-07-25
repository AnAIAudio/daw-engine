import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { RangeId } from "../../domain/types";
import { AddRangeCommand } from "../impl/AddRangeCommand";
import { RemoveRangeCommand } from "../impl/RemoveRangeCommand";
import { SetRangeCommand } from "../impl/SetRangeCommand";
import { SetLoopRangeCommand } from "../impl/SetLoopRangeCommand";
import { ToggleLoopCommand } from "../impl/ToggleLoopCommand";
import { SetPunchRangeCommand } from "../impl/SetPunchRangeCommand";

/**
 * Range Command Handler
 *
 * Range 추가/제거/수정, Loop/Punch 설정 등 처리
 */
export class RangeHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.ADD_RANGE,
    CommandType.REMOVE_RANGE,
    CommandType.SET_RANGE,
    CommandType.LIST_RANGES,
    CommandType.SET_LOOP_RANGE,
    CommandType.TOGGLE_LOOP,
    CommandType.SET_PUNCH_RANGE,
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
      case CommandType.ADD_RANGE: {
        const cmd = new AddRangeCommand(
          payload.name as string,
          payload.start as number,
          payload.end as number,
          payload.color as string | undefined,
        );
        await history.execute(cmd);
        return {
          success: true,
          message: `Range "${payload.name}" added`,
        };
      }

      case CommandType.REMOVE_RANGE: {
        const cmd = new RemoveRangeCommand(payload.rangeId as RangeId);
        await history.execute(cmd);
        return { success: true, message: "Range removed" };
      }

      case CommandType.SET_RANGE: {
        const cmd = new SetRangeCommand(payload.rangeId as RangeId, {
          name: payload.name as string | undefined,
          start: payload.start as number | undefined,
          end: payload.end as number | undefined,
          color: payload.color as string | undefined,
        });
        await history.execute(cmd);
        return { success: true, message: "Range updated" };
      }

      case CommandType.LIST_RANGES: {
        const listRanges = audioEngine.session.ranges.map((r) => r.toDTO());
        const loopRange = audioEngine.session.getLoopRange();
        const punchRange = audioEngine.session.getPunchRange();

        return {
          success: true,
          message: `Found ${listRanges.length} range(s)`,
          data: {
            ranges: listRanges,
            loopRangeId: audioEngine.session.loopRangeId,
            loopEnabled: audioEngine.session.loopEnabled,
            loopRange: loopRange?.toDTO(),
            punchRangeId: audioEngine.session.punchRangeId,
            punchRange: punchRange?.toDTO(),
          },
        };
      }

      case CommandType.SET_LOOP_RANGE: {
        const cmd = new SetLoopRangeCommand(
          payload?.rangeId as RangeId | undefined,
        );
        await history.execute(cmd);

        if (payload?.rangeId) {
          return {
            success: true,
            message: `Loop range set to: ${payload.rangeId}`,
          };
        } else {
          return { success: true, message: "Loop range cleared" };
        }
      }

      case CommandType.TOGGLE_LOOP: {
        const cmd = new ToggleLoopCommand();
        await history.execute(cmd);

        const isEnabled = audioEngine.session.loopEnabled;
        return {
          success: true,
          message: `Loop ${isEnabled ? "enabled" : "disabled"}`,
          data: { loopEnabled: isEnabled },
        };
      }

      case CommandType.SET_PUNCH_RANGE: {
        const cmd = new SetPunchRangeCommand(
          payload?.rangeId as RangeId | undefined,
        );
        await history.execute(cmd);

        if (payload?.rangeId) {
          return {
            success: true,
            message: `Punch range set to: ${payload.rangeId}`,
          };
        } else {
          return { success: true, message: "Punch range cleared" };
        }
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
