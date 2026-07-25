import { describe, it, expect, vi } from "vitest";
import { Signal } from "./Signal";

describe("Signal", () => {
  it("emits to connected listeners", () => {
    const signal = new Signal<number>();
    const listener = vi.fn();
    signal.connect(listener);

    signal.emit(42);
    expect(listener).toHaveBeenCalledWith(42);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports multiple listeners", () => {
    const signal = new Signal<string>();
    const a = vi.fn();
    const b = vi.fn();
    signal.connect(a);
    signal.connect(b);

    signal.emit("hello");
    expect(a).toHaveBeenCalledWith("hello");
    expect(b).toHaveBeenCalledWith("hello");
  });

  it("disconnect removes a listener", () => {
    const signal = new Signal<number>();
    const listener = vi.fn();
    signal.connect(listener);
    signal.disconnect(listener);

    signal.emit(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose() from connect return value removes listener", () => {
    const signal = new Signal<number>();
    const listener = vi.fn();
    const sub = signal.connect(listener);

    sub.dispose();
    signal.emit(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clear removes all listeners", () => {
    const signal = new Signal<void>();
    const a = vi.fn();
    const b = vi.fn();
    signal.connect(a);
    signal.connect(b);

    signal.clear();
    signal.emit();
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("void signal works without arguments", () => {
    const signal = new Signal<void>();
    const listener = vi.fn();
    signal.connect(listener);

    signal.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
