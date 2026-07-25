import {
  CommandHandler,
  CommandHandlerPayload,
  CommandResult,
} from "./CommandHandler";
import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { CommandType } from "../types";
import { DragManager } from "../../domain/DragManager";
import { RegionClipboard } from "../../domain/RegionClipboard";
import { SelectionHistory } from "../../domain/SelectionHistory";

/**
 * History Command Handler
 *
 * Undo/Redo 처리
 *
 * - Blocks undo/redo during recording
 * - Aborts active drags before undo/redo
 * - Resets paste count on undo/redo
 * - Handles selection undo/redo
 */
export class HistoryHandler implements CommandHandler {
  private readonly supportedCommands = new Set<string>([
    CommandType.UNDO,
    CommandType.REDO,
    CommandType.SELECTION_UNDO,
    CommandType.SELECTION_REDO,
  ]);

  private _selectionHistory: SelectionHistory | null = null;
  private _selectionConnected = false;

  private get selectionHistory(): SelectionHistory {
    if (!this._selectionHistory) {
      this._selectionHistory = new SelectionHistory();
    }
    return this._selectionHistory;
  }

  public getSelectionHistory(): SelectionHistory {
    return this.selectionHistory;
  }

  /**
   * Connect selection history to session's selectionChanged signal.
   * Called lazily on first command execution.
   */
  private ensureSelectionTracking(audioEngine: AudioEngine): void {
    if (this._selectionConnected) return;
    this._selectionConnected = true;

    const session = audioEngine.session;
    this.selectionHistory.begin(new Set(session.getSelectedRegionIds()));

    session.selectionChanged.connect((selection: Set<string>) => {
      this.selectionHistory.commit(selection);
    });
  }

  canHandle(commandType: string): boolean {
    return this.supportedCommands.has(commandType);
  }

  async execute(
    commandType: string,
    payload: CommandHandlerPayload | undefined,
    audioEngine: AudioEngine,
    history: CommandHistory,
  ): Promise<CommandResult> {
    // Ensure selection tracking is connected on first use
    this.ensureSelectionTracking(audioEngine);
    switch (commandType) {
      case CommandType.UNDO: {
        // Block during recording
        if (audioEngine.session.isRecording) {
          return { success: false, message: "Cannot undo while recording" };
        }

        if (!history.canUndo) {
          return { success: false, message: "Nothing to undo" };
        }

        // Abort active drags
        if (DragManager.getInstance().active) {
          DragManager.getInstance().abort();
        }

        // Reset paste count
        RegionClipboard.getInstance().resetPasteCount();

        await history.undo();

        // Reset selection history after main undo
        const currentSelection = audioEngine.session.getSelectedRegionIds();
        this.selectionHistory.begin(new Set(currentSelection));

        return { success: true, message: "Undo successful" };
      }

      case CommandType.REDO: {
        // Block during recording
        if (audioEngine.session.isRecording) {
          return { success: false, message: "Cannot redo while recording" };
        }

        if (!history.canRedo) {
          return { success: false, message: "Nothing to redo" };
        }

        // Abort active drags
        if (DragManager.getInstance().active) {
          DragManager.getInstance().abort();
        }

        // Reset paste count
        RegionClipboard.getInstance().resetPasteCount();

        await history.redo();

        // Reset selection history after main redo
        const currentSelectionRedo = audioEngine.session.getSelectedRegionIds();
        this.selectionHistory.begin(new Set(currentSelectionRedo));

        return { success: true, message: "Redo successful" };
      }

      case CommandType.SELECTION_UNDO: {
        const snapshot = this.selectionHistory.undo();
        if (!snapshot) {
          return {
            success: false,
            message: "Nothing to undo in selection history",
          };
        }
        // Apply the selection snapshot to the session
        audioEngine.session.clearSelection();
        for (const regionId of snapshot) {
          audioEngine.session.selectRegion(regionId, true);
        }
        return { success: true, message: "Selection undo successful" };
      }

      case CommandType.SELECTION_REDO: {
        const snapshot = this.selectionHistory.redo();
        if (!snapshot) {
          return {
            success: false,
            message: "Nothing to redo in selection history",
          };
        }
        audioEngine.session.clearSelection();
        for (const regionId of snapshot) {
          audioEngine.session.selectRegion(regionId, true);
        }
        return { success: true, message: "Selection redo successful" };
      }

      default:
        throw new Error(`Unsupported command: ${commandType}`);
    }
  }
}
