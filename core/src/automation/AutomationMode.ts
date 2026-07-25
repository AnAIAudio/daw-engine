/**
 * Automation Mode
 */
export enum AutomationMode {
  /** 오토메이션 무시, 수동 조작만 */
  OFF = "off",
  /** 기록된 커브 따라 재생 */
  READ = "read",
  /** 재생 중 파라미터 조작을 기록 (기존 데이터 덮어씀) */
  WRITE = "write",
  /** 터치(조작) 시에만 기록, 놓으면 기존 데이터 유지 */
  TOUCH = "touch",
  /** Touch와 유사하지만 놓은 후에도 마지막 값 유지 */
  LATCH = "latch",
}
