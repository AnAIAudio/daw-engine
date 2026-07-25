import { Signal } from "../lib/Signal";

/**
 * Import Status — mirrors ExportStatus for import operations.
 * Tracks progress of multi-file import operations.
 */
export enum ImportProgress {
  IDLE = "idle",
  LOADING = "loading",
  DECODING = "decoding",
  RESAMPLING = "resampling",
  SPLITTING = "splitting",
  COMPLETE = "complete",
  FAILED = "failed",
}

export class ImportStatus {
  private _progress: ImportProgress = ImportProgress.IDLE;
  private _running: boolean = false;

  public totalFiles: number = 0;
  public completedFiles: number = 0;
  public currentFilename: string = "";
  public errorMessage: string = "";

  // Signals
  public readonly progressChanged = new Signal<ImportProgress>();
  public readonly fileCompleted = new Signal<{
    index: number;
    filename: string;
  }>();
  public readonly finished = new Signal<boolean>();
  public readonly errorOccurred = new Signal<string>();

  public get progress(): ImportProgress {
    return this._progress;
  }

  public get running(): boolean {
    return this._running;
  }

  public get percentComplete(): number {
    if (this.totalFiles === 0) return 0;
    return (this.completedFiles / this.totalFiles) * 100;
  }

  public init(totalFiles: number) {
    this._progress = ImportProgress.LOADING;
    this._running = true;
    this.totalFiles = totalFiles;
    this.completedFiles = 0;
    this.currentFilename = "";
    this.errorMessage = "";
    this.progressChanged.emit(this._progress);
  }

  public setProgress(progress: ImportProgress) {
    if (this._progress !== progress) {
      this._progress = progress;
      this.progressChanged.emit(progress);
    }
  }

  public setCurrentFile(filename: string) {
    this.currentFilename = filename;
  }

  public completeFile(filename: string) {
    this.completedFiles++;
    this.fileCompleted.emit({ index: this.completedFiles, filename });
  }

  public complete() {
    this._progress = ImportProgress.COMPLETE;
    this._running = false;
    this.progressChanged.emit(this._progress);
    this.finished.emit(true);
  }

  public setError(message: string) {
    this._progress = ImportProgress.FAILED;
    this._running = false;
    this.errorMessage = message;
    this.progressChanged.emit(this._progress);
    this.errorOccurred.emit(message);
    this.finished.emit(false);
  }

  public reset() {
    this._progress = ImportProgress.IDLE;
    this._running = false;
    this.totalFiles = 0;
    this.completedFiles = 0;
    this.currentFilename = "";
    this.errorMessage = "";
  }
}
