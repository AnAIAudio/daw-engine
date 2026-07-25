import { describe, it, expect, vi } from "vitest";
import { DisposableGroup } from "./DisposableGroup";
import { Signal } from "./Signal";

describe("DisposableGroup", () => {
  it("disposes all collected disposables", () => {
    const group = new DisposableGroup();
    const d1 = { dispose: vi.fn() };
    const d2 = { dispose: vi.fn() };
    group.add(d1);
    group.add(d2);

    expect(group.size).toBe(2);
    group.dispose();

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(d2.dispose).toHaveBeenCalledTimes(1);
    expect(group.disposed).toBe(true);
    expect(group.size).toBe(0);
  });

  it("is safe to call dispose multiple times", () => {
    const group = new DisposableGroup();
    const d = { dispose: vi.fn() };
    group.add(d);

    group.dispose();
    group.dispose();
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes items added after disposal", () => {
    const group = new DisposableGroup();
    group.dispose();

    const d = { dispose: vi.fn() };
    group.add(d);
    expect(d.dispose).toHaveBeenCalledTimes(1);
  });

  it("works with Signal subscriptions", () => {
    const signal = new Signal<number>();
    const listener = vi.fn();

    const group = new DisposableGroup();
    group.add(signal.connect(listener));

    signal.emit(1);
    expect(listener).toHaveBeenCalledTimes(1);

    group.dispose();
    signal.emit(2);
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });
});
