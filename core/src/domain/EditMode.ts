/**
 * Edit Mode
 *
 * 리전 이동/삭제 시 주변 리전의 반응을 결정합니다.
 */
export enum EditMode {
  /** 자유 이동 (겹침 허용) */
  SLIDE = "slide",
  /** 이동/삭제 시 뒤 리전 자동 밀림 */
  RIPPLE = "ripple",
  /** 리전 위치 잠금 (이동 불가) */
  LOCK = "lock",
}
