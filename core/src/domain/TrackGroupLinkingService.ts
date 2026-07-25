import { Session } from "./Session";
import { Track } from "./Track";
import { TrackGroup } from "./TrackGroup";
import type { TrackId } from "./types";
import type { Disposable } from "../lib/DisposableGroup";
import { DisposableGroup } from "../lib/DisposableGroup";

/**
 * TrackGroupLinkingService
 *
 * Subscribes to track signals (mute, solo, gain, color) and propagates
 * changes to sibling tracks in the same TrackGroup when the corresponding
 * linked flag is enabled.
 *
 * A re-entrance guard prevents infinite loops (A→B→A).
 */
export class TrackGroupLinkingService implements Disposable {
  private _session: Session;
  private _trackSubs = new Map<TrackId, DisposableGroup>();
  private _propagating = false;

  constructor(session: Session) {
    this._session = session;

    // Wire existing tracks
    for (const track of session.tracks) {
      this.subscribeTrack(track);
    }

    // Auto-wire newly added / removed tracks
    session.trackAdded.connect((track: Track) => this.subscribeTrack(track));
    session.trackRemoved.connect((trackId: TrackId) =>
      this.unsubscribeTrack(trackId),
    );
  }

  public dispose(): void {
    for (const subs of this._trackSubs.values()) {
      subs.dispose();
    }
    this._trackSubs.clear();
  }

  private subscribeTrack(track: Track): void {
    const group = new DisposableGroup();

    group.add(
      track.muteChanged.connect((muted: boolean) => {
        this.propagate(track.id, "mute", () => {
          this.forEachLinkedSibling(track.id, "mute", (sibling) => {
            sibling.setMute(muted);
          });
        });
      }),
    );

    group.add(
      track.soloChanged.connect((soloed: boolean) => {
        this.propagate(track.id, "solo", () => {
          this.forEachLinkedSibling(track.id, "solo", (sibling) => {
            sibling.setSolo(soloed);
          });
        });
      }),
    );

    group.add(
      track.colorChanged.connect((color: string) => {
        this.propagate(track.id, "color", () => {
          this.forEachLinkedSibling(track.id, "color", (sibling) => {
            sibling.setColor(color);
          });
        });
      }),
    );

    group.add(
      track.route.fader.gainChanged.connect((db: number) => {
        this.propagate(track.id, "gain", () => {
          this.forEachLinkedSibling(track.id, "gain", (sibling) => {
            sibling.route.volume = db;
          });
        });
      }),
    );

    this._trackSubs.set(track.id, group);
  }

  private unsubscribeTrack(trackId: TrackId): void {
    const subs = this._trackSubs.get(trackId);
    if (subs) {
      subs.dispose();
      this._trackSubs.delete(trackId);
    }
  }

  /**
   * Execute `fn` only if we are not already inside a propagation cycle.
   */
  private propagate(
    _sourceTrackId: TrackId,
    _property: string,
    fn: () => void,
  ): void {
    if (this._propagating) return;
    this._propagating = true;
    try {
      fn();
    } finally {
      this._propagating = false;
    }
  }

  /**
   * Call `fn` for every sibling track in the same TrackGroup that has
   * the specified property linked.
   */
  private forEachLinkedSibling(
    trackId: TrackId,
    property: "gain" | "mute" | "solo" | "color",
    fn: (sibling: Track) => void,
  ): void {
    const group = this._session.getTrackGroupForTrack(trackId);
    if (!group) return;

    const linked = this.isLinked(group, property);
    if (!linked) return;

    for (const memberId of group.memberTrackIds) {
      if (memberId === trackId) continue;
      const sibling = this._session.getTrack(memberId);
      if (sibling) fn(sibling);
    }
  }

  private isLinked(
    group: TrackGroup,
    property: "gain" | "mute" | "solo" | "color",
  ): boolean {
    switch (property) {
      case "gain":
        return group.gainLinked;
      case "mute":
        return group.muteLinked;
      case "solo":
        return group.soloLinked;
      case "color":
        return group.colorLinked;
    }
  }
}
