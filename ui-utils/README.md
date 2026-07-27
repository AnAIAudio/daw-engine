# @anaidev/daw-engine-ui-utils

Framework-agnostic UI utilities for building DAW interfaces on top of [`@anaidev/daw-engine-core`](https://www.npmjs.com/package/@anaidev/daw-engine-core). Provides the missing layer between headless domain models and visual rendering — viewport math, waveform computation, ruler ticks, and playhead tracking.

```bash
npm install @anaidev/daw-engine-ui-utils @anaidev/daw-engine-core
```

## Features

- **TimelineViewport** — Zoom, scroll, frame ↔ pixel conversion with anchor-aware zooming
- **TrackLayout** — Track height management and vertical position computation
- **Waveform** — Peak computation from `AudioBuffer` + Canvas 2D rendering
- **Ruler Ticks** — Tick position/label calculation for BBT, timecode, min:sec, and samples
- **Playhead Tracker** — `requestAnimationFrame`-based transport position tracking
- **Zero framework dependency** — Works with React, Vue, Svelte, vanilla JS, or any Canvas-based renderer

---

## Quick Start

```typescript
import { Session, AudioEngine, ClockMode } from "@anaidev/daw-engine-core";
import {
  TimelineViewport,
  TrackLayout,
  PlayheadTracker,
  computePeaks,
  renderWaveform,
  computeRulerTicks,
} from "@anaidev/daw-engine-ui-utils";

// 1. Create a viewport
const viewport = new TimelineViewport(44100);
viewport.setPixelsPerSecond(100);
viewport.setViewportWidth(canvas.width);
viewport.setDuration(180); // 3 minutes

// 2. Convert frames to pixels
const regionX = viewport.frameToPixel(region.start);
const regionW = viewport.framesToWidth(region.length);

// 3. Render a waveform
const peaks = computePeaks(audioBuffer, 512);
const ctx = canvas.getContext("2d")!;
renderWaveform({ ctx, peaks, width: 800, height: 120, color: "#4a9eff" });

// 4. Compute ruler ticks
const ticks = computeRulerTicks({ viewport, mode: ClockMode.BBT, bpm: 120 });
for (const tick of ticks) {
  ctx.fillText(tick.label, tick.x - viewport.scrollX, 18);
}

// 5. Track the playhead
const tracker = new PlayheadTracker(
  viewport,
  () => engine.session.transportFrame,
);
tracker.moved.connect(({ x }) => {
  playheadEl.style.transform = `translateX(${x}px)`;
});
tracker.start();
```

---

## API Reference

### TimelineViewport

Manages zoom level and horizontal scroll, providing frame ↔ pixel conversion.

```typescript
const viewport = new TimelineViewport(sampleRate);
```

| Method                                               | Description                                 |
| ---------------------------------------------------- | ------------------------------------------- |
| `setPixelsPerSecond(pps)`                            | Set zoom level (clamped 1–1000)             |
| `setScrollX(px)`                                     | Set horizontal scroll offset in pixels      |
| `setViewportWidth(px)`                               | Set the visible width of the viewport       |
| `setDuration(seconds)`                               | Set total session duration                  |
| `frameToPixel(frame)`                                | Convert frame → absolute pixel X            |
| `pixelToFrame(px)`                                   | Convert absolute pixel X → frame            |
| `frameToViewportPixel(frame)`                        | Convert frame → viewport-relative pixel     |
| `viewportPixelToFrame(px)`                           | Convert viewport-relative pixel → frame     |
| `framesToWidth(frames)`                              | Convert duration in frames → pixel width    |
| `widthToFrames(px)`                                  | Convert pixel width → duration in frames    |
| `zoom(direction, focus?, anchorPx?, playheadFrame?)` | Zoom in/out with anchor                     |
| `zoomToFit()`                                        | Zoom to show the entire session             |
| `zoomToRange(startFrame, endFrame)`                  | Zoom to show a specific range               |
| `scrollToFrame(frame, center?)`                      | Scroll to make a frame visible              |
| `isFrameVisible(frame)`                              | Check if a frame is in the visible viewport |

**Properties:** `pixelsPerSecond`, `scrollX`, `framesPerPixel`, `contentWidth`, `visibleStartFrame`, `visibleEndFrame`

**Signal:** `changed` — emitted on any viewport state change.

---

### TrackLayout

Computes vertical positions for an ordered list of tracks.

```typescript
const layout = new TrackLayout();
layout.setTracks(["track-1", "track-2", "track-3"]);
layout.setTrackHeight("track-1", 120);

const entry = layout.getEntry("track-1");
// { trackId: 'track-1', y: 0, height: 120 }

const hit = layout.getTrackAtY(150);
// { trackId: 'track-2', y: 120, height: 80 }
```

| Method                             | Description                              |
| ---------------------------------- | ---------------------------------------- |
| `setTracks(trackIds)`              | Set ordered track list (top → bottom)    |
| `setTrackHeight(trackId, height)`  | Set height for a track (24–500px)        |
| `setCollapsed(trackId, collapsed)` | Collapse/expand a track                  |
| `getEntry(trackId)`                | Get `{ trackId, y, height }` for a track |
| `getEntries()`                     | Get all layout entries                   |
| `getTrackAtY(y)`                   | Hit-test: find track at a Y coordinate   |
| `totalHeight`                      | Total height of all tracks               |

**Signal:** `changed` — emitted on layout change.

---

### Waveform: computePeaks

Compute peak data from audio samples for efficient waveform rendering.

```typescript
// From AudioBuffer
const peaks = computePeaks(audioBuffer, 512);
const peaksR = computePeaks(audioBuffer, 512, 1); // channel 1

// From raw Float32Array
const peaks = computePeaksFromSamples(channelData, 512);

// Choose resolution for current zoom level
const resolution = recommendResolution(viewport.framesPerPixel);
```

Returns a `PeakData` object (compatible with `@anaidev/daw-engine-core`'s `Source.setPeakData()`):

```typescript
interface PeakData {
  min: Float32Array; // min sample per entry
  max: Float32Array; // max sample per entry
  rms: Float32Array; // RMS per entry
  length: number; // number of entries
  resolution: number; // frames per entry
}
```

---

### Waveform: renderWaveform

Draw waveforms onto a Canvas 2D context.

```typescript
// From pre-computed peaks (recommended for large buffers)
renderWaveform({
  ctx,
  peaks,
  width: 800,
  height: 120,
  color: "#4a9eff",
  logScale: true, // optional: dB scaling
  sourceStart: 44100, // optional: offset into source
  sourceLength: 88200, // optional: range to render
});

// Stereo (L top half, R bottom half with separator)
renderStereoWaveform(ctx, peaksL, peaksR, 800, 120);

// Direct from samples (convenience for small buffers)
renderWaveformFromSamples(ctx, channelData, 800, 120, { color: "#ff6b6b" });
```

---

### computeRulerTicks

Compute ruler tick positions and labels for the visible viewport. Automatically adjusts tick density based on zoom level.

```typescript
import { ClockMode } from "@anaidev/daw-engine-core";

const ticks = computeRulerTicks({
  viewport,
  mode: ClockMode.MINSEC,
});

for (const tick of ticks) {
  const x = tick.x - viewport.scrollX;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, tick.major ? 20 : 10);
  ctx.stroke();
  if (tick.major) ctx.fillText(tick.label, x + 3, 18);
}
```

**Supported modes:** `ClockMode.BBT` (bars/beats), `ClockMode.MINSEC`, `ClockMode.TIMECODE`, `ClockMode.SAMPLES`

Each tick has: `{ x, frame, label, major }`.

---

### PlayheadTracker

Tracks transport position via `requestAnimationFrame` and emits pixel coordinates.

```typescript
const tracker = new PlayheadTracker(
  viewport,
  () => engine.session.transportFrame,
);

tracker.followPlayhead = true; // auto-scroll viewport

tracker.moved.connect(({ frame, x }) => {
  playheadEl.style.transform = `translateX(${x}px)`;
});

tracker.start();
// ... later
tracker.stop();
tracker.dispose();
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Your App (React, Vue, Svelte, vanilla JS)          │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ UI Components (your code)                     │  │
│  │ Canvas rendering, DOM manipulation, events    │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ uses                           │
│  ┌──────────────────▼────────────────────────────┐  │
│  │ @anaidev/daw-engine-ui-utils                  │  │
│  │ TimelineViewport, TrackLayout, computePeaks,  │  │
│  │ renderWaveform, computeRulerTicks,            │  │
│  │ PlayheadTracker                               │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ depends on                     │
│  ┌──────────────────▼────────────────────────────┐  │
│  │ @anaidev/daw-engine-core                      │  │
│  │ Session, Track, Region, Source, AudioEngine,   │  │
│  │ CommandExecutor, Signal, PeakData, ClockMode  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Dependencies

| Package                    | Type    | Description                                |
| -------------------------- | ------- | ------------------------------------------ |
| `@anaidev/daw-engine-core` | runtime | Domain models, Signal, PeakData, ClockMode |

---

## License

MIT
