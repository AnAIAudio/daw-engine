import { Signal } from "../lib/Signal";
import { Plugin } from "./Plugin";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A named snapshot of plugin parameter values that can be saved, recalled,
 * and applied to a compatible plugin instance.
 */
export interface PluginPreset {
  /** Unique preset identifier. */
  id: string;
  /** Human-readable preset name. */
  name: string;
  /** Descriptor ID of the plugin this preset targets (e.g. 'internal-reverb'). */
  pluginId: string;
  /** Optional version string the preset was created against. */
  pluginVersion?: string;
  /** Parameter name -> value map. */
  parameters: Record<string, number>;
  /** Arbitrary key/value metadata (author, notes, tags, etc.). */
  metadata?: Record<string, string>;
  /** Whether this preset ships with the application (factory) or was
   *  created by the user. */
  isFactory: boolean;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

// ─── Snapshot for serialization ──────────────────────────────────────────────

interface PluginPresetManagerSnapshot {
  /** pluginId -> array of presets */
  presets: Record<string, PluginPreset[]>;
}

// ─── PluginPresetManager ─────────────────────────────────────────────────────

/**
 * Manages plugin presets across all plugin types.
 *
 * Presets are organized by `pluginId` so they can be quickly looked up when
 * a user opens a plugin UI.  The manager distinguishes between factory
 * presets (read-only, shipped with the application) and user presets.
 *
 * Signal-based notification is provided via `presetsChanged`, which emits
 * the affected `pluginId` whenever presets are added, removed, or updated.
 */
export class PluginPresetManager {
  /** pluginId -> ordered array of presets */
  private _presets: Map<string, PluginPreset[]> = new Map();

  /**
   * Emitted whenever presets change for a given plugin. The payload is the
   * affected `pluginId`.
   */
  public readonly presetsChanged = new Signal<string>();

  // ─── CRUD ─────────────────────────────────────────────────────────────

  /**
   * Save a new user preset for the specified plugin.
   *
   * @returns The newly created preset (with generated `id` and timestamp).
   */
  savePreset(
    pluginId: string,
    name: string,
    parameters: Record<string, number>,
    metadata?: Record<string, string>,
    pluginVersion?: string,
  ): PluginPreset {
    const preset: PluginPreset = {
      id: crypto.randomUUID(),
      name,
      pluginId,
      pluginVersion,
      parameters: { ...parameters },
      metadata: metadata ? { ...metadata } : undefined,
      isFactory: false,
      createdAt: new Date().toISOString(),
    };

    if (!this._presets.has(pluginId)) {
      this._presets.set(pluginId, []);
    }
    this._presets.get(pluginId)!.push(preset);
    this.presetsChanged.emit(pluginId);
    return preset;
  }

  /**
   * Delete a preset by its unique ID. Factory presets cannot be deleted.
   *
   * @returns `true` if the preset was found and deleted.
   */
  deletePreset(presetId: string): boolean {
    for (const [pluginId, presets] of this._presets) {
      const index = presets.findIndex((p) => p.id === presetId);
      if (index === -1) continue;

      if (presets[index].isFactory) {
        throw new Error(`Cannot delete factory preset: ${presets[index].name}`);
      }

      presets.splice(index, 1);
      this.presetsChanged.emit(pluginId);
      return true;
    }
    return false;
  }

  /**
   * Get all presets (factory + user) for a given plugin type.
   */
  getPresetsForPlugin(pluginId: string): PluginPreset[] {
    return [...(this._presets.get(pluginId) ?? [])];
  }

  /**
   * Get a single preset by its unique ID, searching across all plugins.
   */
  getPreset(presetId: string): PluginPreset | undefined {
    for (const presets of this._presets.values()) {
      const found = presets.find((p) => p.id === presetId);
      if (found) return found;
    }
    return undefined;
  }

  // ─── Apply ────────────────────────────────────────────────────────────

  /**
   * Apply a preset to a live Plugin instance by calling `setParameter()`
   * for each stored parameter value.
   */
  applyPreset(presetId: string, plugin: Plugin): void {
    const preset = this.getPreset(presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    // Use the plugin's setState if available (bulk update)
    plugin.setState(preset.parameters);
  }

  // ─── Factory presets ──────────────────────────────────────────────────

  /**
   * Register one or more factory presets for a plugin type.
   *
   * Factory presets are read-only and are prepended to the preset list so
   * they appear before user presets in UIs.
   */
  registerFactoryPresets(
    pluginId: string,
    presets: Omit<PluginPreset, "id" | "createdAt" | "isFactory">[],
  ): void {
    if (!this._presets.has(pluginId)) {
      this._presets.set(pluginId, []);
    }

    const list = this._presets.get(pluginId)!;

    const factoryPresets: PluginPreset[] = presets.map((p) => ({
      ...p,
      id: `factory-${pluginId}-${crypto.randomUUID()}`,
      isFactory: true,
      createdAt: new Date().toISOString(),
    }));

    // Prepend factory presets so they appear first
    list.unshift(...factoryPresets);
    this.presetsChanged.emit(pluginId);
  }

  // ─── Serialization ────────────────────────────────────────────────────

  /**
   * Serialize all presets (factory + user) to a JSON string.
   */
  serialize(): string {
    const snapshot: PluginPresetManagerSnapshot = {
      presets: {},
    };

    for (const [pluginId, presets] of this._presets) {
      snapshot.presets[pluginId] = presets.map((p) => ({ ...p }));
    }

    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Restore a PluginPresetManager from a JSON string produced by
   * `serialize()`.
   */
  static deserialize(json: string): PluginPresetManager {
    const snapshot: PluginPresetManagerSnapshot = JSON.parse(json);
    const manager = new PluginPresetManager();

    for (const [pluginId, presets] of Object.entries(snapshot.presets)) {
      manager._presets.set(
        pluginId,
        presets.map((p) => ({ ...p })),
      );
    }

    return manager;
  }
}
