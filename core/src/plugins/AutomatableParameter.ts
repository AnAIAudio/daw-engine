import { PluginManager } from "./PluginManager";

/**
 * AutomatableParameter (I-5)
 *
 * Data model for plugin parameters that can be automated.
 * Extends the basic PluginParameter concept with automation-specific metadata.
 */
export interface AutomatableParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  unit: string;
  automationEnabled: boolean;
}

/**
 * Parameter unit mapping for common plugin parameter types.
 */
const PARAM_UNITS: Record<string, string> = {
  // Frequency parameters
  frequency: "Hz",
  lowFreq: "Hz",
  midFreq: "Hz",
  highFreq: "Hz",
  lowFrequency: "Hz",
  highFrequency: "Hz",

  // Gain / level parameters
  gain: "dB",
  lowGain: "dB",
  midGain: "dB",
  highGain: "dB",
  threshold: "dB",
  lowThreshold: "dB",
  midThreshold: "dB",
  highThreshold: "dB",
  makeupGain: "dB",
  reduction: "dB",

  // Ratio parameters
  ratio: ":1",
  lowRatio: ":1",
  midRatio: ":1",
  highRatio: ":1",

  // Time parameters
  attack: "s",
  release: "s",
  lowAttack: "s",
  lowRelease: "s",
  midAttack: "s",
  midRelease: "s",
  highAttack: "s",
  highRelease: "s",
  decay: "s",
  preDelay: "s",
  delayTime: "s",

  // Normalized (0-1)
  wet: "",
  depth: "",
  drive: "",
  warmth: "",
  saturation: "",
  distortion: "",

  // Dimensionless
  Q: "",
  midQ: "",
  knee: "dB",
  type: "",
  listenMode: "",
};

/**
 * Resolve the unit string for a given parameter ID.
 */
function resolveUnit(paramId: string): string {
  return PARAM_UNITS[paramId] ?? "";
}

/**
 * Get all automatable parameters for a given plugin instance.
 *
 * Creates a temporary plugin from PluginManager to introspect its default parameters,
 * then returns AutomatableParameter descriptors with default values and units.
 *
 * @param pluginId - The unique instance ID of the plugin (not used for lookup, kept for API)
 * @param descriptorId - The plugin descriptor ID (e.g., 'internal-reverb')
 * @returns Array of AutomatableParameter descriptors
 */
export function getAutomatableParameters(
  _pluginId: string,
  descriptorId: string,
): AutomatableParameter[] {
  const manager = PluginManager.getInstance();
  const tempPlugin = manager.createPlugin(descriptorId);
  if (!tempPlugin) return [];

  const params = tempPlugin.getParameters();
  return params.map((p) => ({
    id: p.id,
    name: p.name,
    value: p.value,
    min: p.min,
    max: p.max,
    defaultValue: p.value,
    unit: resolveUnit(p.id),
    automationEnabled: false,
  }));
}
