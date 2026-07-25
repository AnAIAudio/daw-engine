import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Phaser modulation effect plugin.
 *
 * Parameters:
 *  - rate:          LFO speed (0.1 – 10 Hz)
 *  - depth:         modulation depth (0 – 1)
 *  - baseFrequency: centre frequency of the allpass chain (200 – 5000 Hz)
 *  - wet:           dry/wet mix (0 – 1)
 */
export class PhaserPlugin extends GenericPlugin {
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
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "baseFrequency",
      name: "Base Frequency",
      value: 1000,
      min: 200,
      max: 5000,
      step: 1,
    });
    this.addParameter({
      id: "wet",
      name: "Wet",
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    });
  }
}
