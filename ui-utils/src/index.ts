// ─── Viewport ───────────────────────────────────────────────────────────────
export { TimelineViewport } from "./viewport/TimelineViewport";
export { TrackLayout } from "./viewport/TrackLayout";
export type { TrackLayoutEntry } from "./viewport/TrackLayout";

// ─── Waveform ───────────────────────────────────────────────────────────────
export {
  computePeaks,
  computePeaksFromSamples,
  recommendResolution,
} from "./waveform/computePeaks";
export {
  renderWaveform,
  renderStereoWaveform,
  renderWaveformFromSamples,
} from "./waveform/renderWaveform";
export type { WaveformRenderOptions } from "./waveform/renderWaveform";

// ─── Ruler ──────────────────────────────────────────────────────────────────
export { computeRulerTicks } from "./ruler/RulerTicks";
export type { RulerTick, RulerTicksOptions } from "./ruler/RulerTicks";

// ─── Scroll ────────────────────────────────────────────────────────────────
export { VirtualScroll } from "./scroll/VirtualScroll";
export type { VirtualItem, VirtualScrollOptions } from "./scroll/VirtualScroll";
export { InfiniteTimeline } from "./scroll/InfiniteTimeline";
export type { InfiniteTimelineOptions } from "./scroll/InfiniteTimeline";

// ─── Playhead ───────────────────────────────────────────────────────────────
export { PlayheadTracker } from "./playhead/PlayheadTracker";

// ─── Canvas Scene Graph ────────────────────────────────────────────────────
export { CanvasItem } from "./canvas/CanvasItem";
export { CanvasGroup } from "./canvas/CanvasGroup";
export { LookupTable } from "./canvas/LookupTable";
export { SceneGraph } from "./canvas/SceneGraph";
export { DirtyRectTracker } from "./canvas/DirtyRectTracker";
export type { Rect, Point, HitTestResult } from "./canvas/types";
export {
  RenderLayer,
  rectContainsPoint,
  rectsIntersect,
  rectIntersection,
  rectUnion,
} from "./canvas/types";
