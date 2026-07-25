/**
 * Mouse Mode
 *
 * 에디터의 마우스 동작 모드를 결정합니다.
 */
export enum MouseMode {
  /** 리전 선택/이동 (기본) */
  OBJECT = "object",
  /** 시간 범위 선택 */
  RANGE = "range",
  /** 리전 분할 */
  CUT = "cut",
  /** MIDI 노트 그리기 */
  DRAW = "draw",
  /** 리전 내부 편집 (오토메이션 포인트 등) */
  CONTENT = "content",
  /** 리전 시청 (클릭하면 재생) */
  AUDITION = "audition",
  /** 리전 타임 스트레치 */
  STRETCH = "stretch",
  /** 리전 내부 편집 (노트/오토메이션) */
  INTERNAL_EDIT = "internal_edit",
}
