/**
 * Transport Mode
 */
export enum TransportMode {
  NORMAL = "normal",
  SCRUB = "scrub",
  SHUTTLE = "shuttle",
}

/**
 * Scrub State - tracks the current scrub position and speed.
 */
export class ScrubState {
  public mode: TransportMode = TransportMode.NORMAL;
  public shuttleSpeed: number = 1.0; // -4.0 to 4.0 (negative = reverse)
  public scrubPosition: number = 0; // in seconds

  public setScrubMode(): void {
    this.mode = TransportMode.SCRUB;
  }

  public setShuttleMode(speed: number): void {
    this.mode = TransportMode.SHUTTLE;
    this.shuttleSpeed = Math.max(-4, Math.min(4, speed));
  }

  public setNormalMode(): void {
    this.mode = TransportMode.NORMAL;
    this.shuttleSpeed = 1.0;
  }

  public isActive(): boolean {
    return this.mode !== TransportMode.NORMAL;
  }

  public updateScrubPosition(positionSeconds: number): void {
    this.scrubPosition = Math.max(0, positionSeconds);
  }
}
