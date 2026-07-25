import { AutomationPoint, InterpolationType } from "./types";
import { Signal } from "../lib/Signal";
import { AutomationMode } from "./AutomationMode";
import { AutomationCurve } from "./AutomationCurve";
import { thinPoints } from "./PointThinning";

/**
 * Lookup cache entry for accelerating sequential getValueAt() calls.
 * When evaluating automation along the timeline, consecutive calls
 * usually fall within the same segment or the next one, so caching
 * the last lookup avoids repeated binary searches.
 */
interface LookupCache {
  /** The left boundary time of the cached segment */
  left: number;
  /** Index of the left point in the points array */
  leftIndex: number;
  /** Index of the right point in the points array */
  rightIndex: number;
}

/**
 * Tracks the state of an active write pass (recording automation).
 */
interface WritePassState {
  /** The time (seconds) when the write pass began */
  startTime: number;
  /** The time (seconds) when the write pass ended (set on finish) */
  endTime: number;
}

/**
 * An ordered list of automation points with interpolation, touch/write
 * state tracking, write pass management, lookup caching, and range
 * operations.
 *
 */
export class AutomationList {
  private points: AutomationPoint[] = [];
  private _mode: AutomationMode = AutomationMode.READ;

  /** Signals */
  public readonly changed = new Signal<void>();
  public readonly modeChanged = new Signal<AutomationMode>();

  // --- B-1: Spline support ---
  private _curve = new AutomationCurve();

  // --- B-2: Touch state tracking ---
  private _touching: boolean = false;

  // --- B-3: Write pass tracking ---
  private _writePass: WritePassState | null = null;

  // --- B-4: Lookup cache ---
  private _lookupCache: LookupCache | null = null;

  constructor() {}

  // =========================================================================
  // Mode
  // =========================================================================

  public get mode(): AutomationMode {
    return this._mode;
  }

  public set mode(m: AutomationMode) {
    if (this._mode !== m) {
      this._mode = m;
      this.modeChanged.emit(m);
    }
  }

  // =========================================================================
  // Point management
  // =========================================================================

  /**
   * Adds a new automation point at the given time/value.
   * Points are kept sorted by time.
   * @param time The point time in seconds
   * @param value The point value
   * @param interpolation The interpolation type for the segment starting at this point
   * @param id Optional explicit ID
   * @returns The created AutomationPoint
   */
  public addPoint(
    time: number,
    value: number,
    interpolation: InterpolationType = InterpolationType.Linear,
    id?: string,
  ): AutomationPoint {
    const point: AutomationPoint = {
      id: id || crypto.randomUUID(),
      time,
      value,
      interpolation,
    };

    // Insert in sorted order
    const index = this.points.findIndex((p) => p.time > time);
    if (index === -1) {
      this.points.push(point);
    } else {
      this.points.splice(index, 0, point);
    }

    this._invalidateCache();
    this.changed.emit();

    return point;
  }

  /**
   * Updates an existing point's time and value.
   * Re-sorts the list if the time changes.
   * @param id The point ID
   * @param time New time
   * @param value New value
   * @returns true if the point was found and updated
   */
  public updatePoint(id: string, time: number, value: number): boolean {
    const index = this.points.findIndex((p) => p.id === id);
    if (index === -1) return false;

    const point = this.points[index];

    // If time changes, we need to re-sort.
    if (point.time !== time) {
      this.points.splice(index, 1);
      point.time = time;
      point.value = value;

      // Re-insert
      const newIndex = this.points.findIndex((p) => p.time > time);
      if (newIndex === -1) {
        this.points.push(point);
      } else {
        this.points.splice(newIndex, 0, point);
      }
    } else {
      point.value = value;
    }

    this._invalidateCache();
    this.changed.emit();
    return true;
  }

  /**
   * Removes a point by ID.
   * @param id The point ID
   * @returns true if the point was found and removed
   */
  public removePoint(id: string): boolean {
    const index = this.points.findIndex((p) => p.id === id);
    if (index !== -1) {
      this.points.splice(index, 1);
      this._invalidateCache();
      this.changed.emit();
      return true;
    }
    return false;
  }

  /**
   * Returns the sorted array of automation points (read-only view).
   */
  public getPoints(): ReadonlyArray<AutomationPoint> {
    return this.points;
  }

  // =========================================================================
  // B-2: Touch state tracking
  // =========================================================================

  /**
   * Returns whether a user is currently touching (interacting with) this
   * automation parameter.
   */
  public isTouching(): boolean {
    return this._touching;
  }

