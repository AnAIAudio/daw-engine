import { Signal } from "../lib/Signal";
import { FrameCount } from "./types";

/**
 * Export Status
 */
export enum ExportProgress {
  IDLE = "idle",
  RENDERING = "rendering",
  NORMALIZING = "normalizing",
  ENCODING = "encoding",
  COMPLETED = "completed",
  FAILED = "failed",
  ABORTED = "aborted",
}

export class ExportStatus {
  // Status
  private _progress: ExportProgress = ExportProgress.IDLE;
  private _running: boolean = false;
  private _aborted: boolean = false;
  private _errors: boolean = false;
  private _errorMessage: string = "";

  // Progress Info
  public totalFrames: FrameCount = 0;
  public processedFrames: FrameCount = 0;
  public currentFilename: string = "";

  // Result
  public resultBlob?: Blob;
  public resultUrl?: string;

  // Signals
  public readonly progressChanged = new Signal<ExportProgress>();
  public readonly frameProcessed = new Signal<FrameCount>();
  public readonly finished = new Signal<boolean>(); // success: true/false
  public readonly errorOccurred = new Signal<string>();

  constructor() {}

  public get progress(): ExportProgress {
    return this._progress;
  }

  public get running(): boolean {
    return this._running;
  }

  public get aborted(): boolean {
    return this._aborted;
  }

  public get errors(): boolean {
    return this._errors;
  }

  public get errorMessage(): string {
    return this._errorMessage;
  }

  public get percentComplete(): number {
    if (this.totalFrames === 0) return 0;
    return (this.processedFrames / this.totalFrames) * 100;
  }

  public init(totalFrames: FrameCount, filename: string) {
    this._progress = ExportProgress.RENDERING;
    this._running = true;
    this._aborted = false;
    this._errors = false;
    this._errorMessage = "";
    this.totalFrames = totalFrames;
    this.processedFrames = 0;
    this.currentFilename = filename;
    this.resultBlob = undefined;
    this.resultUrl = undefined;
    this.progressChanged.emit(this._progress);
  }

  public setProgress(progress: ExportProgress) {
    if (this._progress !== progress) {
      this._progress = progress;
      this.progressChanged.emit(progress);
    }
  }

  public updateProcessedFrames(frames: FrameCount) {
    this.processedFrames = frames;
    this.frameProcessed.emit(frames);
  }

  public abort(errorOccurred: boolean = false) {
    this._aborted = true;
    this._running = false;
    if (errorOccurred) {
      this._errors = true;
    }
    this._progress = ExportProgress.ABORTED;
    this.progressChanged.emit(this._progress);
    this.finished.emit(false);
  }

  public setError(message: string) {
    this._errors = true;
    this._errorMessage = message;
    this._progress = ExportProgress.FAILED;
    this._running = false;
    this.progressChanged.emit(this._progress);
    this.errorOccurred.emit(message);
    this.finished.emit(false);
  }

  public complete(blob: Blob, url: string) {
    this._progress = ExportProgress.COMPLETED;
    this._running = false;
    this.resultBlob = blob;
    this.resultUrl = url;
    this.processedFrames = this.totalFrames;
    this.progressChanged.emit(this._progress);
    this.finished.emit(true);
  }

  public cleanup() {
    if (this.resultUrl) {
      URL.revokeObjectURL(this.resultUrl);
      this.resultUrl = undefined;
    }
    this.resultBlob = undefined;
  }
}
