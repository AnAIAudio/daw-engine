import { Signal } from "../lib/Signal";
import { FrameCount, SourceId, TrackId } from "./types";

/**
 * TriggerBox implements Ableton-style clip/slot-based playback.
 *
 * A TriggerBox contains multiple slots (triggers), each holding a clip.
 * Only one trigger per box is active at a time. Triggers can be launched
 * quantized to musical grid positions.
 */

export enum TriggerState {
  STOPPED = "STOPPED",
  WAITING_TO_START = "WAITING_TO_START",
  RUNNING = "RUNNING",
  WAITING_TO_STOP = "WAITING_TO_STOP",
  WAITING_TO_RETRIGGER = "WAITING_TO_RETRIGGER",
}

export enum LaunchQuantize {
  NONE = "NONE", // Immediate
  BAR = "BAR", // Next bar boundary
  BEAT = "BEAT", // Next beat boundary
  HALF_BAR = "HALF_BAR",
}

export enum FollowAction {
  NONE = "NONE", // Stop after playing
  AGAIN = "AGAIN", // Loop (play again)
  NEXT = "NEXT", // Play next slot
  PREV = "PREV", // Play previous slot
  RANDOM = "RANDOM", // Play random slot
  STOP = "STOP", // Stop all
}

export interface TriggerSlot {
  id: string;
  index: number;
  name: string;
  sourceId: SourceId | null;
  state: TriggerState;
  gain: number; // 0.0 - 2.0
  color: string;

  // Launch settings
  launchQuantize: LaunchQuantize;
  followAction: FollowAction;
  followCount: number; // Number of times to play before follow action
  followProbability: number; // 0-1, probability of follow action occurring

  // Playback
  stretchMode: "timestretch" | "resample" | "none";
  loopStart: FrameCount;
  loopEnd: FrameCount; // 0 = use full clip

  // Runtime
  playCount: number; // How many times this has played since last launch
  playbackPosition: FrameCount;
}

export interface TriggerPlaybackInfo {
  sourceId: SourceId;
  startInSource: FrameCount;
  blockSize: number;
  gain: number;
}

export interface TriggerBoxSnapshot {
  id: string;
  trackId: string;
  slots: Array<{
    name: string;
    sourceId: string | null;
    gain: number;
    color: string;
    launchQuantize: string;
    followAction: string;
    followCount: number;
    followProbability: number;
  }>;
}

// Default slot colours used when none is specified
const DEFAULT_SLOT_COLORS = [
  "#E63946",
  "#457B9D",
  "#2A9D8F",
  "#E9C46A",
  "#F4A261",
  "#264653",
  "#6A0572",
  "#AB83A1",
];

export class TriggerBox {
  public readonly id: string;
  public readonly trackId: TrackId;
  private _slots: TriggerSlot[] = [];
  private _activeSlotIndex: number = -1;
  private _defaultSlotCount: number = 8;

  // Signals
  public readonly slotTriggered = new Signal<{
    index: number;
    slot: TriggerSlot;
  }>();
  public readonly slotStopped = new Signal<{ index: number }>();
  public readonly activeSlotChanged = new Signal<number>();
  public readonly slotStateChanged = new Signal<{
    index: number;
    state: TriggerState;
  }>();

  constructor(id: string, trackId: TrackId, slotCount?: number) {
    this.id = id;
    this.trackId = trackId;

    if (slotCount !== undefined) {
      this._defaultSlotCount = slotCount;
    }

    // Initialise empty slots
    for (let i = 0; i < this._defaultSlotCount; i++) {
      this._slots.push(this.createEmptySlot(i));
    }
  }

  // ───────────────────────── Slot management ───────────────────────────

  getSlot(index: number): TriggerSlot | undefined {
    return this._slots[index];
  }

  get slots(): ReadonlyArray<TriggerSlot> {
    return this._slots;
  }

  get slotCount(): number {
    return this._slots.length;
  }

  get activeSlotIndex(): number {
    return this._activeSlotIndex;
  }

  // ──────────────────────── Clip loading / clearing ─────────────────────

