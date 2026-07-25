import { describe, it, expect, vi } from "vitest";
import { ThawList } from "./ThawList";

describe("ThawList", () => {
  it("emits singleChanged when not frozen", () => {
    const list = new ThawList<number>();
    const listener = vi.fn();
    list.singleChanged.connect(listener);

    list.notify(42);
    expect(listener).toHaveBeenCalledWith(42);
  });

  it("suppresses notifications while frozen", () => {
    const list = new ThawList<number>();
    const single = vi.fn();
    const batch = vi.fn();
    list.singleChanged.connect(single);
    list.changed.connect(batch);

    list.freeze();
    list.notify(1);
    list.notify(2);

    expect(single).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(list.pendingCount).toBe(2);
  });

  it("emits batch on thaw", () => {
    const list = new ThawList<number>();
    const batch = vi.fn();
    list.changed.connect(batch);

    list.freeze();
    list.notify(1);
    list.notify(2);
    list.thaw();

    expect(batch).toHaveBeenCalledWith([1, 2]);
  });

  it("supports nested freeze/thaw", () => {
    const list = new ThawList<string>();
    const batch = vi.fn();
    list.changed.connect(batch);

    list.freeze();
    list.freeze();
    list.notify("a");
    list.thaw(); // inner thaw — still frozen
    expect(batch).not.toHaveBeenCalled();

    list.thaw(); // outer thaw — emits batch
    expect(batch).toHaveBeenCalledWith(["a"]);
  });

  it("throws on unbalanced thaw", () => {
    const list = new ThawList();
    expect(() => list.thaw()).toThrow("without matching freeze");
  });

  it("batch() ensures balanced freeze/thaw even on error", () => {
    const list = new ThawList<number>();
    const batch = vi.fn();
    list.changed.connect(batch);

    expect(() => {
      list.batch(() => {
        list.notify(1);
        throw new Error("boom");
      });
    }).toThrow("boom");

    // thaw was called despite the error, so the list is unfrozen
    expect(list.isFrozen).toBe(false);
  });

  it("flush emits pending without modifying freeze state", () => {
    const list = new ThawList<number>();
    const batch = vi.fn();
    list.changed.connect(batch);

    list.freeze();
    list.notify(1);
    list.flush();

    expect(batch).toHaveBeenCalledWith([1]);
    expect(list.isFrozen).toBe(true); // still frozen
  });

  it("discard drops pending changes silently", () => {
    const list = new ThawList<number>();
    const batch = vi.fn();
    list.changed.connect(batch);

    list.freeze();
    list.notify(1);
    list.notify(2);
    list.discard();
    list.thaw();

    expect(batch).not.toHaveBeenCalled();
  });
});
