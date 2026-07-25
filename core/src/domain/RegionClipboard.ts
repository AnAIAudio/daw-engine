import { Region } from "./Region";
import { TrackId, SourceId, FrameCount } from "./types";

/**
 * Region Clipboard Data
 *
 * Copy된 Region의 정보를 저장합니다.
 */
export interface ClipboardRegionData {
  sourceId: SourceId;
  start: FrameCount;
  length: FrameCount;
  originalTrackId: TrackId;
  name: string;
}

/**
 * Region Clipboard
 *
 * Region copy/paste 기능을 위한 클립보드입니다.
 * Singleton 패턴으로 구현됩니다.
 */
export class RegionClipboard {
  private static instance: RegionClipboard;
  private _clipboardData: ClipboardRegionData[] = [];
  private _pasteCount: number = 0;

  private constructor() {}

  public static getInstance(): RegionClipboard {
    if (!RegionClipboard.instance) {
      RegionClipboard.instance = new RegionClipboard();
    }
    return RegionClipboard.instance;
  }

  /**
   * Region을 클립보드에 복사
   */
  public copy(regions: Region[], trackIds: TrackId[]): void {
    if (regions.length !== trackIds.length) {
      throw new Error("Regions and trackIds length mismatch");
    }

    this._clipboardData = regions.map((region, index) => ({
      sourceId: region.sourceId,
      start: region.start,
      length: region.length,
      originalTrackId: trackIds[index],
      name: region.name || "Region",
    }));
  }

  /**
   * 클립보드에서 Region 데이터 가져오기
   */
  public getClipboardData(): ReadonlyArray<ClipboardRegionData> {
    return this._clipboardData;
  }

  /**
   * 클립보드가 비어있는지 확인
   */
  public isEmpty(): boolean {
    return this._clipboardData.length === 0;
  }

  /**
   * 클립보드 비우기
   */
  public clear(): void {
    this._clipboardData = [];
    this._pasteCount = 0;
  }

  /**
   * Paste count for offset tracking.
   */
  public get pasteCount(): number {
    return this._pasteCount;
  }

  public incrementPasteCount(): void {
    this._pasteCount++;
  }

  /**
   * Reset paste count.
   * Called on undo/redo.
   */
  public resetPasteCount(): void {
    this._pasteCount = 0;
  }
}
