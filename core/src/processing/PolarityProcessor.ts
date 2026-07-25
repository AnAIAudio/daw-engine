import { Processor, ProcessorId } from "./Processor";
import { Signal } from "../lib/Signal";

/**
 * Phase inversion (polarity) processor.
 *
 * When inverted, all samples are multiplied by -1.  This is the standard
 * "phase flip" found on every DAW channel strip.
 *
 * Placed in the signal chain after the main fader and before post-fader plugins:
 *   Input -> Trim -> [Pre-fader] -> Fader -> Polarity -> [Post-fader] -> Panner -> Output
 */
export class PolarityProcessor extends Processor {
  private _inverted: boolean = false;

  /** Emitted whenever the polarity state changes. */
  public readonly polarityChanged = new Signal<boolean>();

  constructor(id: ProcessorId, name: string = "Polarity") {
    super(id, name);
  }

  /** Whether the signal is phase-inverted. */
  public get inverted(): boolean {
    return this._inverted;
  }

  /**
   * Set the polarity inversion state.
   * @param inverted `true` to invert (multiply samples by -1), `false` for normal.
   */
  public setInverted(inverted: boolean): void {
    if (this._inverted !== inverted) {
      this._inverted = inverted;
      this.polarityChanged.emit(inverted);
      this.stateChanged.emit();
    }
  }
}
