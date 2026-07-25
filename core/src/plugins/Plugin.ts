import { Signal } from "../lib/Signal";

export type PluginId = string;
export type ParameterId = string;

export enum PluginType {
  EFFECT = "EFFECT",
  INSTRUMENT = "INSTRUMENT",
  ANALYZER = "ANALYZER",
}

export interface PluginParameter {
  id: ParameterId;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  // Automation support hooks can be added here
}

export interface Plugin {
  readonly id: PluginId;
  name: string;
  readonly type: PluginType;

  readonly parameterChanged: Signal<{ id: ParameterId; value: number }>;

  // Parameters
  getParameters(): ReadonlyArray<PluginParameter>;
  getParameter(id: ParameterId): PluginParameter | undefined;
  setParameter(id: ParameterId, value: number): void;

  // State (Preset)
  getState(): Record<string, number>;
  setState(state: Record<string, number>): void;

  // Processing (Abstracted, actual processing happens in AudioProvider)
  // The AudioProvider will instantiate the corresponding Tone.js/WebAudio node.
}
