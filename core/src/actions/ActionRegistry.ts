import { ActionDefinition, ActionId } from "./types";
import { CommandExecutor } from "../commands/CommandExecutor";
import { KeyBindings } from "../preferences/KeyBindings";

import { logger } from "../utils/Logger";
export class ActionRegistry {
  private static instance: ActionRegistry;
  private actions: Map<ActionId, ActionDefinition> = new Map();
  private keyMap: Map<string, ActionId> = new Map();

  private constructor() {}

  public static getInstance(): ActionRegistry {
    if (!ActionRegistry.instance) {
      ActionRegistry.instance = new ActionRegistry();
    }
    return ActionRegistry.instance;
  }

  public registerDefaults(actions: ActionDefinition[]): void {
    actions.forEach((action: ActionDefinition) => {
      this.register(action);
    });
  }

  public register(action: ActionDefinition) {
    this.actions.set(action.id, action);
    if (action.defaultKey) {
      this.keyMap.set(action.defaultKey.toLowerCase(), action.id);
    }
  }

  public getAction(id: ActionId): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  public getAllActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /**
   * Resolve the effective key for an action, checking custom bindings first,
   * then falling back to the default key.
   */
  public getEffectiveKey(actionId: ActionId): string | undefined {
    const customBinding = KeyBindings.getInstance().getBinding(actionId);
    if (customBinding !== undefined) {
      return customBinding;
    }
    return this.actions.get(actionId)?.defaultKey;
  }

  /**
   * Look up an action by key string, checking custom bindings first,
   * then falling back to default key map.
   */
  public getActionIdByKey(key: string): ActionId | undefined {
    const lowerKey = key.toLowerCase();

    // Check custom bindings first (they take priority)
    const customBindings = KeyBindings.getInstance().getAllBindings();
    for (const [actionId, keyCombo] of customBindings) {
      if (keyCombo.toLowerCase() === lowerKey) {
        return actionId;
      }
    }

    return this.keyMap.get(lowerKey);
  }

  /**
   * Rebuild the key map (useful after registering new actions or changing bindings).
   */
  public rebuildKeyMap(): void {
    this.keyMap.clear();
    for (const action of this.actions.values()) {
      if (action.defaultKey) {
        this.keyMap.set(action.defaultKey.toLowerCase(), action.id);
      }
    }
  }

  /**
   * Get all actions grouped by category.
   * Category is derived from action ID prefix (e.g., "transport.play" -> "Transport").
   */
  public getActionsByCategory(): Map<string, ActionDefinition[]> {
    const categories = new Map<string, ActionDefinition[]>();

    for (const action of this.actions.values()) {
      const dotIndex = action.id.indexOf(".");
      const categoryKey =
        dotIndex >= 0 ? action.id.substring(0, dotIndex) : "general";
      const categoryLabel =
        categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1);

      if (!categories.has(categoryLabel)) {
        categories.set(categoryLabel, []);
      }
      categories.get(categoryLabel)!.push(action);
    }

    return categories;
  }

  public async execute(
    id: ActionId,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const action = this.actions.get(id);
    if (!action) {
      logger.warn("ActionRegistry", `Action not found: ${id}`);
      return;
    }

    if (action.execute) {
      await action.execute(context);
    } else if (action.commandFactory) {
      const command = action.commandFactory(context);
      await CommandExecutor.getInstance().execute(command);
    }
  }
}
