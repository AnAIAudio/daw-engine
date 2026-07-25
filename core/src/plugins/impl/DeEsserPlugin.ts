import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * De-Esser Plugin (I-1)
 *
 * Reduces sibilance in vocal recordings by applying dynamic gain reduction
 * to a narrow frequency band (typically 2-12 kHz).
 *
 * Parameters:
 * - frequency: Center frequency of the sibilance band (2000-12000 Hz)
 * - threshold: Level above which reduction is applied (-40 to 0 dB)
 * - reduction: Amount of gain reduction to apply (0-20 dB)
 * - listenMode: Solo the sibilance band for monitoring (0=off, 1=on)
 *
 * Registered as: internal-deesser
 */
export class DeEsserPlugin extends GenericPlugin {
  constructor(
    id: PluginId,
    name: string = "De-Esser",
    type: PluginType = PluginType.EFFECT,
  ) {
    super(id, name, type);

    this.addParameter({
      id: "frequency",
      name: "Frequency",
      value: 6000,
      min: 2000,
      max: 12000,
      step: 100,
    });
    this.addParameter({
      id: "threshold",
      name: "Threshold",
      value: -20,
      min: -40,
      max: 0,
      step: 0.5,
    });
    this.addParameter({
      id: "reduction",
      name: "Reduction",
      value: 6,
      min: 0,
      max: 20,
      step: 0.5,
    });
    this.addParameter({
      id: "listenMode",
      name: "Listen",
      value: 0,
      min: 0,
      max: 1,
      step: 1,
    });
  }
}