  /**
   * Begin a touch interaction at the given transport time.
   * In Touch/Latch modes this starts overwriting the existing curve.
   * @param when The transport time when the touch begins
   */
  public startTouch(when: number): void {
    this._touching = true;
    // In Touch or Latch mode, also begin a write pass
    if (
      this._mode === AutomationMode.TOUCH ||
      this._mode === AutomationMode.LATCH
    ) {
      this.startWritePass(when);
    }
  }

  /**
   * End a touch interaction at the given transport time.
   * In Touch mode the parameter returns to following the existing curve.
   * In Latch mode the last written value is held until playback stops.
   * @param when The transport time when the touch ends
   */
  public stopTouch(when: number): void {
    this._touching = false;
    // Finish write pass if one is active
    if (this._writePass) {
      this.writePassFinished(when);
    }
  }

  /**
   * Returns true if automation playback should be active — i.e. the
   * parameter value should be read from the automation curve.
   *
   * - READ mode: always true
   * - WRITE mode: always false (manual control)
   * - TOUCH mode: true when NOT touching (follow curve), false when touching
   * - LATCH mode: true when NOT touching (follow curve), false when touching
   * - OFF mode: always false
   */
  public automationPlayback(): boolean {
    switch (this._mode) {
      case AutomationMode.READ:
        return true;
      case AutomationMode.WRITE:
        return false;
      case AutomationMode.TOUCH:
      case AutomationMode.LATCH:
        return !this._touching;
      case AutomationMode.OFF:
      default:
        return false;
    }
  }

  /**
   * Returns true if automation writing should be active — i.e. parameter
   * changes should be recorded into the automation curve.
   *
   * - READ mode: always false
   * - WRITE mode: always true
   * - TOUCH mode: true when touching
   * - LATCH mode: true when touching
   * - OFF mode: always false
   */
  public automationWrite(): boolean {
    switch (this._mode) {
      case AutomationMode.READ:
        return false;
      case AutomationMode.WRITE:
        return true;
      case AutomationMode.TOUCH:
      case AutomationMode.LATCH:
        return this._touching;
      case AutomationMode.OFF:
      default:
        return false;
    }
  }

  // =========================================================================
  // B-3: Write pass & point thinning
  // =========================================================================

  /**
   * Begins a write pass at the given time. Points written during the pass
   * will be tracked for later thinning.
   * @param when The transport time at the start of the write pass
   */
  public startWritePass(when: number): void {
    this._writePass = { startTime: when, endTime: when };
  }

  /**
   * Finishes the current write pass and optionally applies point thinning
   * to the points recorded during the pass.
   *
   * @param when The transport time at the end of the write pass
   * @param thinningFactor Optional area threshold for the triangle-area
   *   thinning algorithm. If provided and > 0, points in the write pass
   *   range with triangle area below this value are removed.
   */
  public writePassFinished(when: number, thinningFactor?: number): void {
    if (!this._writePass) return;

    this._writePass.endTime = when;

    if (thinningFactor !== undefined && thinningFactor > 0) {
      const start = this._writePass.startTime;
      const end = this._writePass.endTime;

      // Split points into: before range, in range, after range
      const before: AutomationPoint[] = [];
      const inRange: AutomationPoint[] = [];
      const after: AutomationPoint[] = [];

      for (const p of this.points) {
        if (p.time < start) {
          before.push(p);
        } else if (p.time > end) {
          after.push(p);
        } else {
          inRange.push(p);
        }
      }

      if (inRange.length > 2) {
        const thinned = thinPoints(inRange, thinningFactor);
        this.points = [...before, ...thinned, ...after];
        this._invalidateCache();
        this.changed.emit();
      }
    }

    this._writePass = null;
  }

  /**
   * Adds a guard point that preserves the current curve value just before
   * or after a write pass boundary. This prevents the write pass from
   * unintentionally altering automation outside its range.
   *
   * @param when The boundary time
   * @param offset A small time offset. Negative places the guard point
   *   before `when`, positive places it after.
   * @returns The created guard point, or null if no value could be determined
   */
  public addGuardPoint(when: number, offset: number): AutomationPoint | null {
    const guardTime = when + offset;
    const value = this.getValueAt(guardTime);
    if (value === null) return null;
    return this.addPoint(guardTime, value);
  }

  // =========================================================================
  // Value evaluation (B-1 spline + B-4 lookup cache)
  // =========================================================================

