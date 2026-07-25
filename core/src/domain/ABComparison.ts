import { Signal } from "../lib/Signal";

/**
 * A/B Comparison for Export Preview
 *
 * Allows comparing original mix (A) with the processed/normalized export (B).
 */
export enum ABMode {
  A = "A", // Original mix
  B = "B", // Processed export
}

export class ABComparison {
  private _mode: ABMode = ABMode.A;
  private _originalBlob: Blob | null = null;
  private _processedBlob: Blob | null = null;
  private _originalUrl: string | null = null;
  private _processedUrl: string | null = null;

  public readonly modeChanged = new Signal<ABMode>();

  public get mode(): ABMode {
    return this._mode;
  }

  public setMode(mode: ABMode): void {
    if (this._mode !== mode) {
      this._mode = mode;
      this.modeChanged.emit(mode);
    }
  }

  public toggle(): void {
    this.setMode(this._mode === ABMode.A ? ABMode.B : ABMode.A);
  }

  public setOriginal(blob: Blob): void {
    this.cleanupOriginal();
    this._originalBlob = blob;
    this._originalUrl = URL.createObjectURL(blob);
  }

  public setProcessed(blob: Blob): void {
    this.cleanupProcessed();
    this._processedBlob = blob;
    this._processedUrl = URL.createObjectURL(blob);
  }

  public get currentUrl(): string | null {
    return this._mode === ABMode.A ? this._originalUrl : this._processedUrl;
  }

  public get currentBlob(): Blob | null {
    return this._mode === ABMode.A ? this._originalBlob : this._processedBlob;
  }

  public get hasOriginal(): boolean {
    return this._originalBlob !== null;
  }

  public get hasProcessed(): boolean {
    return this._processedBlob !== null;
  }

  public get isReady(): boolean {
    return this.hasOriginal && this.hasProcessed;
  }

  public cleanup(): void {
    this.cleanupOriginal();
    this.cleanupProcessed();
  }

  private cleanupOriginal(): void {
    if (this._originalUrl) {
      URL.revokeObjectURL(this._originalUrl);
      this._originalUrl = null;
    }
    this._originalBlob = null;
  }

  private cleanupProcessed(): void {
    if (this._processedUrl) {
      URL.revokeObjectURL(this._processedUrl);
      this._processedUrl = null;
    }
    this._processedBlob = null;
  }
}
