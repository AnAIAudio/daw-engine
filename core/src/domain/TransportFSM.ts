/**
 * Transport Finite State Machine
 *
 * Manages transport motion state with proper declick handling and
 * variable-speed playback including direction reversal.
 *
 * State machine overview:
 *
 *   STOPPED ──StartTransport──> ROLLING
 *   ROLLING ──StopTransport───> DECLICK_TO_STOP ──DeclickDone──> STOPPED
 *   ROLLING ──Locate──────────> DECLICK_TO_LOCATE ──DeclickDone──> WAITING_FOR_LOCATE ──LocateComplete──> ROLLING | STOPPED
 *   ROLLING ──SetSpeed(sign change)──> DECLICK_TO_STOP ──DeclickDone──> (apply reversal) ──> ROLLING
 *
 * Deferred events: events that arrive during a declick phase are queued
 * and replayed once the declick completes.
 */

import { Signal } from "../lib/Signal";
import { FrameCount } from "./types";

// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * The motion state of the transport.
 */
export enum MotionState {
  /** Transport is stopped; playhead is stationary. */
  STOPPED = "STOPPED",
  /** Transport is rolling (playing forward or backward). */
  ROLLING = "ROLLING",
  /** Rolling -> Stopped transition: declick ramp-down in progress. */
  DECLICK_TO_STOP = "DECLICK_TO_STOP",
  /** Rolling -> Locate transition: declick ramp-down before relocating. */
  DECLICK_TO_LOCATE = "DECLICK_TO_LOCATE",
  /** Waiting for the locate operation to complete after declick. */
  WAITING_FOR_LOCATE = "WAITING_FOR_LOCATE",
}

/**
 * The playback direction of the transport.
 */
export enum DirectionState {
  /** Normal forward playback. */
  FORWARDS = "FORWARDS",
  /** Reverse playback (negative speed). */
  BACKWARDS = "BACKWARDS",
  /** Transitioning between directions (during declick). */
  REVERSING = "REVERSING",
}

// ─── Transport Events ───────────────────────────────────────────────────────

export interface StartTransportEvent {
  type: "StartTransport";
}

export interface StopTransportEvent {
  type: "StopTransport";
}

export interface LocateEvent {
  type: "Locate";
  /** Target frame to locate to. */
  target: FrameCount;
  /** Whether to resume rolling after the locate completes. */
  rollAfterLocate: boolean;
}

export interface DeclickDoneEvent {
  type: "DeclickDone";
}

export interface SetSpeedEvent {
  type: "SetSpeed";
  /** Desired playback speed. Negative values = reverse. */
  speed: number;
}

export interface LocateCompleteEvent {
  type: "LocateComplete";
}

/**
 * Union of all transport events the FSM can process.
 */
export type TransportEvent =
  | StartTransportEvent
  | StopTransportEvent
  | LocateEvent
  | DeclickDoneEvent
  | SetSpeedEvent
  | LocateCompleteEvent;

// ─── Speed Constants ────────────────────────────────────────────────────────

/** Maximum absolute playback speed. */
const MAX_SPEED = 8.0;

/** Minimum absolute playback speed (below this is effectively stopped). */
const MIN_SPEED = 0.0625;

// ─── Transport FSM ─────────────────────────────────────────────────────────

export class TransportFSM {
  // ─── State ──────────────────────────────────────────────────────────────

  private _motionState: MotionState = MotionState.STOPPED;
  private _directionState: DirectionState = DirectionState.FORWARDS;
  private _speed: number = 1.0;

  /**
   * Frame to locate to when a Locate event is being processed through declick.
   * Only valid when motionState is DECLICK_TO_LOCATE or WAITING_FOR_LOCATE.
   */
  private _pendingLocateTarget: FrameCount = 0;

  /**
   * Whether the transport should resume rolling after a pending locate completes.
   */
  private _rollAfterLocate: boolean = false;

