import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Vibrato modulation effect plugin.
 *
 * Parameters:
 *  - rate:  LFO speed (0.1 – 10 Hz)
 *  - depth: modulation depth (0 – 1)
 *  - wet:   dry/wet mix (0 – 1)
 */
export class VibratoPlugin extends GenericPlugin {
  constructor(id: PluginId, name: string, type: PluginType) {
    super(id, name, type);

    this.addParameter({
      id: "rate",
      name: "Rate",
      value: 5.0,
      min: 0.1,
      max: 10,
      step: 0.1,
    });
    this.addParameter({
      id: "depth",
      name: "Depth",
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "wet",
      name: "Wet",
      value: 1.0,
      min: 0,
      max: 1,
      step: 0.01,
    });
  }
}
