/**
 * Record Mode
 */
export enum RecordMode {
  /** 기존 위에 레이어 추가 */
  SOUND_ON_SOUND = "sound_on_sound",
  /** 기존 삭제 후 대체 */
  NON_LAYERED = "non_layered",
  /** 별도 레이어에 기록 */
  LAYERED = "layered",
}
