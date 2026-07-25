import { describe, it, expect, vi } from "vitest";
import { TransportFSM, MotionState, DirectionState } from "./TransportFSM";

describe("TransportFSM", () => {
  it("starts in STOPPED state", () => {
    const fsm = new TransportFSM();
    expect(fsm.motionState).toBe(MotionState.STOPPED);
    expect(fsm.isStopped()).toBe(true);
    expect(fsm.speed).toBe(1.0);
  });

  it("transitions STOPPED → ROLLING on StartTransport", () => {
    const fsm = new TransportFSM();
    const listener = vi.fn();
    fsm.stateChanged.connect(listener);

    fsm.enqueue({ type: "StartTransport" });

    expect(fsm.motionState).toBe(MotionState.ROLLING);
    expect(fsm.isRolling()).toBe(true);
    expect(listener).toHaveBeenCalledWith(MotionState.ROLLING);
  });

  it("transitions ROLLING → DECLICK_TO_STOP on StopTransport", () => {
    const fsm = new TransportFSM();
    fsm.enqueue({ type: "StartTransport" });
    fsm.enqueue({ type: "StopTransport" });

    expect(fsm.motionState).toBe(MotionState.DECLICK_TO_STOP);
    expect(fsm.isDeclicking()).toBe(true);
  });

  it("transitions DECLICK_TO_STOP → STOPPED on DeclickDone", () => {
    const fsm = new TransportFSM();
    fsm.enqueue({ type: "StartTransport" });
    fsm.enqueue({ type: "StopTransport" });
    fsm.enqueue({ type: "DeclickDone" });

    expect(fsm.motionState).toBe(MotionState.STOPPED);
  });

  it("defers events during declick and replays them", () => {
    const fsm = new TransportFSM();
    fsm.enqueue({ type: "StartTransport" });
    fsm.enqueue({ type: "StopTransport" }); // → DECLICK_TO_STOP

    // This start is deferred during declick
    fsm.enqueue({ type: "StartTransport" });
    expect(fsm.motionState).toBe(MotionState.DECLICK_TO_STOP);

    fsm.enqueue({ type: "DeclickDone" }); // → STOPPED, then replays StartTransport
    expect(fsm.motionState).toBe(MotionState.ROLLING);
  });

  it("handles locate while stopped (immediate)", () => {
    const fsm = new TransportFSM();
    const locateListener = vi.fn();
    fsm.locateRequested.connect(locateListener);

    fsm.enqueue({ type: "Locate", target: 44100, rollAfterLocate: false });

    expect(locateListener).toHaveBeenCalledWith(44100);
    expect(fsm.motionState).toBe(MotionState.STOPPED);
  });

  it("handles locate while stopped with rollAfterLocate", () => {
    const fsm = new TransportFSM();
    fsm.enqueue({ type: "Locate", target: 44100, rollAfterLocate: true });

    expect(fsm.motionState).toBe(MotionState.ROLLING);
  });

  it("handles locate while rolling (declick first)", () => {
    const fsm = new TransportFSM();
    fsm.enqueue({ type: "StartTransport" });

    const locateListener = vi.fn();
    fsm.locateRequested.connect(locateListener);

    fsm.enqueue({ type: "Locate", target: 88200, rollAfterLocate: true });
    expect(fsm.motionState).toBe(MotionState.DECLICK_TO_LOCATE);

    fsm.enqueue({ type: "DeclickDone" });
    expect(fsm.motionState).toBe(MotionState.WAITING_FOR_LOCATE);
    expect(locateListener).toHaveBeenCalledWith(88200);

    fsm.enqueue({ type: "LocateComplete" });
    expect(fsm.motionState).toBe(MotionState.ROLLING);
  });

  it("clamps speed to valid range", () => {
    const fsm = new TransportFSM();
    fsm.setSpeed(20); // above MAX_SPEED (8.0)
    expect(fsm.speed).toBe(8.0);
  });

  it("snaps near-zero speed to zero", () => {
    const fsm = new TransportFSM();
    fsm.setSpeed(0.01); // below MIN_SPEED (0.0625)
    expect(fsm.speed).toBe(0);
  });

  it("handles direction reversal while rolling", () => {
    const fsm = new TransportFSM();
    const dirListener = vi.fn();
    fsm.directionChanged.connect(dirListener);

    fsm.enqueue({ type: "StartTransport" });
    fsm.setSpeed(-2); // sign change → declick

    expect(fsm.motionState).toBe(MotionState.DECLICK_TO_STOP);
    expect(fsm.directionState).toBe(DirectionState.REVERSING);

    fsm.enqueue({ type: "DeclickDone" });
    expect(fsm.motionState).toBe(MotionState.ROLLING);
    expect(fsm.speed).toBe(-2);
    expect(fsm.directionState).toBe(DirectionState.BACKWARDS);
  });

  it("ignores duplicate StartTransport while rolling", () => {
    const fsm = new TransportFSM();
    const listener = vi.fn();
    fsm.enqueue({ type: "StartTransport" });
    fsm.stateChanged.connect(listener);

    fsm.enqueue({ type: "StartTransport" }); // duplicate
    expect(listener).not.toHaveBeenCalled();
    expect(fsm.motionState).toBe(MotionState.ROLLING);
  });

  it("ignores StopTransport while already stopped", () => {
    const fsm = new TransportFSM();
    const listener = vi.fn();
    fsm.stateChanged.connect(listener);

    fsm.enqueue({ type: "StopTransport" });
    expect(listener).not.toHaveBeenCalled();
  });
});
