import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Auto-Pan modulation effect plugin.
 *
 * Parameters:
 *  - rate:  LFO speed (0.1 – 10 Hz)
 *  - depth: modulation depth (0 – 1)
 *  - type:  LFO waveform (0 = sine, 1 = square, 2 = triangle)
 */
export class AutoPanPlugin extends GenericPlugin {
  constructor(id: PluginId, name: string, type: PluginType) {
    super(id, name, type);

    this.addParameter({
      id: "rate",
      name: "Rate",
      value: 1.0,
      min: 0.1,
      max: 10,
      step: 0.1,
    });
    this.addParameter({
      id: "depth",
      name: "Depth",
      value: 0.8,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "type",
      name: "Type",
      value: 0,
      min: 0,
      max: 2,
      step: 1,
    });
  }
}
