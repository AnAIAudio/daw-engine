import { Signal } from "../../lib/Signal";
import {
  ExportFormat,
  ExportSampleFormat,
  NormalizeMode,
} from "../../domain/ExportConfig";
import { DitherType } from "../../utils/DitherProcessor";

import { logger } from "../../utils/Logger";
/**
 * A partial export configuration used in presets.
 * Mirrors the relevant fields from ExportConfig.
 */
export interface ExportPresetConfig {
  format?: ExportFormat;
  sampleFormat?: ExportSampleFormat;
  sampleRate?: number;
  bitrate?: number;
  quality?: number;
  ditherType?: DitherType;
  normalize?: boolean;
  normalizeMode?: NormalizeMode;
  targetPeakDb?: number;
  targetLufs?: number;
  truePeakLimit?: boolean;
  truePeakCeiling?: number;
  exportMasterOnly?: boolean;
  stemExport?: boolean;
  splitMono?: boolean;
  filenameTemplate?: string;
  silencePaddingStart?: number;
  silencePaddingEnd?: number;
  trimSilence?: boolean;
  exportCdMarkers?: boolean;
  cdMarkerFormat?: "cue" | "toc" | "mp4ch";
  bwfMetadata?: boolean;
}

/**
 * A saved export configuration snapshot for quick recall.
 */
export interface ExportPreset {
  id: string;
  name: string;
  version: number;
  config: ExportPresetConfig;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialized form of the preset manager (for persistence).
 */
interface SerializedPresetManager {
  version: number;
  presets: ExportPreset[];
}

/**
 * Manages a collection of export presets, both user-created and built-in.
 */
export class ExportPresetManager {
  private _presets: Map<string, ExportPreset>;

  /** Emitted whenever the preset list or any preset changes. */
  public readonly presetsChanged = new Signal<void>();

  constructor() {
    this._presets = new Map();

    // Seed with default presets
    for (const preset of ExportPresetManager.getDefaultPresets()) {
      this._presets.set(preset.id, preset);
    }
  }

  // ------------------------------------------------------------------ CRUD

  /**
   * Create a new preset from the given config.
   */
  public addPreset(name: string, config: ExportPresetConfig): ExportPreset {
    const now = new Date().toISOString();
    const preset: ExportPreset = {
      id: crypto.randomUUID(),
      name,
      version: 1,
      config: { ...config },
      createdAt: now,
      updatedAt: now,
    };
    this._presets.set(preset.id, preset);
    this.presetsChanged.emit();
    return preset;
  }

  /**
   * Update an existing preset's configuration.
   */
  public updatePreset(id: string, config: ExportPresetConfig): void {
    const existing = this._presets.get(id);
    if (!existing) {
      throw new Error(`Preset not found: ${id}`);
    }
    existing.config = { ...existing.config, ...config };
    existing.version += 1;
    existing.updatedAt = new Date().toISOString();
    this._presets.set(id, existing);
    this.presetsChanged.emit();
  }

  /**
   * Remove a preset by id.
   */
  public removePreset(id: string): void {
    if (!this._presets.has(id)) {
      throw new Error(`Preset not found: ${id}`);
    }
    this._presets.delete(id);
    this.presetsChanged.emit();
  }

  /**
   * Get a single preset by id.
   */
  public getPreset(id: string): ExportPreset | undefined {
    const preset = this._presets.get(id);
    return preset ? { ...preset, config: { ...preset.config } } : undefined;
  }

