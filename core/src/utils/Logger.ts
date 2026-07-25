/**
 * Lightweight logger with configurable log levels.
 *
 * Prevents verbose debug/info messages from reaching the console in
 * production while still allowing warnings and errors through.
 *
 * Default level is WARN — set to DEBUG during development via
 * `logger.setLevel(LogLevel.DEBUG)`.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

class Logger {
  private level: LogLevel = LogLevel.WARN;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(tag: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) console.debug(`[${tag}]`, ...args);
  }

  info(tag: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) console.info(`[${tag}]`, ...args);
  }

  warn(tag: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) console.warn(`[${tag}]`, ...args);
  }

  error(tag: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) console.error(`[${tag}]`, ...args);
  }
}

export const logger = new Logger();
