import { AutomationPoint, InterpolationType } from "./types";

/**
 * Coefficients for a single cubic spline segment.
 * The polynomial is: y = a + b*x + c*x^2 + d*x^3
 * where x is the local offset from the segment start time.
 */
export interface SplineCoefficients {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * Provides interpolation between automation points, including a CJC Kruger
 * constrained cubic spline algorithm that prevents overshoot.
 */
export class AutomationCurve {
  /** Cached spline coefficients, one per segment (points.length - 1). */
  private _splineCoeffs: SplineCoefficients[] = [];
  /** The points array snapshot used to compute the current coefficients. */
  private _splinePoints: ReadonlyArray<AutomationPoint> = [];

  /**
   * Calculates the interpolated value between two points at a given time.
   * For non-spline interpolation types, this static method is sufficient.
   * @param start The starting automation point
   * @param end The ending automation point
   * @param time The time to calculate the value for (must be between start.time and end.time)
   * @param _curvature Optional tension/curvature parameter (not yet implemented fully)
   */
  public static getValueAt(
    start: AutomationPoint,
    end: AutomationPoint,
    time: number,
    _curvature: number = 0.5,
  ): number {
    if (time <= start.time) return start.value;
    if (time >= end.time) return end.value;

    // Normalized time (0 to 1)
    const t = (time - start.time) / (end.time - start.time);

    switch (start.interpolation) {
      case InterpolationType.Hold:
        return start.value;

      case InterpolationType.Linear:
        return start.value + t * (end.value - start.value);

      case InterpolationType.Exponential:
        // Safe geometric interpolation (fallback to linear if signs differ or zero)
        if (start.value > 0.0001 && end.value > 0.0001) {
          return start.value * Math.pow(end.value / start.value, t);
        }
        // Fallback to simpler curve: y = x^2 (slow start, fast end)
        const curveT = t * t;
        return start.value + curveT * (end.value - start.value);

      case InterpolationType.Logarithmic:
        // y = sqrt(x) (fast start, slow end)
        const logT = Math.sqrt(t);
        return start.value + logT * (end.value - start.value);

      default:
        return start.value + t * (end.value - start.value);
    }
  }

  /**
   * Recomputes CJC Kruger constrained cubic spline coefficients for the
   * given set of points. Must be called whenever points change if Curved
   * interpolation is in use.
   *
   * The CJC Kruger variant constrains tangent slopes so that the spline
   * is monotone between consecutive data points, preventing overshoot
   * and oscillation artifacts common with natural cubic splines.
   *
   * @param points Sorted automation points array
   */
  public computeSplineCoefficients(
    points: ReadonlyArray<AutomationPoint>,
  ): void {
    this._splinePoints = points;
    this._splineCoeffs = [];

    const n = points.length;
    if (n < 2) return;

    // Step 1: compute finite-difference slopes delta_k = (y_{k+1} - y_k) / (x_{k+1} - x_k)
    const delta: number[] = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = points[i + 1].time - points[i].time;
      delta[i] = dx === 0 ? 0 : (points[i + 1].value - points[i].value) / dx;
    }

    // Step 2: CJC Kruger constrained tangent slopes
    // For interior points, use harmonic mean when signs agree, else 0.
    // Boundary tangents use one-sided finite difference.
    const m: number[] = new Array(n);

    // Boundary slopes
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];

    for (let i = 1; i < n - 1; i++) {
      if (delta[i - 1] * delta[i] <= 0) {
        // Slopes have different signs or one is zero -> constrain to zero
        m[i] = 0;
      } else {
        // CJC Kruger: harmonic mean of adjacent slopes
        m[i] = 2 / (1 / delta[i - 1] + 1 / delta[i]);
      }
    }

    // Additional Kruger constraint: ensure monotonicity
    // If delta[i] == 0, the tangents at both ends of that segment must be 0
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
      }
    }

    // Clamp boundary slopes to prevent overshoot (Fritsch-Carlson style check)
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] !== 0) {
        const alpha = m[i] / delta[i];
        const beta = m[i + 1] / delta[i];
        // If the vector (alpha, beta) lies outside the circle of radius 3, scale it back
        const mag = Math.sqrt(alpha * alpha + beta * beta);
        if (mag > 3) {
          const tau = 3 / mag;
          m[i] = tau * alpha * delta[i];
          m[i + 1] = tau * beta * delta[i];
        }
      }
    }

    // Step 3: compute cubic Hermite coefficients per segment
    // Given segment from x_i to x_{i+1} with values y_i, y_{i+1} and slopes m_i, m_{i+1}:
    // Using local variable x = (time - x_i), h = x_{i+1} - x_i
    // Hermite basis -> polynomial coefficients a,b,c,d where y = a + b*x + c*x^2 + d*x^3
    for (let i = 0; i < n - 1; i++) {
      const h = points[i + 1].time - points[i].time;
      const y0 = points[i].value;
      const y1 = points[i + 1].value;
      const m0 = m[i];
      const m1 = m[i + 1];

      if (h === 0) {
        // Degenerate segment (coincident times)
        this._splineCoeffs.push({ a: y0, b: 0, c: 0, d: 0 });
        continue;
      }

      // Hermite to power basis conversion:
      // a = y0
      // b = m0
      // c = (3*(y1-y0)/h - 2*m0 - m1) / h
      // d = (2*(y0-y1)/h + m0 + m1) / h^2
      const a = y0;
      const b = m0;
      const c = ((3 * (y1 - y0)) / h - 2 * m0 - m1) / h;
      const d = ((2 * (y0 - y1)) / h + m0 + m1) / (h * h);

      this._splineCoeffs.push({ a, b, c, d });
    }
  }

  /**
   * Returns the spline-interpolated value at the given time.
   * Falls back to the static getValueAt for non-Curved interpolation types.
   *
   * @param points The sorted automation points
   * @param time The time to evaluate
   * @returns The interpolated value, or null if no points exist
   */
  public getValueAt(
    points: ReadonlyArray<AutomationPoint>,
    time: number,
  ): number | null {
    const n = points.length;
    if (n === 0) return null;
    if (time <= points[0].time) return points[0].value;
    if (time >= points[n - 1].time) return points[n - 1].value;

    // Find the segment containing `time` via binary search
    let lo = 0;
    let hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].time <= time) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const start = points[lo];
    const end = points[hi];

    // For non-Curved types, delegate to the static method
    if (start.interpolation !== InterpolationType.Curved) {
      return AutomationCurve.getValueAt(start, end, time);
    }

    // Curved: use precomputed spline coefficients
    if (this._splineCoeffs.length === 0 || this._splinePoints !== points) {
      this.computeSplineCoefficients(points);
    }

    if (lo < this._splineCoeffs.length) {
      const coeff = this._splineCoeffs[lo];
      const x = time - start.time;
      return coeff.a + coeff.b * x + coeff.c * x * x + coeff.d * x * x * x;
    }

    // Fallback
    return AutomationCurve.getValueAt(start, end, time);
  }

  /**
   * Invalidates cached spline coefficients. Call this when points change.
   */
  public invalidateSpline(): void {
    this._splineCoeffs = [];
    this._splinePoints = [];
  }

  /**
   * Returns a copy of the current spline coefficients (for inspection/testing).
   */
  public getSplineCoefficients(): ReadonlyArray<SplineCoefficients> {
    return [...this._splineCoeffs];
  }
}