  loadClip(slotIndex: number, sourceId: SourceId, name?: string): void {
    const slot = this._slots[slotIndex];
    if (!slot) {
      throw new Error(
        `TriggerBox: slot index ${slotIndex} out of range (0-${this._slots.length - 1})`,
      );
    }

    // If this slot is currently running, stop it first
    if (
      slot.state === TriggerState.RUNNING ||
      slot.state === TriggerState.WAITING_TO_START
    ) {
      this.stopSlot(slotIndex);
    }

    slot.sourceId = sourceId;
    slot.name = name ?? `Clip ${slotIndex + 1}`;
    slot.playCount = 0;
    slot.playbackPosition = 0;
  }

  clearSlot(slotIndex: number): void {
    const slot = this._slots[slotIndex];
    if (!slot) {
      throw new Error(`TriggerBox: slot index ${slotIndex} out of range`);
    }

    if (slot.state !== TriggerState.STOPPED) {
      this.stopSlot(slotIndex);
    }

    slot.sourceId = null;
    slot.name = "";
    slot.playCount = 0;
    slot.playbackPosition = 0;
  }

  // ──────────────────────── Launch / Stop ───────────────────────────────

  launchSlot(slotIndex: number): void {
    const slot = this._slots[slotIndex];
    if (!slot) {
      throw new Error(`TriggerBox: slot index ${slotIndex} out of range`);
    }
    if (!slot.sourceId) {
      return; // Nothing to play
    }

    // If another slot is active, set it to stop
    if (this._activeSlotIndex >= 0 && this._activeSlotIndex !== slotIndex) {
      const activeSlot = this._slots[this._activeSlotIndex];
      if (activeSlot && activeSlot.state !== TriggerState.STOPPED) {
        this.setSlotState(this._activeSlotIndex, TriggerState.WAITING_TO_STOP);
      }
    }

    // If this is the same slot that is already running, mark retrigger
    if (
      this._activeSlotIndex === slotIndex &&
      slot.state === TriggerState.RUNNING
    ) {
      this.setSlotState(slotIndex, TriggerState.WAITING_TO_RETRIGGER);
      return;
    }

    // Determine whether to launch immediately or wait for quantize
    if (slot.launchQuantize === LaunchQuantize.NONE) {
      this.activateSlot(slotIndex);
    } else {
      this.setSlotState(slotIndex, TriggerState.WAITING_TO_START);
    }
  }

  stopSlot(slotIndex: number): void {
    const slot = this._slots[slotIndex];
    if (!slot) {
      return;
    }

    if (slot.state === TriggerState.STOPPED) {
      return;
    }

    if (slot.launchQuantize === LaunchQuantize.NONE) {
      this.deactivateSlot(slotIndex);
    } else {
      this.setSlotState(slotIndex, TriggerState.WAITING_TO_STOP);
    }
  }