  /**
   * Calculates the value at a given time based on points and interpolation.
   * Uses the lookup cache (B-4) to accelerate sequential lookups and the
   * spline engine (B-1) for Curved interpolation.
   *
   * @param time The time in seconds
   * @returns The interpolated value, or null if no points exist
   */
  public getValueAt(time: number): number | null {
    if (this.points.length === 0) return null;

    // Check for any Curved points — if so, delegate to the instance curve
    const hasCurved = this.points.some(
      (p) => p.interpolation === InterpolationType.Curved,
    );
    if (hasCurved) {
      return this._curve.getValueAt(this.points, time);
    }

    // Fast paths for boundary cases
    if (time <= this.points[0].time) return this.points[0].value;
    if (time >= this.points[this.points.length - 1].time) {
      return this.points[this.points.length - 1].value;
    }

    // B-4: Try the lookup cache first
    let prevIndex: number;
    let nextIndex: number;

    if (
      this._lookupCache &&
      time >= this._lookupCache.left &&
      this._lookupCache.rightIndex < this.points.length &&
      time < this.points[this._lookupCache.rightIndex].time
    ) {
      // Cache hit — reuse indices
      prevIndex = this._lookupCache.leftIndex;
      nextIndex = this._lookupCache.rightIndex;
    } else {
      // Binary search for the segment containing `time`
      let lo = 0;
      let hi = this.points.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (this.points[mid].time <= time) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      prevIndex = lo;
      nextIndex = hi;

      // Update cache
      this._lookupCache = {
        left: this.points[lo].time,
        leftIndex: lo,
        rightIndex: hi,
      };
    }

    const prevPoint = this.points[prevIndex];
    const nextPoint = this.points[nextIndex];

    // Interpolate using the static curve method
    return AutomationCurve.getValueAt(prevPoint, nextPoint, time);
  }

  // =========================================================================
  // B-6: Range operations
  // =========================================================================

  /**
   * Cuts (removes) all points in the time range [start, end] and returns
   * them as a new AutomationList. The original list is modified in place.
   *
   * @param start Start of the range (inclusive)
   * @param end End of the range (inclusive)
   * @returns A new AutomationList containing the cut points (times
   *   are preserved as-is)
   */
  public cut(start: number, end: number): AutomationList {
    const result = new AutomationList();
    const kept: AutomationPoint[] = [];

    for (const p of this.points) {
      if (p.time >= start && p.time <= end) {
        result.addPoint(p.time, p.value, p.interpolation, p.id);
      } else {
        kept.push(p);
      }
    }

    this.points = kept;
    this._invalidateCache();
    this.changed.emit();
    return result;
  }

  /**
   * Copies all points in the time range [start, end] into a new
   * AutomationList without modifying the original.
   *
   * @param start Start of the range (inclusive)
   * @param end End of the range (inclusive)
   * @returns A new AutomationList containing copies of the points
   */
  public copy(start: number, end: number): AutomationList {
    const result = new AutomationList();

    for (const p of this.points) {
      if (p.time >= start && p.time <= end) {
        result.addPoint(p.time, p.value, p.interpolation);
      }
    }

    return result;
  }

  /**
   * Pastes the points from a source AutomationList into this list,
   * offsetting their times so that the earliest source point lands
   * at the given position.
   *
   * @param source The AutomationList to paste from
   * @param position The target time for the earliest point
   */
  public paste(source: AutomationList, position: number): void {
    const sourcePoints = source.getPoints();
    if (sourcePoints.length === 0) return;

    const sourceStart = sourcePoints[0].time;
    const offset = position - sourceStart;

    for (const p of sourcePoints) {
      this.addPoint(p.time + offset, p.value, p.interpolation);
    }
  }

  /**
   * Removes all points in the time range [start, end].
   *
   * @param start Start of the range (inclusive)
   * @param end End of the range (inclusive)
   */
  public eraseRange(start: number, end: number): void {
    const before = this.points.length;
    this.points = this.points.filter((p) => p.time < start || p.time > end);

    if (this.points.length !== before) {
      this._invalidateCache();
      this.changed.emit();
    }
  }

  /**
   * Scales the time axis of all points by the given ratio.
   * A ratio of 2.0 stretches time to double, 0.5 compresses to half.
   *
   * @param ratio The time scaling ratio (must be > 0)
   */
  public xScale(ratio: number): void {
    if (ratio <= 0) return;

    for (const p of this.points) {
      p.time *= ratio;
    }

    this._invalidateCache();
    this.changed.emit();
  }

  /**
   * Transforms all point values through the given callback function.
   * Useful for operations like normalizing, inverting, or applying gain.
   *
   * @param fn A function that receives the current value and returns the
   *   transformed value
   */
  public yTransform(fn: (value: number) => number): void {
    for (const p of this.points) {
      p.value = fn(p.value);
    }

    this._invalidateCache();
    this.changed.emit();
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Invalidates the lookup cache and spline coefficients.
   * Must be called whenever points are added, removed, or moved.
   */
  private _invalidateCache(): void {
    this._lookupCache = null;
    this._curve.invalidateSpline();
  }
}
