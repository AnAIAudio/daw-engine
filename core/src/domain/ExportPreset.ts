import { Signal } from "../lib/Signal";
import { ExportFormat, ExportSampleFormat } from "./ExportConfig";
import { DitherType } from "../utils/DitherProcessor";

/**
 * Serializable snapshot of export configuration for preset storage.
 */
export interface ExportPresetConfig {
  format: ExportFormat;
  sampleFormat: ExportSampleFormat;
  sampleRate: number;
  bitrate?: number;
  quality?: number;
  ditherType: DitherType;
  normalize: boolean;
  normalizeMode: "peak" | "lufs";
  targetPeakDb?: number;
  targetLufs?: number;
  truePeakLimit: boolean;
  truePeakCeiling: number;
  exportMasterOnly: boolean;
  stemExport: boolean;
  splitMono: boolean;
  filenameTemplate: string;
  // Phase 5
  silencePaddingStart: number;
  silencePaddingEnd: number;
  trimSilence: boolean;
  exportCdMarkers: boolean;
  cdMarkerFormat: "cue" | "toc" | "mp4ch";
  bwfMetadata: boolean;
}

/**
 * Export Preset — a saved configuration snapshot for quick recall.
 */
export class ExportPreset {
  public readonly id: string;
  public name: string;
  public readonly builtIn: boolean;
  public config: ExportPresetConfig;

  public readonly changed = new Signal<ExportPreset>();

  constructor(
    id: string,
    name: string,
    config: ExportPresetConfig,
    builtIn: boolean = false,
  ) {
    this.id = id;
    this.name = name;
    this.config = config;
    this.builtIn = builtIn;
  }

  public setName(name: string): void {
    if (this.name !== name) {
      this.name = name;
      this.changed.emit(this);
    }
  }

  public updateConfig(config: Partial<ExportPresetConfig>): void {
    this.config = { ...this.config, ...config };
    this.changed.emit(this);
  }

  public toJSON(): ExportPresetSnapshot {
    return {
      id: this.id,
      name: this.name,
      builtIn: this.builtIn,
      config: { ...this.config },
    };
  }

  public static fromJSON(data: ExportPresetSnapshot): ExportPreset {
    return new ExportPreset(data.id, data.name, data.config, data.builtIn);
  }
}

export interface ExportPresetSnapshot {
  id: string;
  name: string;
  builtIn: boolean;
  config: ExportPresetConfig;
}

/**
 * Default preset configuration values.
 */
export function defaultPresetConfig(): ExportPresetConfig {
  return {
    format: ExportFormat.WAV,
    sampleFormat: ExportSampleFormat.FLOAT32,
    sampleRate: 44100,
    ditherType: DitherType.NONE,
    normalize: false,
    normalizeMode: "peak",
    targetPeakDb: -1,
    targetLufs: -14,
    truePeakLimit: false,
    truePeakCeiling: -1.0,
    exportMasterOnly: true,
    stemExport: false,
    splitMono: false,
    filenameTemplate: "%s",
    silencePaddingStart: 0,
    silencePaddingEnd: 0,
    trimSilence: false,
    exportCdMarkers: false,
    cdMarkerFormat: "cue",
    bwfMetadata: false,
  };
}

/**
 * Built-in presets matching common professional workflows.
 */
export function getBuiltInPresets(): ExportPreset[] {
  return [
    new ExportPreset(
      "builtin-cd-quality",
      "CD Quality (WAV 16-bit 44.1kHz)",
      {
        ...defaultPresetConfig(),
        format: ExportFormat.WAV,
        sampleFormat: ExportSampleFormat.INT16,
        sampleRate: 44100,
        ditherType: DitherType.TPDF,
        filenameTemplate: "%s",
      },
      true,
    ),

    new ExportPreset(
      "builtin-high-quality",
      "High Quality (WAV 24-bit 48kHz)",
      {
        ...defaultPresetConfig(),
        format: ExportFormat.WAV,
        sampleFormat: ExportSampleFormat.INT24,
        sampleRate: 48000,
        filenameTemplate: "%s",
      },
      true,
    ),

    new ExportPreset(
      "builtin-mp3-320",
      "MP3 320kbps",
      {
        ...defaultPresetConfig(),
        format: ExportFormat.MP3,
        sampleRate: 44100,
        bitrate: 320,
        filenameTemplate: "%s",
      },
      true,
    ),

    new ExportPreset(
      "builtin-streaming",
      "Streaming (MP3 192kbps)",
      {
        ...defaultPresetConfig(),
        format: ExportFormat.MP3,
        sampleRate: 44100,
        bitrate: 192,
        normalize: true,
        normalizeMode: "lufs",
        targetLufs: -14,
        truePeakLimit: true,
        truePeakCeiling: -1.0,
        filenameTemplate: "%s",
      },
      true,
    ),

    new ExportPreset(
      "builtin-flac-archive",
      "FLAC Archive (24-bit 96kHz)",
      {
        ...defaultPresetConfig(),
        format: ExportFormat.FLAC,
        sampleFormat: ExportSampleFormat.INT24,
        sampleRate: 96000,
        filenameTemplate: "%s_%d",
      },
      true,
    ),

    new ExportPreset(
      "builtin-ogg-podcast",
      "OGG Vorbis (Podcast)",
      {
        ...defaultPresetConfig(),
        format: ExportFormat.OGG,
        sampleRate: 44100,
        quality: 0.6,
        normalize: true,
        normalizeMode: "lufs",
        targetLufs: -16,
        filenameTemplate: "%s",
      },
      true,
    ),
  ];
}
