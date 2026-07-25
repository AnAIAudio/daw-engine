/**
 * SharedArrayBuffer meter data layout.
 *
 * Worklet thread writes peak/RMS per render quantum (128 samples).
 * Main thread reads via Atomics.load on requestAnimationFrame.
 *
 * Memory layout per slot (Float32Array view):
 *   [peak, rms, clip, active]
 */

export const METER_SLOT_STRIDE = 4; // floats per slot
export const METER_PEAK_OFFSET = 0;
export const METER_RMS_OFFSET = 1;
export const METER_CLIP_OFFSET = 2;
export const METER_ACTIVE_OFFSET = 3; // 1.0 if worklet is writing

export const MAX_METER_SLOTS = 128;
export const METER_SAB_BYTE_LENGTH =
  MAX_METER_SLOTS * METER_SLOT_STRIDE * Float32Array.BYTES_PER_ELEMENT;

/** Check if SharedArrayBuffer is available (requires cross-origin isolation) */
export function isSABAvailable(): boolean {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined" &&
    (typeof crossOriginIsolated === "undefined" || crossOriginIsolated)
  );
}
