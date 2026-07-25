import { FrameCount, RangeId } from "./types";
import { Signal } from "../lib/Signal";
import { DitherType } from "../utils/DitherProcessor";

export enum ExportFormat {
  WAV = "wav",
  MP3 = "mp3",
  OGG = "ogg",
  FLAC = "flac",
  MIDI = "midi",
}

export enum ExportSampleFormat {
  INT16 = "int16",
  INT24 = "int24",
  FLOAT32 = "float32",
}

export type NormalizeMode = "peak" | "lufs";

/**
 * Timespan for batch export
 */
export interface ExportTimespan {
  name: string;
  startFrame: FrameCount;
  endFrame: FrameCount;
}

/**
 * BWF (Broadcast WAV) metadata
 * EBU Tech 3285 — Broadcast Wave Format specification
 */
export interface BwfMetadata {
  description?: string; // BWF description (max 256 chars)
  originator?: string; // Originator name
  originatorReference?: string; // Originator reference
  originationDate?: string; // YYYY-MM-DD
  originationTime?: string; // HH:MM:SS
  timeReference?: number; // Sample count since midnight
  codingHistory?: string; // Coding history text (e.g. "A=PCM,F=48000,W=24,M=stereo")
}

/**
 * @deprecated Use BwfMetadata (fields are now optional). Kept for backward compat.
 */
export type BWFMetadata = BwfMetadata;

/**
 * Export Configuration
 */
export class ExportConfig {
  public readonly id: string;

  // Format Settings
  public format: ExportFormat = ExportFormat.WAV;
  public sampleFormat: ExportSampleFormat = ExportSampleFormat.FLOAT32;
  public sampleRate: number = 44100;
  public bitrate?: number; // MP3 only
  public quality?: number; // OGG quality 0.0~1.0

  // Range Settings
  public rangeId?: RangeId; // If set, use named range
  public startFrame: FrameCount = 0;
  public endFrame: FrameCount = 0;

  // File Settings
  public filename: string = "export";
  public folder: string = "";
  public filenameTemplate: string = "%s"; // Phase 1: template with tokens

  // Preset reference
  public presetId?: string;

  // Channel Settings
  public exportMasterOnly: boolean = true;
  public trackIds: string[] = []; // If not master only, specific track IDs

  // Stem Export
  public stemExport: boolean = false;

  // Split Mono (Phase 5B)
  public splitMono: boolean = false;

  // Dithering
  public ditherType: DitherType = DitherType.NONE;

  // Normalize
  public normalize: boolean = false;
  public normalizeMode: NormalizeMode = "peak";
  public targetPeakDb?: number;
  public targetLufs: number = -14; // Phase 2A

  // True Peak Limiter (Phase 2B)
  public truePeakLimit: boolean = false;
  public truePeakCeiling: number = -1.0; // dBTP

  // Multi-Timespan (Phase 5A)
  public timespans: ExportTimespan[] = [];

  // Silence Padding (Phase 5C)
  public silencePaddingStart: number = 0; // frames
  public silencePaddingEnd: number = 0; // frames
  public trimSilence: boolean = false;

  // CD Markers (Phase 5D)
  public exportCdMarkers: boolean = false;
  public cdMarkerFormat: "cue" | "toc" | "mp4ch" = "cue";

  // BWF Metadata (Phase 5E)
  public bwfMetadata: boolean = false;
  public bwfData?: BwfMetadata;

  // Post-Export (Phase 6)
  public reimportAfterExport: boolean = false;

  // Signals
  public readonly changed = new Signal<void>();

  constructor(id?: string) {
    this.id = id || crypto.randomUUID();
  }

  public setFormat(format: ExportFormat) {
    this.format = format;
    this.changed.emit();
  }

  public setSampleFormat(sampleFormat: ExportSampleFormat) {
    this.sampleFormat = sampleFormat;
    this.changed.emit();
  }

  public setRange(startFrame: FrameCount, endFrame: FrameCount) {
    this.rangeId = undefined; // Clear range if manually setting frames
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.changed.emit();
  }

