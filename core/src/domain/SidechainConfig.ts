import { Signal } from "../lib/Signal";
import { TrackId } from "./types";

/**
 * Sidechain Configuration
 *
 * Routes audio from a source track into a plugin's sidechain input.
 * Commonly used for ducking (e.g., compressor sidechained to a kick drum).
 */
export class SidechainConfig {
  public readonly id: string;
  public readonly targetTrackId: TrackId;
  public readonly targetProcessorId: string;
  private _sourceTrackId: TrackId | null = null;
  public enabled: boolean = false;

  /** Whether a high-pass filter is applied to the sidechain signal. */
  private _sidechainFilterEnabled: boolean = false;

  /** HPF cutoff frequency in Hz (20 - 500 Hz, default 80). */
  private _sidechainFilterFrequency: number = SIDECHAIN_FILTER_FREQ_DEFAULT;

  public readonly sourceChanged = new Signal<TrackId | null>();
  public readonly enabledChanged = new Signal<boolean>();
  public readonly filterChanged = new Signal<{
    enabled: boolean;
    frequency: number;
  }>();

  constructor(id: string, targetTrackId: TrackId, targetProcessorId: string) {
    this.id = id;
    this.targetTrackId = targetTrackId;
    this.targetProcessorId = targetProcessorId;
  }

  public get sourceTrackId(): TrackId | null {
    return this._sourceTrackId;
  }

  public setSource(trackId: TrackId | null): void {
    if (this._sourceTrackId !== trackId) {
      this._sourceTrackId = trackId;
      this.sourceChanged.emit(trackId);
    }
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.enabledChanged.emit(enabled);
    }
  }

  // ─── Sidechain Filter (HPF) ───────────────────────────────────────────────

  public get sidechainFilterEnabled(): boolean {
    return this._sidechainFilterEnabled;
  }

  public get sidechainFilterFrequency(): number {
    return this._sidechainFilterFrequency;
  }

  public setSidechainFilter(enabled: boolean, frequency?: number): void {
    const freq =
      frequency !== undefined
        ? Math.max(
            SIDECHAIN_FILTER_FREQ_MIN,
            Math.min(SIDECHAIN_FILTER_FREQ_MAX, frequency),
          )
        : this._sidechainFilterFrequency;

    const changed =
      this._sidechainFilterEnabled !== enabled ||
      this._sidechainFilterFrequency !== freq;

    this._sidechainFilterEnabled = enabled;
    this._sidechainFilterFrequency = freq;

    if (changed) {
      this.filterChanged.emit({ enabled, frequency: freq });
    }
  }

  public toJSON(): SidechainConfigSnapshot {
    return {
      id: this.id,
      targetTrackId: this.targetTrackId,
      targetProcessorId: this.targetProcessorId,
      sourceTrackId: this._sourceTrackId,
      enabled: this.enabled,
      sidechainFilterEnabled: this._sidechainFilterEnabled,
      sidechainFilterFrequency: this._sidechainFilterFrequency,
    };
  }

  public static fromJSON(data: SidechainConfigSnapshot): SidechainConfig {
    const config = new SidechainConfig(
      data.id,
      data.targetTrackId as TrackId,
      data.targetProcessorId,
    );
    config._sourceTrackId = data.sourceTrackId as TrackId | null;
    config.enabled = data.enabled;
    config._sidechainFilterEnabled = data.sidechainFilterEnabled ?? false;
    config._sidechainFilterFrequency =
      data.sidechainFilterFrequency ?? SIDECHAIN_FILTER_FREQ_DEFAULT;
    return config;
  }
}

/** Minimum HPF cutoff frequency in Hz. */
export const SIDECHAIN_FILTER_FREQ_MIN = 20;

/** Maximum HPF cutoff frequency in Hz. */
export const SIDECHAIN_FILTER_FREQ_MAX = 500;

/** Default HPF cutoff frequency in Hz. */
export const SIDECHAIN_FILTER_FREQ_DEFAULT = 80;

export interface SidechainConfigSnapshot {
  id: string;
  targetTrackId: string;
  targetProcessorId: string;
  sourceTrackId: string | null;
  enabled: boolean;
  sidechainFilterEnabled: boolean;
  sidechainFilterFrequency: number;
}
