import { Signal } from "../lib/Signal";
import { ExportStatus, ExportProgress } from "./ExportStatus";

/**
 * Video Export Progress Stages
 * Extends base export progress with video-specific stages
 */
export enum VideoExportStage {
  IDLE = "idle",
  RENDERING_AUDIO = "rendering_audio",
  RENDERING_VIDEO = "rendering_video",
  MUXING = "muxing",
  COMPLETED = "completed",
  FAILED = "failed",
  ABORTED = "aborted",
}

/**
 * Video Export Status
 * Extends ExportStatus to track multi-phase video export:
 * - Phase 1: Audio rendering (40%)
 * - Phase 2: Video frame rendering (40%)
 * - Phase 3: FFmpeg muxing (20%)
 */
export class VideoExportStatus extends ExportStatus {
  // Video-specific progress tracking
  public totalFrames: number = 0; // Total video frames to render
  public processedFrames: number = 0; // Video frames processed
  public ffmpegProgress: number = 0; // FFmpeg muxing progress (0-100)

  // Phase-specific progress
  private audioProgress: number = 0; // 0-100
  private videoProgress: number = 0; // 0-100
  private muxingProgress: number = 0; // 0-100

  // Current stage
  private _currentStage: VideoExportStage = VideoExportStage.IDLE;

  // Video-specific signals
  public readonly videoFrameProcessed = new Signal<number>();
  public readonly ffmpegProgressChanged = new Signal<number>();
  public readonly stageChanged = new Signal<VideoExportStage>();

  constructor() {
    super();
  }

  /**
   * Get current video export stage
   */
  public get currentStage(): VideoExportStage {
    return this._currentStage;
  }

  /**
   * Get overall progress (weighted across all phases)
   * Audio: 40%, Video: 40%, Muxing: 20%
   */
  public get overallProgress(): number {
    return (
      this.audioProgress * 0.4 +
      this.videoProgress * 0.4 +
      this.muxingProgress * 0.2
    );
  }

  /**
   * Initialize video export
   */
  public initVideoExport(
    totalAudioFrames: number,
    totalVideoFrames: number,
    filename: string,
  ): void {
    // Initialize base export status
    this.init(totalAudioFrames, filename);

    // Initialize video-specific fields
    this.totalFrames = totalVideoFrames;
    this.processedFrames = 0;
    this.ffmpegProgress = 0;
    this.audioProgress = 0;
    this.videoProgress = 0;
    this.muxingProgress = 0;

    this._currentStage = VideoExportStage.RENDERING_AUDIO;
    this.stageChanged.emit(this._currentStage);
  }

  /**
   * Update audio rendering progress
   */
  public updateAudioProgress(
    processedAudioFrames: number,
    totalAudioFrames: number,
  ): void {
    this.processedFrames = processedAudioFrames;
    this.audioProgress =
      totalAudioFrames > 0
        ? Math.min(100, (processedAudioFrames / totalAudioFrames) * 100)
        : 0;

    this.frameProcessed.emit(processedAudioFrames);
  }

  /**
   * Start video frame rendering phase
   */
  public startVideoRendering(): void {
    this._currentStage = VideoExportStage.RENDERING_VIDEO;
    this.audioProgress = 100; // Audio is complete
    this.setProgress(ExportProgress.RENDERING);
    this.stageChanged.emit(this._currentStage);
  }

  /**
   * Update video frame rendering progress
   */
  public updateVideoFrameProgress(processedFrames: number): void {
    this.processedFrames = processedFrames;
    this.videoProgress =
      this.totalFrames > 0
        ? Math.min(100, (processedFrames / this.totalFrames) * 100)
        : 0;

    this.videoFrameProcessed.emit(processedFrames);
  }

  /**
   * Start FFmpeg muxing phase
   */
  public startMuxing(): void {
    this._currentStage = VideoExportStage.MUXING;
    this.videoProgress = 100; // Video rendering is complete
    this.setProgress(ExportProgress.ENCODING);
    this.stageChanged.emit(this._currentStage);
  }

  /**
   * Update FFmpeg muxing progress
   */
  public updateFFmpegProgress(progress: number): void {
    this.ffmpegProgress = Math.min(100, Math.max(0, progress));
    this.muxingProgress = this.ffmpegProgress;
    this.ffmpegProgressChanged.emit(this.ffmpegProgress);
  }

  /**
   * Complete video export
   */
  public completeVideoExport(blob: Blob, url: string): void {
    this._currentStage = VideoExportStage.COMPLETED;
    this.audioProgress = 100;
    this.videoProgress = 100;
    this.muxingProgress = 100;
    this.ffmpegProgress = 100;

    this.complete(blob, url);
    this.stageChanged.emit(this._currentStage);
  }

  /**
   * Fail video export with error
   */
  public failVideoExport(message: string): void {
    this._currentStage = VideoExportStage.FAILED;
    this.setError(message);
    this.stageChanged.emit(this._currentStage);
  }

  /**
   * Abort video export
   */
  public abortVideoExport(errorOccurred: boolean = false): void {
    this._currentStage = VideoExportStage.ABORTED;
    this.abort(errorOccurred);
    this.stageChanged.emit(this._currentStage);
  }

  /**
   * Get stage display name
   */
  public getStageName(): string {
    switch (this._currentStage) {
      case VideoExportStage.IDLE:
        return "Idle";
      case VideoExportStage.RENDERING_AUDIO:
        return "Rendering Audio";
      case VideoExportStage.RENDERING_VIDEO:
        return "Rendering Video Frames";
      case VideoExportStage.MUXING:
        return "Muxing Audio & Video";
      case VideoExportStage.COMPLETED:
        return "Completed";
      case VideoExportStage.FAILED:
        return "Failed";
      case VideoExportStage.ABORTED:
        return "Aborted";
      default:
        return "Processing";
    }
  }

  /**
   * Get progress message for current stage
   */
  public getProgressMessage(): string {
    switch (this._currentStage) {
      case VideoExportStage.RENDERING_AUDIO:
        return `Rendering audio... ${Math.round(this.audioProgress)}%`;
      case VideoExportStage.RENDERING_VIDEO:
        return `Rendering video frames (${this.processedFrames}/${this.totalFrames})... ${Math.round(this.videoProgress)}%`;
      case VideoExportStage.MUXING:
        return `Encoding video with FFmpeg... ${Math.round(this.muxingProgress)}%`;
      case VideoExportStage.COMPLETED:
        return "Export completed successfully";
      case VideoExportStage.FAILED:
        return `Export failed: ${this.errorMessage}`;
      case VideoExportStage.ABORTED:
        return "Export was aborted";
      default:
        return "Processing...";
    }
  }
}