  stopAll(): void {
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i].state !== TriggerState.STOPPED) {
        this.deactivateSlot(i);
      }
    }
  }

  // ────────────────────── Process block (real-time) ────────────────────

  /**
   * Called by the transport for each audio processing block.
   * Handles state transitions (quantized launch, follow actions) and
   * returns the playback information for the currently active clip.
   */
  processBlock(
    currentFrame: FrameCount,
    blockSize: number,
    bpm: number,
    beatsPerBar: number,
  ): TriggerPlaybackInfo | null {
    // Default sample rate assumption (44100) — will be correct for most
    // cases; a production version would accept sampleRate as a parameter.
    const sampleRate = 44100;

    // ── Handle WAITING_TO_START slots ──
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if (slot.state === TriggerState.WAITING_TO_START) {
        const quantizePoint = this.getNextQuantizePoint(
          currentFrame,
          bpm,
          beatsPerBar,
          sampleRate,
        );
        if (
          currentFrame >= quantizePoint ||
          quantizePoint - currentFrame <= blockSize
        ) {
          // Stop any previously active slot first
          if (this._activeSlotIndex >= 0 && this._activeSlotIndex !== i) {
            this.deactivateSlot(this._activeSlotIndex);
          }
          this.activateSlot(i);
        }
      }
    }

    // ── Handle WAITING_TO_STOP slots ──
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if (slot.state === TriggerState.WAITING_TO_STOP) {
        const quantizePoint = this.getNextQuantizePoint(
          currentFrame,
          bpm,
          beatsPerBar,
          sampleRate,
        );
        if (
          currentFrame >= quantizePoint ||
          quantizePoint - currentFrame <= blockSize
        ) {
          this.deactivateSlot(i);
        }
      }
    }

    // ── Handle WAITING_TO_RETRIGGER ──
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if (slot.state === TriggerState.WAITING_TO_RETRIGGER) {
        const quantizePoint = this.getNextQuantizePoint(
          currentFrame,
          bpm,
          beatsPerBar,
          sampleRate,
        );
        if (
          currentFrame >= quantizePoint ||
          quantizePoint - currentFrame <= blockSize
        ) {
          slot.playbackPosition = slot.loopStart;
          slot.playCount = 0;
          this.setSlotState(i, TriggerState.RUNNING);
        }
      }
    }

    // ── Produce playback info for the active slot ──
    if (this._activeSlotIndex < 0) {
      return null;
    }

    const activeSlot = this._slots[this._activeSlotIndex];
    if (
      !activeSlot ||
      activeSlot.state !== TriggerState.RUNNING ||
      !activeSlot.sourceId
    ) {
      return null;
    }

    const info: TriggerPlaybackInfo = {
      sourceId: activeSlot.sourceId,
      startInSource: activeSlot.playbackPosition,
      blockSize,
      gain: activeSlot.gain,
    };

    // Advance playback position
    activeSlot.playbackPosition += blockSize;

    // Check if we have reached the loop end (or clip end if loopEnd === 0)
    const effectiveEnd = activeSlot.loopEnd > 0 ? activeSlot.loopEnd : Infinity;
    if (activeSlot.playbackPosition >= effectiveEnd) {
      activeSlot.playCount++;
      activeSlot.playbackPosition = activeSlot.loopStart;

      // Check follow action
      if (
        activeSlot.followCount > 0 &&
        activeSlot.playCount >= activeSlot.followCount
      ) {
        this.processFollowAction(this._activeSlotIndex);
      }
    }

    return info;
  }

  // ──────────────────────── Quantize helpers ──────────────────────────

  /**
   * Calculate the next quantize boundary based on the launch quantize
   * setting of the slot that is currently transitioning.
   */
  getNextQuantizePoint(
    currentFrame: FrameCount,
    bpm: number,
    beatsPerBar: number,
    sampleRate: number,
  ): FrameCount {
    if (bpm <= 0) {
      return currentFrame; // No tempo = immediate
    }

    const framesPerBeat = (sampleRate * 60) / bpm;
    const framesPerBar = framesPerBeat * beatsPerBar;

    // Find the waiting slot to read its quantize setting
    let quantize = LaunchQuantize.NONE;
    for (const slot of this._slots) {
      if (
        slot.state === TriggerState.WAITING_TO_START ||
        slot.state === TriggerState.WAITING_TO_STOP ||
        slot.state === TriggerState.WAITING_TO_RETRIGGER
      ) {
        quantize = slot.launchQuantize;
        break;
      }
    }

    if (quantize === LaunchQuantize.NONE) {
      return currentFrame;
    }

    let gridSize: number;
    switch (quantize) {
      case LaunchQuantize.BAR:
        gridSize = framesPerBar;
        break;
      case LaunchQuantize.HALF_BAR:
        gridSize = framesPerBar / 2;
        break;
      case LaunchQuantize.BEAT:
        gridSize = framesPerBeat;
        break;
      default:
        return currentFrame;
    }

    // Next boundary = ceil(currentFrame / gridSize) * gridSize
    const nextBoundary = Math.ceil(currentFrame / gridSize) * gridSize;
    return nextBoundary;
  }

  // ──────────────────────── Follow actions ─────────────────────────────

  private processFollowAction(slotIndex: number): void {
    const slot = this._slots[slotIndex];
    if (!slot) {
      return;
    }

    // Probability check
    if (slot.followProbability < 1 && Math.random() > slot.followProbability) {
      // Follow action did not fire — reset play count and continue looping
      slot.playCount = 0;
      return;
    }

    switch (slot.followAction) {
      case FollowAction.NONE:
        this.deactivateSlot(slotIndex);
        break;

      case FollowAction.AGAIN:
        slot.playbackPosition = slot.loopStart;
        slot.playCount = 0;
        break;

      case FollowAction.NEXT: {
        const next = this.findNextLoadedSlot(slotIndex, 1);
        if (next >= 0) {
          this.deactivateSlot(slotIndex);
          this.activateSlot(next);
        } else {
          this.deactivateSlot(slotIndex);
        }
        break;
      }

      case FollowAction.PREV: {
        const prev = this.findNextLoadedSlot(slotIndex, -1);
        if (prev >= 0) {
          this.deactivateSlot(slotIndex);
          this.activateSlot(prev);
        } else {
          this.deactivateSlot(slotIndex);
        }
        break;
      }

      case FollowAction.RANDOM: {
        const loaded = this._slots
          .map((s, i) => (s.sourceId && i !== slotIndex ? i : -1))
          .filter((i) => i >= 0);
        if (loaded.length > 0) {
          const randomIndex = loaded[Math.floor(Math.random() * loaded.length)];
          this.deactivateSlot(slotIndex);
          this.activateSlot(randomIndex);
        } else {
          this.deactivateSlot(slotIndex);
        }
        break;
      }

      case FollowAction.STOP:
        this.stopAll();
        break;
    }
  }

  // ──────────────────────── Serialization ──────────────────────────────

  toJSON(): TriggerBoxSnapshot {
    return {
      id: this.id,
      trackId: this.trackId,
      slots: this._slots.map((slot) => ({
        name: slot.name,
        sourceId: slot.sourceId,
        gain: slot.gain,
        color: slot.color,
        launchQuantize: slot.launchQuantize,
        followAction: slot.followAction,
        followCount: slot.followCount,
        followProbability: slot.followProbability,
      })),
    };
  }

  static fromJSON(data: TriggerBoxSnapshot): TriggerBox {
    const box = new TriggerBox(data.id, data.trackId, data.slots.length);

    data.slots.forEach((slotData, i) => {
      const slot = box._slots[i];
      if (!slot) return;

      slot.name = slotData.name;
      slot.sourceId = slotData.sourceId;
      slot.gain = slotData.gain;
      slot.color = slotData.color;
      slot.launchQuantize = slotData.launchQuantize as LaunchQuantize;
      slot.followAction = slotData.followAction as FollowAction;
      slot.followCount = slotData.followCount;
      slot.followProbability = slotData.followProbability;
    });

    return box;
  }

  // ──────────────────────── Private helpers ────────────────────────────

  private createEmptySlot(index: number): TriggerSlot {
    return {
      id: `${this.id}-slot-${index}`,
      index,
      name: "",
      sourceId: null,
      state: TriggerState.STOPPED,
      gain: 1.0,
      color: DEFAULT_SLOT_COLORS[index % DEFAULT_SLOT_COLORS.length],
      launchQuantize: LaunchQuantize.BAR,
      followAction: FollowAction.AGAIN,
      followCount: 0,
      followProbability: 1.0,
      stretchMode: "timestretch",
      loopStart: 0,
      loopEnd: 0,
      playCount: 0,
      playbackPosition: 0,
    };
  }

  private activateSlot(index: number): void {
    const slot = this._slots[index];
    if (!slot || !slot.sourceId) return;

    slot.playbackPosition = slot.loopStart;
    slot.playCount = 0;
    this.setSlotState(index, TriggerState.RUNNING);

    this._activeSlotIndex = index;
    this.activeSlotChanged.emit(index);
    this.slotTriggered.emit({ index, slot });
  }

  private deactivateSlot(index: number): void {
    const slot = this._slots[index];
    if (!slot) return;

    this.setSlotState(index, TriggerState.STOPPED);
    slot.playbackPosition = 0;
    slot.playCount = 0;

    if (this._activeSlotIndex === index) {
      this._activeSlotIndex = -1;
      this.activeSlotChanged.emit(-1);
    }
    this.slotStopped.emit({ index });
  }

  private setSlotState(index: number, state: TriggerState): void {
    const slot = this._slots[index];
    if (!slot) return;
    slot.state = state;
    this.slotStateChanged.emit({ index, state });
  }

  /**
   * Find the next slot (in the given direction) that has a loaded clip.
   * Wraps around the slot list.
   */
  private findNextLoadedSlot(fromIndex: number, direction: 1 | -1): number {
    const count = this._slots.length;
    for (let offset = 1; offset < count; offset++) {
      const candidate =
        (((fromIndex + direction * offset) % count) + count) % count;
      if (this._slots[candidate].sourceId) {
        return candidate;
      }
    }
    return -1;
  }
}
