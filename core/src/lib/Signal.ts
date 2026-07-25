/**
 * A lightweight implementation of the Signal/Slot pattern.
 * Allows objects to expose strongly-typed events that others can subscribe to.
 */
export type Slot<T> = (data: T) => void;

export class Signal<T = void> {
  private slots: Slot<T>[] = [];

  /**
   * Connect a listener (slot) to this signal.
   * @returns A subscription object with a dispose method to unsubscribe.
   */
  public connect(slot: Slot<T>): { dispose: () => void } {
    this.slots.push(slot);
    return {
      dispose: () => this.disconnect(slot),
    };
  }

  /**
   * Disconnect a listener from this signal.
   */
  public disconnect(slot: Slot<T>): void {
    this.slots = this.slots.filter((s) => s !== slot);
  }

  /**
   * Emit the signal, notifying all connected listeners.
   */
  public emit(data: T): void {
    this.slots.forEach((slot) => slot(data));
  }

  /**
   * Clear all listeners.
   */
  public clear(): void {
    this.slots = [];
  }
}
