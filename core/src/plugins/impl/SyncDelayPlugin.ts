import { PluginId, PluginType } from "../Plugin";
import { GenericPlugin } from "./GenericPlugin";

/**
 * Tempo-sync delay effect plugin.
 *
 * When sync is enabled (sync = 1), the effective delay time is calculated from BPM
 * and the selected note divisor:
 *   delayTime = (60 / bpm) * divisorValue
 *
 * Divisor mapping:
 *   0 = 1/4 note  (1.0)
 *   1 = 1/8 note  (0.5)
 *   2 = 1/16 note (0.25)
 *   3 = dotted    (base * 1.5)  – uses 1/8 as base
 *   4 = triplet   (base * 2/3)  – uses 1/4 as base
 *
 * When sync is off (sync = 0), the raw delayTime parameter is used.
 *
 * Parameters:
 *  - sync:      tempo sync toggle (0 = off, 1 = on)
 *  - divisor:   note value selector (0–4, see mapping above)
 *  - feedback:  feedback amount (0 – 0.95)
 *  - lpf:       low-pass filter cutoff in the feedback path (200 – 20000 Hz)
 *  - wet:       dry/wet mix (0 – 1)
 *  - delayTime: manual delay time in seconds (0.01 – 2.0, used when sync = off)
 */
export class SyncDelayPlugin extends GenericPlugin {
  constructor(id: PluginId, name: string, type: PluginType) {
    super(id, name, type);

    this.addParameter({
      id: "sync",
      name: "Sync",
      value: 1,
      min: 0,
      max: 1,
      step: 1,
    });
    this.addParameter({
      id: "divisor",
      name: "Divisor",
      value: 0,
      min: 0,
      max: 4,
      step: 1,
    });
    this.addParameter({
      id: "feedback",
      name: "Feedback",
      value: 0.35,
      min: 0,
      max: 0.95,
      step: 0.01,
    });
    this.addParameter({
      id: "lpf",
      name: "LPF",
      value: 8000,
      min: 200,
      max: 20000,
      step: 1,
    });
    this.addParameter({
      id: "wet",
      name: "Wet",
      value: 0.4,
      min: 0,
      max: 1,
      step: 0.01,
    });
    this.addParameter({
      id: "delayTime",
      name: "Delay Time",
      value: 0.5,
      min: 0.01,
      max: 2.0,
      step: 0.01,
    });
  }

  /**
   * Get the divisor multiplier for the currently selected divisor value.
   */
  public static divisorMultiplier(divisor: number): number {
    switch (Math.round(divisor)) {
      case 0:
        return 1.0; // 1/4
      case 1:
        return 0.5; // 1/8
      case 2:
        return 0.25; // 1/16
      case 3:
        return 0.5 * 1.5; // dotted 1/8
      case 4:
        return 1.0 * (2 / 3); // triplet 1/4
      default:
        return 1.0;
    }
  }

  /**
   * Compute the effective delay time in seconds.
   */
  public getEffectiveDelayTime(bpm: number): number {
    const sync = this.getParameter("sync")?.value ?? 0;
    if (sync < 0.5) {
      return this.getParameter("delayTime")?.value ?? 0.5;
    }
    const divisor = this.getParameter("divisor")?.value ?? 0;
    const quarterNote = 60 / bpm;
    return quarterNote * SyncDelayPlugin.divisorMultiplier(divisor);
  }
}
