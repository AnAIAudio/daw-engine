/**
 * Zoom Focus
 *
 * 줌 시 기준점을 결정합니다.
 */
export enum ZoomFocus {
  /** 뷰포트 왼쪽 기준 */
  LEFT = "left",
  /** 뷰포트 오른쪽 기준 */
  RIGHT = "right",
  /** 뷰포트 중앙 기준 */
  CENTER = "center",
  /** 플레이헤드 기준 */
  PLAYHEAD = "playhead",
  /** 마우스 위치 기준 (현재 구현) */
  MOUSE = "mouse",
  /** 편집 커서 기준 */
  EDIT_POINT = "edit_point",
}
