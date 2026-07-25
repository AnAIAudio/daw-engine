/**
 * 6-Band Parametric EQ Plugin (G-1)
 *
 * 6-band parametric EQ:
 *   Band 1: Low Shelf  (160 Hz default)
 *   Band 2: Peak       (397 Hz default)
 *   Band 3: Peak       (1 kHz default)
 *   Band 4: Peak       (2.5 kHz default)
 *   Band 5: Peak       (6.3 kHz default)
 *   Band 6: High Shelf (9 kHz default)
 *
 * Each band exposes: Frequency, Gain, Q (Peak only), Bypass
 * Actual DSP is handled by the AudioProvider; this file defines the
 * parameter model only, following the GenericPlugin pattern.
 */

import { GenericPlugin } from "./GenericPlugin";
import { PluginId, PluginType } from "../Plugin";

/** Band definition used during parameter initialisation. */
interface BandDef {
  index: number;
  freq: number;
  freqMin: number;
  freqMax: number;
  isShelf: boolean;
}

const BAND_DEFS: BandDef[] = [
  { index: 1, freq: 160, freqMin: 20, freqMax: 1000, isShelf: true },
  { index: 2, freq: 397, freqMin: 50, freqMax: 2000, isShelf: false },
  { index: 3, freq: 1000, freqMin: 200, freqMax: 5000, isShelf: false },
  { index: 4, freq: 2500, freqMin: 500, freqMax: 10000, isShelf: false },
  { index: 5, freq: 6300, freqMin: 1000, freqMax: 16000, isShelf: false },
  { index: 6, freq: 9000, freqMin: 2000, freqMax: 20000, isShelf: true },
];

/**
 * Adds the 6-band parametric EQ parameters to a GenericPlugin instance.
 * Called from PluginManager.createPlugin() for `internal-eq6`.
 */
export function initParametricEQParameters(plugin: GenericPlugin): void {
  for (const band of BAND_DEFS) {
    const b = `band${band.index}`;

    // Frequency
    plugin.addParameter({
      id: `${b}Freq`,
      name: `Band ${band.index} Freq`,
      value: band.freq,
      min: band.freqMin,
      max: band.freqMax,
      step: 1,
    });

    // Gain (-24 to +24 dB)
    plugin.addParameter({
      id: `${b}Gain`,
      name: `Band ${band.index} Gain`,
      value: 0,
      min: -24,
      max: 24,
      step: 0.5,
    });

    // Q (only for peak bands)
    if (!band.isShelf) {
      plugin.addParameter({
        id: `${b}Q`,
        name: `Band ${band.index} Q`,
        value: 1,
        min: 0.1,
        max: 18,
        step: 0.1,
      });
    }

    // Bypass toggle (0 = active, 1 = bypassed)
    plugin.addParameter({
      id: `${b}Bypass`,
      name: `Band ${band.index} Bypass`,
      value: 0,
      min: 0,
      max: 1,
      step: 1,
    });
  }
}

/** Convenience helper – creates a fully-initialised 6-band EQ plugin. */
export function createParametricEQPlugin(id: PluginId): GenericPlugin {
  const plugin = new GenericPlugin(
    id,
    "6-Band Parametric EQ",
    PluginType.EFFECT,
  );
  initParametricEQParameters(plugin);
  return plugin;
}
