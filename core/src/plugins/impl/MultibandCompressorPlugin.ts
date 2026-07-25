import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Multiband Compressor Plugin (I-2)
 *
 * Three-band compressor with independent compression parameters per band
 * and adjustable crossover frequencies.
 *
 * Bands: Low, Mid, High
 * Each band has: Threshold, Ratio, Attack, Release
 * Crossover points: lowFrequency (low->mid), highFrequency (mid->high)
 *
 * Registered as: internal-multiband-comp
 */
export class MultibandCompressorPlugin extends GenericPlugin {
  constructor(
    id: PluginId,
    name: string = "Multiband Compressor",
    type: PluginType = PluginType.EFFECT,
  ) {
    super(id, name, type);

    // Crossover frequencies
    this.addParameter({
      id: "lowFrequency",
      name: "Low Crossover",
      value: 200,
      min: 50,
      max: 1000,
      step: 10,
    });
    this.addParameter({
      id: "highFrequency",
      name: "High Crossover",
      value: 4000,
      min: 1000,
      max: 16000,
      step: 100,
    });

    // Low band
    this.addParameter({
      id: "lowThreshold",
      name: "Low Threshold",
      value: -24,
      min: -60,
      max: 0,
      step: 0.5,
    });
    this.addParameter({
      id: "lowRatio",
      name: "Low Ratio",
      value: 4,
      min: 1,
      max: 20,
      step: 0.5,
    });
    this.addParameter({
      id: "lowAttack",
      name: "Low Attack",
      value: 0.01,
      min: 0.001,
      max: 0.5,
      step: 0.001,
    });
    this.addParameter({
      id: "lowRelease",
      name: "Low Release",
      value: 0.2,
      min: 0.01,
      max: 2,
      step: 0.01,
    });

    // Mid band
    this.addParameter({
      id: "midThreshold",
      name: "Mid Threshold",
      value: -20,
      min: -60,
      max: 0,
      step: 0.5,
    });
    this.addParameter({
      id: "midRatio",
      name: "Mid Ratio",
      value: 3,
      min: 1,
      max: 20,
      step: 0.5,
    });
    this.addParameter({
      id: "midAttack",
      name: "Mid Attack",
      value: 0.005,
      min: 0.001,
      max: 0.5,
      step: 0.001,
    });
    this.addParameter({
      id: "midRelease",
      name: "Mid Release",
      value: 0.15,
      min: 0.01,
      max: 2,
      step: 0.01,
    });

    // High band
    this.addParameter({
      id: "highThreshold",
      name: "High Threshold",
      value: -18,
      min: -60,
      max: 0,
      step: 0.5,
    });
    this.addParameter({
      id: "highRatio",
      name: "High Ratio",
      value: 2,
      min: 1,
      max: 20,
      step: 0.5,
    });
    this.addParameter({
      id: "highAttack",
      name: "High Attack",
      value: 0.003,
      min: 0.001,
      max: 0.5,
      step: 0.001,
    });
    this.addParameter({
      id: "highRelease",
      name: "High Release",
      value: 0.1,
      min: 0.01,
      max: 2,
      step: 0.01,
    });
  }
}
