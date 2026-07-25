import { ExportConfig, ExportFormat } from "./ExportConfig";

/**
 * Video codec options
 */
export enum VideoCodec {
  H264 = "h264",
  H265 = "h265",
  VP8 = "vp8",
  VP9 = "vp9",
}

/**
 * Video export presets for common platforms
 */
export enum VideoPreset {
  YOUTUBE_1080P = "youtube_1080p",
  YOUTUBE_4K = "youtube_4k",
  VIMEO_HD = "vimeo_hd",
  TWITTER = "twitter",
  INSTAGRAM = "instagram",
  CUSTOM = "custom",
}

/**
 * Video visualization types
 */
export enum VideoVisualizationType {
  WAVEFORM = "waveform",
  SPECTROGRAM = "spectrogram",
  NONE = "none",
}

/**
 * Video export configuration extending base audio export
 */
export class VideoExportConfig extends ExportConfig {
  // Video Enable
  public videoEnabled: boolean = false;

  // Video Codec Settings
  public videoCodec: VideoCodec = VideoCodec.H264;
  public videoPreset: VideoPreset = VideoPreset.YOUTUBE_1080P;

  // Resolution Settings
  public videoWidth: number = 1920;
  public videoHeight: number = 1080;
  public videoFps: number = 30;

  // Video Bitrate (optional, uses preset default if not set)
  public videoBitrate?: number;

  // Visualization Settings
  public visualizationType: VideoVisualizationType =
    VideoVisualizationType.WAVEFORM;
  public backgroundColor: string = "#000000";
  public foregroundColor: string = "#00ffcc";

  // Overlay Settings
  public showTimecode: boolean = true;
  public showMetadata: boolean = false;

  // Custom Metadata Text
  public metadataText?: string;

  /**
   * Set video enabled state
   */
  public setVideoEnabled(enabled: boolean): void {
    this.videoEnabled = enabled;
    // Update format to MP4 when video is enabled
    if (enabled && this.format !== ExportFormat.WAV) {
      this.format = ExportFormat.WAV; // We'll mux to video separately
    }
    this.changed.emit();
  }

  /**
   * Set video codec
   */
  public setVideoCodec(codec: VideoCodec): void {
    this.videoCodec = codec;
    this.changed.emit();
  }

  /**
   * Set video preset and apply preset settings
   */
  public setVideoPreset(preset: VideoPreset): void {
    this.videoPreset = preset;
    this.applyPreset(preset);
    this.changed.emit();
  }

  /**
   * Set video resolution
   */
  public setVideoResolution(width: number, height: number): void {
    this.videoWidth = width;
    this.videoHeight = height;
    this.changed.emit();
  }

  /**
   * Set video FPS
   */
  public setVideoFps(fps: number): void {
    this.videoFps = fps;
    this.changed.emit();
  }

  /**
   * Set video bitrate (in kbps)
   */
  public setVideoBitrate(bitrate: number): void {
    this.videoBitrate = bitrate;
    this.changed.emit();
  }

  /**
   * Set visualization type
   */
  public setVisualizationType(type: VideoVisualizationType): void {
    this.visualizationType = type;
    this.changed.emit();
  }

  /**
   * Set background color (hex string)
   */
  public setBackgroundColor(color: string): void {
    this.backgroundColor = color;
    this.changed.emit();
  }

  /**
   * Set foreground color (hex string)
   */
  public setForegroundColor(color: string): void {
    this.foregroundColor = color;
    this.changed.emit();
  }

  /**
   * Set timecode overlay visibility
   */
  public setShowTimecode(show: boolean): void {
    this.showTimecode = show;
    this.changed.emit();
  }

  /**
   * Set metadata overlay visibility
   */
  public setShowMetadata(show: boolean): void {
    this.showMetadata = show;
    this.changed.emit();
  }

  /**
   * Set custom metadata text
   */
  public setMetadataText(text: string): void {
    this.metadataText = text;
    this.changed.emit();
  }

  /**
   * Apply platform-specific preset settings
   */
  private applyPreset(preset: VideoPreset): void {
    switch (preset) {
      case VideoPreset.YOUTUBE_1080P:
        this.videoWidth = 1920;
        this.videoHeight = 1080;
        this.videoFps = 30;
        this.videoBitrate = 8000; // 8 Mbps
        this.videoCodec = VideoCodec.H264;
        break;

      case VideoPreset.YOUTUBE_4K:
        this.videoWidth = 3840;
        this.videoHeight = 2160;
        this.videoFps = 60;
        this.videoBitrate = 45000; // 45 Mbps
        this.videoCodec = VideoCodec.H265;
        break;

      case VideoPreset.VIMEO_HD:
        this.videoWidth = 1920;
        this.videoHeight = 1080;
        this.videoFps = 30;
        this.videoBitrate = 10000; // 10 Mbps
        this.videoCodec = VideoCodec.H264;
        break;

      case VideoPreset.TWITTER:
        this.videoWidth = 1280;
        this.videoHeight = 720;
        this.videoFps = 30;
        this.videoBitrate = 5000; // 5 Mbps
        this.videoCodec = VideoCodec.H264;
        break;

      case VideoPreset.INSTAGRAM:
        this.videoWidth = 1080;
        this.videoHeight = 1080;
        this.videoFps = 30;
        this.videoBitrate = 5000; // 5 Mbps
        this.videoCodec = VideoCodec.H264;
        break;

      case VideoPreset.CUSTOM:
        // Keep current settings
        break;
    }
  }

  /**
   * Get video file extension based on codec
   */
  public getVideoFileExtension(): string {
    switch (this.videoCodec) {
      case VideoCodec.H264:
      case VideoCodec.H265:
        return "mp4";
      case VideoCodec.VP8:
      case VideoCodec.VP9:
        return "webm";
      default:
        return "mp4";
    }
  }

  /**
   * Get full video file path
   */
  public getVideoFullPath(): string {
    const ext = this.getVideoFileExtension();
    const folder = this.folder || "exports";
    return `${folder}/${this.filename}.${ext}`;
  }

  /**
   * Validate video export configuration
   */
  public override validate(): boolean {
    // First validate base audio settings
    if (!super.validate()) {
      return false;
    }

    // If video is disabled, base validation is sufficient
    if (!this.videoEnabled) {
      return true;
    }

    // Validate video-specific settings
    if (this.videoWidth <= 0 || this.videoHeight <= 0) return false;
    if (this.videoFps <= 0 || this.videoFps > 120) return false;
    if (this.videoBitrate !== undefined && this.videoBitrate <= 0) return false;

    return true;
  }

  /**
   * Get total frame count for video
   */
  public getVideoFrameCount(): number {
    const duration = this.getDuration() / this.sampleRate; // Duration in seconds
    return Math.ceil(duration * this.videoFps);
  }
}
