/**
 * BufferPool — a lock-free, bucket-based pool of reusable `Float32Array`
 * buffers designed for real-time audio processing.
 *
 * Audio worklets and renderers frequently allocate temporary buffers for
 * mixing, effects processing, and metering.  Allocating on the hot path
 * causes GC pressure and potential audio glitches.  `BufferPool` eliminates
 * this by maintaining pre-allocated buffers grouped into fixed-size buckets.
 *
 * **Bucket sizes:** 128, 256, 512, 1024, 2048, 4096.
 * Requests for sizes that don't match a bucket are rounded **up** to the
 * next bucket size.  Requests larger than 4096 are allocated on demand and
 * returned to a 4096 bucket (truncated) or discarded.
 *
 * @example
 * ```ts
 * const pool = new BufferPool();
 * pool.preallocate(8, 1024); // pre-fill 8 buffers of length 1024
 *
 * const buf = pool.acquire(1024);
 * // ... use buf for processing ...
 * pool.release(buf);
 * ```
 *
 * @module BufferPool
 */

/** Canonical bucket sizes — kept sorted ascending. */
const BUCKET_SIZES = [128, 256, 512, 1024, 2048, 4096] as const;

/**
 * BufferPool manages a set of reusable {@link Float32Array} instances grouped
 * by size buckets to avoid allocation on the audio thread.
 */
export class BufferPool {
  /** Available (returned) buffers grouped by bucket size. */
  private sizeMap: Map<number, Float32Array[]> = new Map();

  /** Number of buffers currently acquired (not yet released). */
  private _activeCount = 0;

  constructor() {
    // Initialise empty arrays for each bucket
    for (const size of BUCKET_SIZES) {
      this.sizeMap.set(size, []);
    }
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /**
   * Round `size` **up** to the nearest bucket size.
   *
   * If `size` exceeds the largest bucket the largest bucket size is returned
   * so we can still pool it (the caller gets a buffer at least as large as
   * requested).
   */
  private bucketFor(size: number): number {
    for (const bucket of BUCKET_SIZES) {
      if (size <= bucket) {
        return bucket;
      }
    }
    // Larger than any bucket — use the biggest bucket
    return BUCKET_SIZES[BUCKET_SIZES.length - 1];
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Acquire a {@link Float32Array} of at least `size` samples.
   *
   * If the pool contains a buffer in the appropriate bucket it is reused;
   * otherwise a new buffer is allocated.  The returned buffer is
   * zero-filled.
   *
   * @param size - Minimum number of elements required.
   * @returns A `Float32Array` with `length >= size`.
   */
  acquire(size: number): Float32Array {
    const bucket = this.bucketFor(size);
    const stack = this.sizeMap.get(bucket);

    let buffer: Float32Array;

    if (stack && stack.length > 0) {
      buffer = stack.pop()!;
    } else if (size > BUCKET_SIZES[BUCKET_SIZES.length - 1]) {
      // Request exceeds largest bucket — allocate exact size
      buffer = new Float32Array(size);
    } else {
      buffer = new Float32Array(bucket);
    }

    // Zero-fill for safety
    buffer.fill(0);

    this._activeCount++;
    return buffer;
  }

  /**
   * Return a buffer to the pool so it can be reused by a future
   * {@link acquire} call.
   *
   * @param buffer - The buffer to release.  Must have been obtained via
   *   {@link acquire}; behaviour is undefined otherwise.
   */
  release(buffer: Float32Array): void {
    const bucket = this.bucketFor(buffer.length);
    let stack = this.sizeMap.get(bucket);

    if (!stack) {
      stack = [];
      this.sizeMap.set(bucket, stack);
    }

    // Only pool buffers whose length matches a bucket size.
    // Odd-sized buffers (larger than max bucket) are discarded to GC.
    if (buffer.length === bucket) {
      stack.push(buffer);
    }

    if (this._activeCount > 0) {
      this._activeCount--;
    }
  }

  /**
   * Pre-allocate `count` buffers of `size` samples and add them to the
   * pool.  This is useful during initialisation to avoid allocations on
   * the first processing pass.
   *
   * @param count - Number of buffers to create.
   * @param size  - Samples per buffer (will be rounded to a bucket size).
   */
  preallocate(count: number, size: number): void {
    const bucket = this.bucketFor(size);
    let stack = this.sizeMap.get(bucket);

    if (!stack) {
      stack = [];
      this.sizeMap.set(bucket, stack);
    }

    for (let i = 0; i < count; i++) {
      stack.push(new Float32Array(bucket));
    }
  }

  // ---------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------

  /**
   * Number of buffers currently acquired and not yet released.
   */
  get activeCount(): number {
    return this._activeCount;
  }

  /**
   * Total number of buffers available in the pool (across all buckets).
   */
  get poolSize(): number {
    let total = 0;
    for (const stack of this.sizeMap.values()) {
      total += stack.length;
    }
    return total;
  }

  /**
   * Remove all pooled buffers and reset the active count.
   *
   * **Caution:** any buffers currently acquired become orphaned — they will
   * be garbage-collected when the caller releases its reference.
   */
  clear(): void {
    for (const stack of this.sizeMap.values()) {
      stack.length = 0;
    }
    this._activeCount = 0;
  }
}
