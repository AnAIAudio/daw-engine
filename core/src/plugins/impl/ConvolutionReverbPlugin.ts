import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Convolution Reverb plugin (metadata-only).
 *
 * Actual convolution processing requires impulse-response (IR) buffer loading
 * in the audio backend. This plugin exposes the parameter model so the UI and
 * preset system can drive the backend.
 *
 * Parameters:
 *  - wet:      dry/wet mix (0 – 1)
 *  - preDelay: pre-delay in milliseconds (0 – 100)
 *  - irType:   impulse response type selector
 *              0 = small_room, 1 = hall, 2 = plate, 3 = chamber
 */
export class ConvolutionReverbPlugin extends GenericPlugin {
  constructor(id: PluginId, name: string, type: PluginType) {
    super(id, name, type);

    this.addParameter({
      id: "wet",
      name: "Wet",
      value: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "preDelay",
      name: "Pre-Delay",
      value: 10,
      min: 0,
      max: 100,
      step: 1,
    });
    this.addParameter({
      id: "irType",
      name: "IR Type",
      value: 0,
      min: 0,
      max: 3,
      step: 1,
    });
  }

  /** Human-readable label for the current IR type. */
  public static irTypeLabel(irType: number): string {
    switch (Math.round(irType)) {
      case 0:
        return "Small Room";
      case 1:
        return "Hall";
      case 2:
        return "Plate";
      case 3:
        return "Chamber";
      default:
        return "Unknown";
    }
  }
}
