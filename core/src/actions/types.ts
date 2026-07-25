import { AudioCommand } from "../commands/types";

export type ActionId = string;

export enum ActionCategory {
  TRANSPORT = "Transport",
  TRACK = "Track",
  REGION = "Region",
  EDIT = "Edit",
  VIEW = "View",
  FILE = "File",
  DEBUG = "Debug",
}

export interface ActionDefinition {
  id: ActionId;
  label: string;
  category: ActionCategory;
  description?: string;
  /**
   * Factory function to create the command payload.
   * Can accept context arguments if needed.
   * Not required if `execute` is provided.
   */
  commandFactory?: (context?: Record<string, unknown>) => AudioCommand;
  /**
   * Direct execute function (bypasses command system).
   * Used for UI-only actions like opening dialogs.
   */
  execute?: (context?: Record<string, unknown>) => void | Promise<void>;
  /**
   * Default key binding (e.g. 'Space', 'Control+Z')
   */
  defaultKey?: string;
}

export interface KeyBinding {
  actionId: ActionId;
  key: string;
}
