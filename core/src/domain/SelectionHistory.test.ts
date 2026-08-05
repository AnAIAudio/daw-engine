import { describe, expect, it } from "vitest";

import { SelectionHistory } from "./SelectionHistory";

describe("SelectionHistory", () => {
  it("enables undo after committing a selection", () => {
    const history = new SelectionHistory();
    history.begin(new Set(["track-a"]));

    history.commit(new Set(["track-b"]));

    expect(history.canUndo).toBe(true);
  });

  it("returns the previous selection when undoing", () => {
    const history = new SelectionHistory();
    history.begin(new Set(["track-a"]));
    history.commit(new Set(["track-b"]));

    const selection = history.undo();

    expect(selection).toEqual(new Set(["track-a"]));
  });

  it("returns the next selection when redoing", () => {
    const history = new SelectionHistory();
    history.begin(new Set(["track-a"]));
    history.commit(new Set(["track-b"]));
    history.commit(new Set(["track-c"]));
    history.undo();

    const selection = history.redo();

    expect(selection).toEqual(new Set(["track-c"]));
  });

  it("discards redo history after committing from an undone state", () => {
    const history = new SelectionHistory();
    history.begin(new Set(["track-a"]));
    history.commit(new Set(["track-b"]));
    history.undo();

    history.commit(new Set(["track-c"]));

    expect(history.canRedo).toBe(false);
  });
});
