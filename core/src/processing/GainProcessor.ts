import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";

export class GainProcessor extends Processor {
  private _gain: number = 0; // dB, default 0dB unity gain

  public readonly gainChanged = new Signal<number>();

  constructor(id: ProcessorId, name: string = "Fader") {
    super(id, name);
  }

  public get gain(): number {
    return this._gain;
  }

  public set gain(db: number) {
    // Clamp or validate if needed
    if (this._gain !== db) {
      this._gain = db;
      this.gainChanged.emit(db);
      this.stateChanged.emit();
    }
  }
}