  /**
   * Speed to apply after a direction-reversal declick completes.
   * Only valid when _directionState is REVERSING.
   */
  private _pendingSpeed: number | null = null;

  // ─── Deferred Event Queue ───────────────────────────────────────────────

  /**
   * Events that arrive during a declick phase. They are stored and
   * replayed (in order) once the declick completes.
   */
  private _deferredEvents: TransportEvent[] = [];

  // ─── Signals ────────────────────────────────────────────────────────────

  /**
   * Emitted whenever the motion state changes.
   * Payload is the new MotionState.
   */
  public readonly stateChanged = new Signal<MotionState>();

  /**
   * Emitted when the FSM determines a locate operation should be performed.
   * The audio engine should reposition the playhead to the given frame.
   */
  public readonly locateRequested = new Signal<FrameCount>();

  /**
   * Emitted when the playback speed changes.
   * Payload is the new speed value (can be negative for reverse).
   */
  public readonly speedChanged = new Signal<number>();

  /**
   * Emitted when the direction changes.
   * Payload is the new DirectionState.
   */
  public readonly directionChanged = new Signal<DirectionState>();

  // ─── Public Accessors ───────────────────────────────────────────────────

  /** Current motion state of the transport. */
  public get motionState(): MotionState {
    return this._motionState;
  }

  /** Current direction state of the transport. */
  public get directionState(): DirectionState {
    return this._directionState;
  }

  /**
   * Current playback speed.
   * Positive = forward, negative = reverse.
   * Range: -8.0 to +8.0 (absolute minimum 0.0625).
   * Default: 1.0.
   */
  public get speed(): number {
    return this._speed;
  }

  /** Whether the transport is currently rolling (playing). */
  public isRolling(): boolean {
    return this._motionState === MotionState.ROLLING;
  }

  /** Whether the transport is fully stopped. */
  public isStopped(): boolean {
    return this._motionState === MotionState.STOPPED;
  }

  /** Whether the transport is in a declick transition. */
  public isDeclicking(): boolean {
    return (
      this._motionState === MotionState.DECLICK_TO_STOP ||
      this._motionState === MotionState.DECLICK_TO_LOCATE
    );
  }

  /** Whether the transport is waiting for a locate to complete. */
  public isWaitingForLocate(): boolean {
    return this._motionState === MotionState.WAITING_FOR_LOCATE;
  }

  // ─── Event Processing ───────────────────────────────────────────────────

  /**
   * Enqueue a transport event for processing.
   *
   * If the FSM is in a declick state, events are deferred and replayed
   * after the declick completes. Otherwise, events are processed immediately.
   */
  public enqueue(event: TransportEvent): void {
    if (this.isDeclicking()) {
      // DeclickDone is always processed immediately (it ends the declick).
      if (event.type === "DeclickDone") {
        this.processEvent(event);
      } else {
        this._deferredEvents.push(event);
      }
    } else {
      this.processEvent(event);
    }
  }

  /**
   * Process a single transport event based on the current state.
   * Implements the full state transition logic.
   */
  public processEvent(event: TransportEvent): void {
    switch (event.type) {
      case "StartTransport":
        this.handleStartTransport();
        break;
      case "StopTransport":
        this.handleStopTransport();
        break;
      case "Locate":
        this.handleLocate(event);
        break;
      case "DeclickDone":
        this.handleDeclickDone();
        break;
      case "SetSpeed":
        this.handleSetSpeed(event);
        break;
      case "LocateComplete":
        this.handleLocateComplete();
        break;
    }
  }

  // ─── Speed Control (A-3) ────────────────────────────────────────────────

  /**
   * Set the playback speed.
   *
   * - Clamps to [-MAX_SPEED, +MAX_SPEED] range.
   * - Absolute values below MIN_SPEED are snapped to zero (effectively stop).
   * - If the sign changes while rolling, a declick + direction reversal is initiated.
   *
   * @param newSpeed The desired playback speed.
   */
  public setSpeed(newSpeed: number): void {
    this.enqueue({ type: "SetSpeed", speed: newSpeed });
  }