  public setRangeById(rangeId: RangeId) {
    this.rangeId = rangeId;
    this.changed.emit();
  }

  public setFilename(filename: string) {
    this.filename = filename;
    this.changed.emit();
  }

  public setFolder(folder: string) {
    this.folder = folder;
    this.changed.emit();
  }

  public setFilenameTemplate(template: string) {
    this.filenameTemplate = template;
    this.changed.emit();
  }

  public setNormalize(normalize: boolean, targetPeakDb?: number) {
    this.normalize = normalize;
    this.targetPeakDb = targetPeakDb;
    this.changed.emit();
  }

  public setNormalizeMode(mode: NormalizeMode) {
    this.normalizeMode = mode;
    this.changed.emit();
  }

  public setTargetLufs(lufs: number) {
    this.targetLufs = lufs;
    this.changed.emit();
  }

  public setTruePeakLimit(enabled: boolean, ceiling?: number) {
    this.truePeakLimit = enabled;
    if (ceiling !== undefined) this.truePeakCeiling = ceiling;
    this.changed.emit();
  }

  public setStemExport(stemExport: boolean) {
    this.stemExport = stemExport;
    this.changed.emit();
  }

  public setSplitMono(splitMono: boolean) {
    this.splitMono = splitMono;
    this.changed.emit();
  }

  public setQuality(quality: number) {
    this.quality = Math.max(0, Math.min(1, quality));
    this.changed.emit();
  }

  public setDitherType(ditherType: DitherType) {
    this.ditherType = ditherType;
    this.changed.emit();
  }

  public setExportMasterOnly(masterOnly: boolean) {
    this.exportMasterOnly = masterOnly;
    this.changed.emit();
  }

  public setTrackIds(trackIds: string[]) {
    this.trackIds = trackIds;
    this.changed.emit();
  }

  public setTimespans(timespans: ExportTimespan[]) {
    this.timespans = timespans;
    this.changed.emit();
  }

  public setSilencePadding(startFrames: number, endFrames: number) {
    this.silencePaddingStart = startFrames;
    this.silencePaddingEnd = endFrames;
    this.changed.emit();
  }

  public setTrimSilence(trim: boolean) {
    this.trimSilence = trim;
    this.changed.emit();
  }

  public setCdMarkerExport(enabled: boolean, format?: "cue" | "toc" | "mp4ch") {
    this.exportCdMarkers = enabled;
    if (format) this.cdMarkerFormat = format;
    this.changed.emit();
  }

  public setBwfMetadata(enabled: boolean, data?: BwfMetadata) {
    this.bwfMetadata = enabled;
    if (data) this.bwfData = data;
    this.changed.emit();
  }

  public setPresetId(presetId: string | undefined) {
    this.presetId = presetId;
    this.changed.emit();
  }

  public validate(): boolean {
    if (this.endFrame <= this.startFrame) return false;
    if (!this.filename) return false;
    if (this.sampleRate <= 0) return false;
    if (
      this.format === ExportFormat.OGG &&
      this.quality !== undefined &&
      (this.quality < 0 || this.quality > 1)
    )
      return false;
    return true;
  }

  public getDuration(): FrameCount {
    return this.endFrame - this.startFrame;
  }

  public getFullPath(): string {
    const ext = this.format;
    const folder = this.folder || "exports";
    return `${folder}/${this.filename}.${ext}`;
  }

