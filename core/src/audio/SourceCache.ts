/**
 * SourceCache — an LRU cache for decoded audio buffers keyed by source id.
 *
 * Large sessions can reference hundreds of audio files.  Decoding them on
 * demand is expensive, but keeping *every* decoded buffer in memory is not
 * always feasible.  `SourceCache` strikes a balance by caching up to a
 * configurable memory limit and evicting least-recently-used entries when
 * the limit is exceeded.
 *
 * Uses JavaScript `Map` insertion-order semantics for O(1) LRU eviction:
 * on every access the entry is deleted and re-inserted so it moves to the
 * tail (most-recently-used), while eviction always removes from the head
 * (least-recently-used).
 *
 * @module SourceCache
 */

/**
 * Internal cache entry storing the decoded buffer alongside size metadata.
 */
interface CacheEntry {
  /** The decoded audio data. */
  buffer: AudioBuffer;
  /** Estimated memory footprint in bytes. */
  sizeBytes: number;
}

/**
 * SourceCache provides an LRU (least-recently-used) cache for
 * {@link AudioBuffer} instances, bounded by a configurable memory limit.
 */
export class SourceCache {
  /**
   * Map of source id to cache entry.
   * Iteration order = insertion order (oldest first).
   * On access we delete + re-insert to move the entry to the tail.
   */
  private cache: Map<string, CacheEntry> = new Map();

  /** Maximum allowed memory usage in bytes. */
  private maxMemoryBytes: number;

  /** Running total of cached memory in bytes. */
  private currentMemoryBytes = 0;

  // -- Statistics ---------------------------------------------------

  /** Number of successful cache lookups. */
  private hits = 0;
  /** Number of cache misses. */
  private misses = 0;

  /**
   * @param maxMemoryMB - Maximum cache size in megabytes.  Defaults to
   *   512 MB.
   */
  constructor(maxMemoryMB: number = 512) {
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
  }

  // ---------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------

  /**
   * Retrieve a cached {@link AudioBuffer} by source id.
   *
   * On a hit the entry is moved to the tail of the Map (most-recently-used)
   * so it is less likely to be evicted.
   *
   * @param sourceId - Unique identifier for the audio source.
   * @returns The cached buffer, or `null` on a miss.
   */
  get(sourceId: string): AudioBuffer | null {
    const entry = this.cache.get(sourceId);
    if (entry) {
      // Move to tail (most-recently-used) — O(1)
      this.cache.delete(sourceId);
      this.cache.set(sourceId, entry);
      this.hits++;
      return entry.buffer;
    }
    this.misses++;
    return null;
  }

  /**
   * Add or replace an {@link AudioBuffer} in the cache.
   *
   * If inserting the buffer would exceed the memory limit, LRU entries are
   * evicted first.  If the buffer itself is larger than the entire cache
   * limit it is still stored (after evicting everything), allowing
   * single-buffer lookups to work.
   *
   * @param sourceId - Unique identifier for the audio source.
   * @param buffer   - The decoded audio data to cache.
   */
  set(sourceId: string, buffer: AudioBuffer): void {
    // If this source is already cached, remove the old entry first
    if (this.cache.has(sourceId)) {
      this.remove(sourceId);
    }

    const sizeBytes = this.estimateBufferSize(buffer);

    // Evict LRU entries until there is room (or the cache is empty)
    while (
      this.cache.size > 0 &&
      this.currentMemoryBytes + sizeBytes > this.maxMemoryBytes
    ) {
      this.evictOne();
    }

    const entry: CacheEntry = { buffer, sizeBytes };

    this.cache.set(sourceId, entry);
    this.currentMemoryBytes += sizeBytes;
  }

  /**
   * Check whether a source id is present in the cache without affecting
   * access statistics or the LRU order.
   *
   * @param sourceId - The source id to look up.
   */
  has(sourceId: string): boolean {
    return this.cache.has(sourceId);
  }

  /**
   * Explicitly remove a source from the cache.
   *
   * @param sourceId - The source id to remove.
   */
  remove(sourceId: string): void {
    const entry = this.cache.get(sourceId);
    if (entry) {
      this.currentMemoryBytes -= entry.sizeBytes;
      this.cache.delete(sourceId);
    }
  }

  // ---------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------

  /**
   * Evict entries using LRU policy until the current memory usage is at or
   * below the configured limit.
   *
   * This is called automatically by {@link set}, but can also be invoked
   * manually (e.g. after reducing the memory limit at runtime).
   */
  evict(): void {
    while (
      this.cache.size > 0 &&
      this.currentMemoryBytes > this.maxMemoryBytes
    ) {
      this.evictOne();
    }
  }

  /**
   * Evict the single least-recently-used entry — O(1) using Map
   * iteration order (head = oldest).
   */
  private evictOne(): void {
    const first = this.cache.keys().next();
    if (!first.done) {
      this.remove(first.value);
    }
  }

  // ---------------------------------------------------------------
  // Statistics / diagnostics
  // ---------------------------------------------------------------

  /**
   * Current memory usage in bytes.
   */
  getMemoryUsage(): number {
    return this.currentMemoryBytes;
  }

  /**
   * Current memory usage in megabytes.
   */
  getMemoryUsageMB(): number {
    return this.currentMemoryBytes / (1024 * 1024);
  }

  /**
   * Cache hit rate as a ratio `[0, 1]`.
   *
   * Returns `0` if no lookups have been performed yet.
   */
  getCacheHitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /**
   * Number of entries currently in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Remove all entries from the cache and reset statistics.
   */
  clear(): void {
    this.cache.clear();
    this.currentMemoryBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  /**
   * Estimate the memory footprint of a decoded {@link AudioBuffer}.
   *
   * Each channel is a `Float32Array` (4 bytes per sample).
   */
  private estimateBufferSize(buffer: AudioBuffer): number {
    return (
      buffer.numberOfChannels * buffer.length * Float32Array.BYTES_PER_ELEMENT
    );
  }
}