  /**
   * Get the current playback speed.
   */
  public getSpeed(): number {
    return this._speed;
  }

  // ─── Private: Event Handlers ────────────────────────────────────────────

  private handleStartTransport(): void {
    switch (this._motionState) {
      case MotionState.STOPPED:
        this.setMotionState(MotionState.ROLLING);
        break;

      case MotionState.ROLLING:
        // Already rolling; ignore duplicate start.
        break;

      case MotionState.DECLICK_TO_STOP:
      case MotionState.DECLICK_TO_LOCATE:
        // During declick: defer the start until declick completes.
        // This is handled by the enqueue() method; we should not
        // reach here for deferred events, but handle defensively.
        break;

      case MotionState.WAITING_FOR_LOCATE:
        // Will start rolling once locate completes via _rollAfterLocate flag.
        this._rollAfterLocate = true;
        break;
    }
  }

  private handleStopTransport(): void {
    switch (this._motionState) {
      case MotionState.STOPPED:
        // Already stopped; ignore.
        break;

      case MotionState.ROLLING:
        // Initiate declick ramp-down before stopping.
        this.setMotionState(MotionState.DECLICK_TO_STOP);
        break;

      case MotionState.DECLICK_TO_STOP:
      case MotionState.DECLICK_TO_LOCATE:
        // Already declicking; the stop will happen when declick completes.
        // If we're locating, convert to a stop-after-declick.
        this._rollAfterLocate = false;
        break;

      case MotionState.WAITING_FOR_LOCATE:
        // Cancel rolling after locate.
        this._rollAfterLocate = false;
        break;
    }
  }

  private handleLocate(event: LocateEvent): void {
    switch (this._motionState) {
      case MotionState.STOPPED:
        // When stopped, locate immediately (no declick needed).
        this._pendingLocateTarget = event.target;
        this._rollAfterLocate = event.rollAfterLocate;
        this.locateRequested.emit(event.target);
        if (event.rollAfterLocate) {
          this.setMotionState(MotionState.ROLLING);
        }
        break;

      case MotionState.ROLLING:
        // While rolling, declick first then relocate.
        this._pendingLocateTarget = event.target;
        this._rollAfterLocate = event.rollAfterLocate;
        this.setMotionState(MotionState.DECLICK_TO_LOCATE);
        break;

      case MotionState.DECLICK_TO_STOP:
      case MotionState.DECLICK_TO_LOCATE:
        // Update the pending target (last locate wins).
        this._pendingLocateTarget = event.target;
        this._rollAfterLocate = event.rollAfterLocate;
        // Keep the declick state; will handle when declick finishes.
        if (this._motionState === MotionState.DECLICK_TO_STOP) {
          // Convert stop to locate.
          this.setMotionState(MotionState.DECLICK_TO_LOCATE);
        }
        break;

      case MotionState.WAITING_FOR_LOCATE:
        // Update pending target; new locate supersedes the previous one.
        this._pendingLocateTarget = event.target;
        this._rollAfterLocate = event.rollAfterLocate;
        this.locateRequested.emit(event.target);
        break;
    }
  }

  private handleDeclickDone(): void {
    switch (this._motionState) {
      case MotionState.DECLICK_TO_STOP:
        if (
          this._directionState === DirectionState.REVERSING &&
          this._pendingSpeed !== null
        ) {
          // Direction reversal: apply the pending speed and resume rolling.
          this.applySpeed(this._pendingSpeed);
          this._pendingSpeed = null;
          this.setMotionState(MotionState.ROLLING);
        } else {
          this.setMotionState(MotionState.STOPPED);
        }
        break;

      case MotionState.DECLICK_TO_LOCATE:
        // Declick finished; now perform the locate.
        this.setMotionState(MotionState.WAITING_FOR_LOCATE);
        this.locateRequested.emit(this._pendingLocateTarget);
        break;

      default:
        // DeclickDone in an unexpected state; ignore.
        break;
    }

    // Replay deferred events.
    this.processDeferredEvents();
  }

