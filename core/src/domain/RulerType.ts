/**
 * Ruler Type - which rulers are visible in the timeline
 */
export enum RulerType {
  /** Bar|Beat ruler (기본, 현재 구현) */
  BBT = "bbt",
  /** HH:MM:SS:FF timecode */
  TIMECODE = "timecode",
  /** Minutes:Seconds */
  MINSEC = "minsec",
  /** Sample count */
  SAMPLES = "samples",
  /** Marker ruler (마커 전용 행) */
  MARKERS = "markers",
  /** Loop/Punch range display */
  RANGES = "ranges",
  /** Tempo changes */
  TEMPO = "tempo",
}