  /**
   * Get all presets, sorted by name.
   */
  public getAllPresets(): ExportPreset[] {
    return Array.from(this._presets.values())
      .map((p) => ({ ...p, config: { ...p.config } }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // --------------------------------------------------------- default presets

  /**
   * Returns the built-in default presets covering common export workflows.
   */
  static getDefaultPresets(): ExportPreset[] {
    const now = new Date().toISOString();

    return [
      // 1. CD Quality
      {
        id: "preset-cd-quality",
        name: "CD Quality (16-bit/44.1kHz WAV)",
        version: 1,
        config: {
          format: ExportFormat.WAV,
          sampleFormat: ExportSampleFormat.INT16,
          sampleRate: 44100,
          ditherType: DitherType.TPDF,
          normalize: false,
          truePeakLimit: false,
          exportMasterOnly: true,
          stemExport: false,
          splitMono: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 2. Hi-Res Audio
      {
        id: "preset-hi-res",
        name: "Hi-Res Audio (24-bit/96kHz WAV)",
        version: 1,
        config: {
          format: ExportFormat.WAV,
          sampleFormat: ExportSampleFormat.INT24,
          sampleRate: 96000,
          ditherType: DitherType.NONE,
          normalize: false,
          truePeakLimit: false,
          exportMasterOnly: true,
          stemExport: false,
          splitMono: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 3. MP3 320k (high quality lossy)
      {
        id: "preset-mp3-320k",
        name: "MP3 320kbps",
        version: 1,
        config: {
          format: ExportFormat.MP3,
          sampleRate: 44100,
          bitrate: 320,
          normalize: false,
          truePeakLimit: false,
          exportMasterOnly: true,
          stemExport: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 4. Streaming (LUFS-normalized for Spotify/Apple Music)
      {
        id: "preset-streaming",
        name: "Streaming (MP3 192k, -14 LUFS)",
        version: 1,
        config: {
          format: ExportFormat.MP3,
          sampleRate: 44100,
          bitrate: 192,
          normalize: true,
          normalizeMode: "lufs",
          targetLufs: -14,
          truePeakLimit: true,
          truePeakCeiling: -1.0,
          exportMasterOnly: true,
          stemExport: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 5. Podcast (OGG, loudness-normalized)
      {
        id: "preset-podcast",
        name: "Podcast (OGG Vorbis, -16 LUFS)",
        version: 1,
        config: {
          format: ExportFormat.OGG,
          sampleRate: 44100,
          quality: 0.6,
          normalize: true,
          normalizeMode: "lufs",
          targetLufs: -16,
          truePeakLimit: true,
          truePeakCeiling: -1.0,
          exportMasterOnly: true,
          stemExport: false,
          trimSilence: true,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 6. FLAC Lossless Archive
      {
        id: "preset-flac-archive",
        name: "FLAC Lossless Archive (24-bit/48kHz)",
        version: 1,
        config: {
          format: ExportFormat.FLAC,
          sampleFormat: ExportSampleFormat.INT24,
          sampleRate: 48000,
          ditherType: DitherType.NONE,
          normalize: false,
          truePeakLimit: false,
          exportMasterOnly: true,
          stemExport: false,
          splitMono: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 7. Broadcast WAV (BWF)
      {
        id: "preset-broadcast-wav",
        name: "Broadcast WAV (24-bit/48kHz, BWF)",
        version: 1,
        config: {
          format: ExportFormat.WAV,
          sampleFormat: ExportSampleFormat.INT24,
          sampleRate: 48000,
          ditherType: DitherType.NONE,
          normalize: true,
          normalizeMode: "lufs",
          targetLufs: -23,
          truePeakLimit: true,
          truePeakCeiling: -1.0,
          exportMasterOnly: true,
          stemExport: false,
          splitMono: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: true,
        },
        createdAt: now,
        updatedAt: now,
      },

      // 8. Stem Export (for collaboration / remix)
      {
        id: "preset-stems",
        name: "Stems Export (24-bit/48kHz WAV)",
        version: 1,
        config: {
          format: ExportFormat.WAV,
          sampleFormat: ExportSampleFormat.INT24,
          sampleRate: 48000,
          ditherType: DitherType.NONE,
          normalize: false,
          truePeakLimit: false,
          exportMasterOnly: false,
          stemExport: true,
          splitMono: false,
          trimSilence: false,
          exportCdMarkers: false,
          bwfMetadata: false,
        },
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  // --------------------------------------------------------- serialization

  /**
   * Serialize the preset manager to a JSON string for persistence.
   */
  public serialize(): string {
    const data: SerializedPresetManager = {
      version: 1,
      presets: Array.from(this._presets.values()),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Deserialize from a JSON string and return a new ExportPresetManager.
   * User presets from the JSON are merged on top of the defaults.
   */
  static deserialize(json: string): ExportPresetManager {
    const manager = new ExportPresetManager();

    try {
      const data: SerializedPresetManager = JSON.parse(json);
      if (data && Array.isArray(data.presets)) {
        for (const preset of data.presets) {
          // Validate minimal shape
          if (preset.id && preset.name && preset.config) {
            manager._presets.set(preset.id, {
              id: preset.id,
              name: preset.name,
              version: preset.version ?? 1,
              config: { ...preset.config },
              createdAt: preset.createdAt ?? new Date().toISOString(),
              updatedAt: preset.updatedAt ?? new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      logger.warn(
        "ExportPresetManager",
        "Failed to parse serialized presets, using defaults",
      );
    }

    return manager;
  }
}