  private handleSetSpeed(event: SetSpeedEvent): void {
    const newSpeed = this.clampSpeed(event.speed);
    const oldSpeed = this._speed;

    // If the speed hasn't changed, do nothing.
    if (newSpeed === oldSpeed) {
      return;
    }

    const signChanged =
      Math.sign(newSpeed) !== Math.sign(oldSpeed) &&
      newSpeed !== 0 &&
      oldSpeed !== 0;

    switch (this._motionState) {
      case MotionState.STOPPED:
        // When stopped, just update the speed directly.
        this.applySpeed(newSpeed);
        break;

      case MotionState.ROLLING:
        if (signChanged) {
          // Direction reversal while rolling requires declick.
          this._pendingSpeed = newSpeed;
          this._directionState = DirectionState.REVERSING;
          this.directionChanged.emit(DirectionState.REVERSING);
          this.setMotionState(MotionState.DECLICK_TO_STOP);
        } else {
          // Same direction, just update speed.
          this.applySpeed(newSpeed);
        }
        break;

      case MotionState.DECLICK_TO_STOP:
      case MotionState.DECLICK_TO_LOCATE:
        // During declick, update the pending speed.
        // It will be applied when the declick completes.
        this._pendingSpeed = newSpeed;
        break;

      case MotionState.WAITING_FOR_LOCATE:
        // Apply speed change while waiting for locate.
        this.applySpeed(newSpeed);
        break;
    }
  }

  private handleLocateComplete(): void {
    switch (this._motionState) {
      case MotionState.WAITING_FOR_LOCATE:
        if (this._rollAfterLocate) {
          this.setMotionState(MotionState.ROLLING);
        } else {
          this.setMotionState(MotionState.STOPPED);
        }
        break;

      default:
        // LocateComplete in unexpected state; ignore.
        break;
    }
  }

  // ─── Private: Helpers ───────────────────────────────────────────────────

  /**
   * Transition to a new motion state and emit the stateChanged signal.
   */
  private setMotionState(newState: MotionState): void {
    if (this._motionState === newState) return;
    this._motionState = newState;
    this.stateChanged.emit(newState);
  }

  /**
   * Apply a speed value, updating direction state and emitting signals.
   */
  private applySpeed(newSpeed: number): void {
    this._speed = newSpeed;

    // Update direction state based on speed sign.
    const newDirection =
      newSpeed >= 0 ? DirectionState.FORWARDS : DirectionState.BACKWARDS;
    if (this._directionState !== newDirection) {
      this._directionState = newDirection;
      this.directionChanged.emit(newDirection);
    }

    this.speedChanged.emit(newSpeed);
  }

  /**
   * Clamp a speed value to the valid range.
   * Absolute values below MIN_SPEED are snapped to zero.
   * Absolute values above MAX_SPEED are clamped.
   */
  private clampSpeed(speed: number): number {
    const absSpeed = Math.abs(speed);

    if (absSpeed < MIN_SPEED) {
      // Below minimum threshold; treat as zero (normal speed).
      return 0;
    }

    if (absSpeed > MAX_SPEED) {
      return Math.sign(speed) * MAX_SPEED;
    }

    return speed;
  }

  /**
   * Process all deferred events that accumulated during a declick phase.
   * Events are processed in FIFO order.
   */
  private processDeferredEvents(): void {
    // Take a snapshot and clear the queue first to avoid re-entrancy issues.
    const events = this._deferredEvents.slice();
    this._deferredEvents = [];

    for (const event of events) {
      this.enqueue(event);
    }
  }
}
