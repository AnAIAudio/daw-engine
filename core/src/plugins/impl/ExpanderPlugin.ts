/**
 * Expander / Noise Gate Plugin (G-3)
 *
 * Expander with gate mode.
 * Parameters:
 *   - threshold  (-60 to 0 dB)
 *   - ratio      (1 to 20, expressed as expansion ratio 1:N)
 *   - attack     (0.1 to 100 ms)
 *   - release    (1 to 1000 ms)
 *   - knee       (0 to 20 dB)
 *   - range      (-90 to 0 dB)  — maximum gain reduction; -90 dB = full gate
 *
 * When range = -90 dB and ratio >= 20, the expander behaves as a noise gate.
 * A separate `internal-gate` descriptor in PluginManager uses different defaults.
 *
 * Actual DSP is handled by the AudioProvider; this file defines the
 * parameter model only, following the GenericPlugin pattern.
 */

import { GenericPlugin } from "./GenericPlugin";
import { PluginId, PluginType } from "../Plugin";

export interface ExpanderDefaults {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  range: number;
}

/** Default values for the expander configuration. */
export const EXPANDER_DEFAULTS: ExpanderDefaults = {
  threshold: -30,
  ratio: 2,
  attack: 5,
  release: 50,
  knee: 6,
  range: -12,
};

/** Default values for the gate configuration (same plugin, different defaults). */
export const GATE_DEFAULTS: ExpanderDefaults = {
  threshold: -40,
  ratio: 20,
  attack: 0.5,
  release: 50,
  knee: 0,
  range: -90,
};

/**
 * Adds expander/gate parameters to a GenericPlugin instance.
 * Called from PluginManager.createPlugin() for `internal-expander` and `internal-gate`.
 */
export function initExpanderParameters(
  plugin: GenericPlugin,
  defaults: ExpanderDefaults,
): void {
  plugin.addParameter({
    id: "threshold",
    name: "Threshold",
    value: defaults.threshold,
    min: -60,
    max: 0,
    step: 0.5,
  });

  plugin.addParameter({
    id: "ratio",
    name: "Ratio",
    value: defaults.ratio,
    min: 1,
    max: 20,
    step: 0.5,
  });

  plugin.addParameter({
    id: "attack",
    name: "Attack",
    value: defaults.attack,
    min: 0.1,
    max: 100,
    step: 0.1,
  });

  plugin.addParameter({
    id: "release",
    name: "Release",
    value: defaults.release,
    min: 1,
    max: 1000,
    step: 1,
  });

  plugin.addParameter({
    id: "knee",
    name: "Knee",
    value: defaults.knee,
    min: 0,
    max: 20,
    step: 0.5,
  });

  plugin.addParameter({
    id: "range",
    name: "Range",
    value: defaults.range,
    min: -90,
    max: 0,
    step: 0.5,
  });
}

/** Convenience helper – creates a fully-initialised expander plugin. */
export function createExpanderPlugin(id: PluginId): GenericPlugin {
  const plugin = new GenericPlugin(id, "Expander", PluginType.EFFECT);
  initExpanderParameters(plugin, EXPANDER_DEFAULTS);
  return plugin;
}

/** Convenience helper – creates a fully-initialised noise gate plugin. */
export function createGatePlugin(id: PluginId): GenericPlugin {
  const plugin = new GenericPlugin(id, "Gate", PluginType.EFFECT);
  initExpanderParameters(plugin, GATE_DEFAULTS);
  return plugin;
}