  /**
   * Serialize to JSON for preset storage.
   */
  public toJSON(): ExportConfigSnapshot {
    return {
      id: this.id,
      format: this.format,
      sampleFormat: this.sampleFormat,
      sampleRate: this.sampleRate,
      bitrate: this.bitrate,
      quality: this.quality,
      rangeId: this.rangeId,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      filename: this.filename,
      folder: this.folder,
      filenameTemplate: this.filenameTemplate,
      presetId: this.presetId,
      exportMasterOnly: this.exportMasterOnly,
      trackIds: [...this.trackIds],
      stemExport: this.stemExport,
      splitMono: this.splitMono,
      ditherType: this.ditherType,
      normalize: this.normalize,
      normalizeMode: this.normalizeMode,
      targetPeakDb: this.targetPeakDb,
      targetLufs: this.targetLufs,
      truePeakLimit: this.truePeakLimit,
      truePeakCeiling: this.truePeakCeiling,
      timespans: this.timespans.map((ts) => ({ ...ts })),
      silencePaddingStart: this.silencePaddingStart,
      silencePaddingEnd: this.silencePaddingEnd,
      trimSilence: this.trimSilence,
      exportCdMarkers: this.exportCdMarkers,
      cdMarkerFormat: this.cdMarkerFormat,
      bwfMetadata: this.bwfMetadata,
      bwfData: this.bwfData ? { ...this.bwfData } : undefined,
      reimportAfterExport: this.reimportAfterExport,
    };
  }

  /**
   * Restore from JSON snapshot.
   */
  public static fromJSON(data: ExportConfigSnapshot): ExportConfig {
    const config = new ExportConfig(data.id);
    config.format = data.format;
    config.sampleFormat = data.sampleFormat;
    config.sampleRate = data.sampleRate;
    config.bitrate = data.bitrate;
    config.quality = data.quality;
    config.rangeId = data.rangeId;
    config.startFrame = data.startFrame;
    config.endFrame = data.endFrame;
    config.filename = data.filename;
    config.folder = data.folder ?? "";
    config.filenameTemplate = data.filenameTemplate ?? "%s";
    config.presetId = data.presetId;
    config.exportMasterOnly = data.exportMasterOnly;
    config.trackIds = data.trackIds ? [...data.trackIds] : [];
    config.stemExport = data.stemExport;
    config.splitMono = data.splitMono ?? false;
    config.ditherType = data.ditherType;
    config.normalize = data.normalize;
    config.normalizeMode = data.normalizeMode ?? "peak";
    config.targetPeakDb = data.targetPeakDb;
    config.targetLufs = data.targetLufs ?? -14;
    config.truePeakLimit = data.truePeakLimit ?? false;
    config.truePeakCeiling = data.truePeakCeiling ?? -1.0;
    config.timespans = data.timespans
      ? data.timespans.map((ts) => ({ ...ts }))
      : [];
    config.silencePaddingStart = data.silencePaddingStart ?? 0;
    config.silencePaddingEnd = data.silencePaddingEnd ?? 0;
    config.trimSilence = data.trimSilence ?? false;
    config.exportCdMarkers = data.exportCdMarkers ?? false;
    config.cdMarkerFormat = data.cdMarkerFormat ?? "cue";
    config.bwfMetadata = data.bwfMetadata ?? false;
    config.bwfData = data.bwfData ? { ...data.bwfData } : undefined;
    config.reimportAfterExport = data.reimportAfterExport ?? false;
    return config;
  }
}

export interface ExportConfigSnapshot {
  id: string;
  format: ExportFormat;
  sampleFormat: ExportSampleFormat;
  sampleRate: number;
  bitrate?: number;
  quality?: number;
  rangeId?: string;
  startFrame: number;
  endFrame: number;
  filename: string;
  folder?: string;
  filenameTemplate?: string;
  presetId?: string;
  exportMasterOnly: boolean;
  trackIds: string[];
  stemExport: boolean;
  splitMono?: boolean;
  ditherType: DitherType;
  normalize: boolean;
  normalizeMode?: NormalizeMode;
  targetPeakDb?: number;
  targetLufs?: number;
  truePeakLimit?: boolean;
  truePeakCeiling?: number;
  timespans?: ExportTimespan[];
  silencePaddingStart?: number;
  silencePaddingEnd?: number;
  trimSilence?: boolean;
  exportCdMarkers?: boolean;
  cdMarkerFormat?: "cue" | "toc" | "mp4ch";
  bwfMetadata?: boolean;
  bwfData?: BwfMetadata;
  reimportAfterExport?: boolean;
}
