import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";

export class PanProcessor extends Processor {
  private _pan: number = 0; // -1 (Left) to 1 (Right)
  private _width: number = 1; // 0 (mono) to 2 (wide stereo), 1 = normal

  public readonly panChanged = new Signal<number>();
  public readonly widthChanged = new Signal<number>();

  constructor(id: ProcessorId) {
    super(id, "Panner");
  }

  public get pan(): number {
    return this._pan;
  }

  public set pan(value: number) {
    const clamped = Math.max(-1, Math.min(1, value));
    if (this._pan !== clamped) {
      this._pan = clamped;
      this.panChanged.emit(clamped);
      this.stateChanged.emit();
    }
  }

  /** Stereo width: 0 = mono, 1 = normal, 2 = wide */
  public get width(): number {
    return this._width;
  }

  public set width(value: number) {
    const clamped = Math.max(0, Math.min(2, value));
    if (this._width !== clamped) {
      this._width = clamped;
      this.widthChanged.emit(clamped);
      this.stateChanged.emit();
    }
  }
}
