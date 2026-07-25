import { Session } from "../domain/Session";
import { Track, TrackType } from "../domain/Track";
import { Signal } from "../lib/Signal";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrackTemplate {
  name: string;
  type: TrackType;
  color?: string;
  plugins?: Array<{ pluginId: string; params?: Record<string, number> }>;
  armed?: boolean;
  monitorMode?: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  category:
    "recording" | "mixing" | "mastering" | "production" | "podcast" | "custom";
  sampleRate: number;
  tempo: number;
  timeSignature: [number, number];
  tracks: TrackTemplate[];
  createdAt: string;
  updatedAt: string;
}

// ─── Snapshot for serialization ──────────────────────────────────────────────

interface SessionTemplateManagerSnapshot {
  templates: SessionTemplate[];
}

// ─── SessionTemplateManager ──────────────────────────────────────────────────

/**
 * Manages session templates — predefined track / routing configurations
 * that users can instantiate to quickly bootstrap new sessions.
 *
 * Includes a set of built-in factory templates (recording, podcast,
 * mixing, mastering, production) and supports user-created custom
 * templates.
 */
export class SessionTemplateManager {
  private _templates: Map<string, SessionTemplate> = new Map();

  public readonly templatesChanged = new Signal<void>();

  constructor() {
    // Seed with default templates
    for (const t of SessionTemplateManager.getDefaultTemplates()) {
      this._templates.set(t.id, t);
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Add a new template. An `id`, `createdAt`, and `updatedAt` are generated
   * automatically.
   */
  addTemplate(
    template: Omit<SessionTemplate, "id" | "createdAt" | "updatedAt">,
  ): SessionTemplate {
    const now = new Date().toISOString();
    const full: SessionTemplate = {
      ...template,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this._templates.set(full.id, full);
    this.templatesChanged.emit();
    return full;
  }

  /**
   * Update an existing template. Only the supplied fields are merged; the
   * `updatedAt` timestamp is refreshed automatically.
   */
  updateTemplate(id: string, updates: Partial<SessionTemplate>): void {
    const existing = this._templates.get(id);
    if (!existing) {
      throw new Error(`SessionTemplate not found: ${id}`);
    }
    const updated: SessionTemplate = {
      ...existing,
      ...updates,
      id, // prevent ID overwrite
      updatedAt: new Date().toISOString(),
    };
    this._templates.set(id, updated);
    this.templatesChanged.emit();
  }

  /**
   * Remove a template by ID.
   */
  removeTemplate(id: string): void {
    if (this._templates.delete(id)) {
      this.templatesChanged.emit();
    }
  }

  /**
   * Get a single template by ID.
   */
  getTemplate(id: string): SessionTemplate | undefined {
    return this._templates.get(id);
  }

  /**
   * Get all registered templates.
   */
  getAllTemplates(): SessionTemplate[] {
    return Array.from(this._templates.values());
  }

  /**
   * Get templates filtered by category.
   */
  getTemplatesByCategory(category: string): SessionTemplate[] {
    return this.getAllTemplates().filter((t) => t.category === category);
  }

  // ─── Create template from a live Session ──────────────────────────────────

  /**
   * Snapshot a Session into a reusable template.
   */
  static createFromSession(
    session: Session,
    name: string,
    description: string,
  ): SessionTemplate {
    const trackTemplates: TrackTemplate[] = session.tracks.map(
      (track: Track) => ({
        name: track.name,
        type: track.type,
        color: track.color,
        armed: track.armed,
        monitorMode: track.monitorMode,
      }),
    );

    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      name,
      description,
      category: "custom",
      sampleRate: session.sampleRate,
      tempo: session.tempo,
      timeSignature: [...session.timeSignature] as [number, number],
      tracks: trackTemplates,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ─── Built-in default templates ──────────────────────────────────────────

  static getDefaultTemplates(): SessionTemplate[] {
    const now = new Date().toISOString();

    return [
      // 1. Empty Session
      {
        id: "tpl-empty",
        name: "Empty Session",
        description: "A blank slate with no tracks — start from scratch.",
        category: "custom",
        sampleRate: 44100,
        tempo: 120,
        timeSignature: [4, 4],
        tracks: [],
        createdAt: now,
        updatedAt: now,
      },

      // 2. Basic Recording (8 audio tracks)
      {
        id: "tpl-basic-recording",
        name: "Basic Recording",
        description:
          "8 audio tracks pre-named for a typical drum/bass/vocal recording session.",
        category: "recording",
        sampleRate: 48000,
        tempo: 120,
        timeSignature: [4, 4],
        tracks: [
          {
            name: "Kick",
            type: TrackType.AUDIO,
            color: "#ff6b6b",
            armed: true,
          },
          {
            name: "Snare",
            type: TrackType.AUDIO,
            color: "#ff922b",
            armed: true,
          },
          {
            name: "HiHat",
            type: TrackType.AUDIO,
            color: "#ffd43b",
            armed: true,
          },
          {
            name: "Toms",
            type: TrackType.AUDIO,
            color: "#51cf66",
            armed: true,
          },
          { name: "OHL", type: TrackType.AUDIO, color: "#20c997", armed: true },
          { name: "OHR", type: TrackType.AUDIO, color: "#4a9eff", armed: true },
          {
            name: "Bass DI",
            type: TrackType.AUDIO,
            color: "#cc5de8",
            armed: true,
          },
          {
            name: "Vocal",
            type: TrackType.AUDIO,
            color: "#f06595",
            armed: true,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },

      // 3. Podcast (2 audio + 1 music bed)
      {
        id: "tpl-podcast",
        name: "Podcast",
        description:
          "2 voice tracks (Host, Guest) and a music-bed audio track for podcast production.",
        category: "podcast",
        sampleRate: 48000,
        tempo: 120,
        timeSignature: [4, 4],
        tracks: [
          {
            name: "Host",
            type: TrackType.AUDIO,
            color: "#4a9eff",
            armed: true,
            monitorMode: "auto",
          },
          {
            name: "Guest",
            type: TrackType.AUDIO,
            color: "#51cf66",
            armed: true,
            monitorMode: "auto",
          },
          {
            name: "Music Bed",
            type: TrackType.AUDIO,
            color: "#cc5de8",
            armed: false,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },

      // 4. Song Production (4 audio + 2 MIDI + 1 bus)
      {
        id: "tpl-song-production",
        name: "Song Production",
        description:
          "4 audio tracks, 2 MIDI tracks, and a Drums bus for modern song production.",
        category: "production",
        sampleRate: 48000,
        tempo: 128,
        timeSignature: [4, 4],
        tracks: [
          { name: "Kick", type: TrackType.AUDIO, color: "#ff6b6b" },
          { name: "Snare", type: TrackType.AUDIO, color: "#ff922b" },
          { name: "HiHat", type: TrackType.AUDIO, color: "#ffd43b" },
          {
            name: "Vocal",
            type: TrackType.AUDIO,
            color: "#f06595",
            armed: true,
          },
          { name: "Synth Lead", type: TrackType.MIDI, color: "#4a9eff" },
          { name: "Synth Pad", type: TrackType.MIDI, color: "#cc5de8" },
          { name: "Drums Bus", type: TrackType.BUS, color: "#868e96" },
        ],
        createdAt: now,
        updatedAt: now,
      },

      // 5. Mixing (pre-configured bus structure)
      {
        id: "tpl-mixing",
        name: "Mixing",
        description:
          "Pre-configured bus structure for mixing: Drums, Bass, Keys, Vocals, and FX buses.",
        category: "mixing",
        sampleRate: 48000,
        tempo: 120,
        timeSignature: [4, 4],
        tracks: [
          { name: "Drums Bus", type: TrackType.BUS, color: "#ff6b6b" },
          { name: "Bass Bus", type: TrackType.BUS, color: "#ff922b" },
          { name: "Keys Bus", type: TrackType.BUS, color: "#ffd43b" },
          { name: "Vocals Bus", type: TrackType.BUS, color: "#4a9eff" },
          { name: "FX Bus", type: TrackType.BUS, color: "#cc5de8" },
        ],
        createdAt: now,
        updatedAt: now,
      },

      // 6. Mastering (1 stereo audio + 1 reference)
      {
        id: "tpl-mastering",
        name: "Mastering",
        description:
          "1 stereo audio track for the mix and a reference track for A/B comparison.",
        category: "mastering",
        sampleRate: 96000,
        tempo: 120,
        timeSignature: [4, 4],
        tracks: [
          { name: "Mix", type: TrackType.AUDIO, color: "#4a9eff" },
          { name: "Reference", type: TrackType.AUDIO, color: "#868e96" },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  /**
   * Serialize all templates to a JSON string.
   */
  serialize(): string {
    const snapshot: SessionTemplateManagerSnapshot = {
      templates: this.getAllTemplates(),
    };
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Restore a SessionTemplateManager from a JSON string produced by
   * `serialize()`.
   */
  static deserialize(json: string): SessionTemplateManager {
    const snapshot: SessionTemplateManagerSnapshot = JSON.parse(json);
    const manager = new SessionTemplateManager();
    // Clear the defaults that the constructor seeded
    manager._templates.clear();
    for (const t of snapshot.templates) {
      manager._templates.set(t.id, t);
    }
    return manager;
  }
}

// ─── Convenience helpers (backward-compatible with old API) ──────────────────

/**
 * Returns the list of available session templates.
 */
export function getTemplates(): SessionTemplate[] {
  return SessionTemplateManager.getDefaultTemplates();
}

/**
 * Create a new Session from a template.
 *
 * Each template pre-configures tracks with default names, colors,
 * armed state, and routing through the master bus.
 */
export function createFromTemplate(templateId: string): Session {
  const templates = SessionTemplateManager.getDefaultTemplates();
  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const session = new Session(template.name, undefined, template.sampleRate);
  session.tempo = template.tempo;
  session.timeSignature = [...template.timeSignature] as [number, number];

  for (const tt of template.tracks) {
    const track = session.addTrack(tt.name, tt.type);
    if (tt.color) {
      track.color = tt.color;
    }
    if (tt.armed) {
      track.armed = true;
    }
  }

  return session;
}
