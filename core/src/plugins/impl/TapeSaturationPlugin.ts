import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Tape Saturation Plugin (I-3)
 *
 * Emulates the warm, non-linear characteristics of analog tape recording.
 * Uses a WaveShaperNode concept with soft clipping and high-frequency rolloff.
 *
 * Parameters:
 * - drive: Input gain / saturation amount (0-1)
 * - warmth: High-frequency rolloff amount (0-1), simulates tape head response
 * - saturation: Harmonic saturation intensity (0-1), controls the clipping curve
 * - wet: Dry/wet mix (0-1)
 *
 * Registered as: internal-tape-sat
 */
export class TapeSaturationPlugin extends GenericPlugin {
  constructor(
    id: PluginId,
    name: string = "Tape Saturation",
    type: PluginType = PluginType.EFFECT,
  ) {
    super(id, name, type);

    this.addParameter({
      id: "drive",
      name: "Drive",
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "warmth",
      name: "Warmth",
      value: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "saturation",
      name: "Saturation",
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
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
