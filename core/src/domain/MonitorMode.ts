/**
 * Monitor Mode
 */
export enum MonitorMode {
  /** 녹음 중 = input, 재생 중 = disk */
  AUTO = "auto",
  /** 항상 입력 모니터링 */
  INPUT = "input",
  /** 항상 디스크 모니터링 */
  DISK = "disk",
  /** 외부 모니터링 (하드웨어) */
  EXTERNAL = "external",
}
