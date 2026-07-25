import { AudioEngine } from "../../audio/AudioEngine";
import { CommandHistory } from "../CommandHistory";
import { AudioCommand } from "../types";
import { TrackNotFoundError, RangeNotFoundError } from "../../errors/DAWErrors";

/**
 * Extracts the payload type for a given set of command types from AudioCommand.
 */
export type ExtractPayload<T extends AudioCommand["type"]> =
  Extract<AudioCommand, { type: T }> extends { payload: infer P }
    ? P
    : undefined;

/**
 * Union of all possible payload types across all AudioCommands.
 */
export type AnyCommandPayload = ExtractPayload<AudioCommand["type"]>;

/**
 * Payload type for command handlers. Zod schema validation ensures type safety
 * at runtime; this interface allows flexible property access within handlers.
 */
export interface CommandHandlerPayload {
  [key: string]:
    | string
    | number
    | boolean
    | string[]
    | Record<string, unknown>
    | null
    | undefined;
}

/**
 * Command Handler Base Interface
 *
 * 각 Handler는 특정 카테고리의 command를 처리합니다.
 * - TransportHandler: 재생/정지/녹음
 * - TrackHandler: 트랙 관리
 * - RegionHandler: Region 편집
 * - RangeHandler: Range 관리
 * - AutomationHandler: Automation
 * - ExportHandler: Export
 */
export interface CommandHandler {
  /**
   * Command를 처리할 수 있는지 확인
   */
  canHandle(commandType: string): boolean;

  /**
   * Command 실행
   */
  execute(
    commandType: string,
    payload: CommandHandlerPayload | undefined,
    audioEngine: AudioEngine,
    history: CommandHistory,
  ): Promise<CommandResult>;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Helper: Track 조회 (없으면 TrackNotFoundError)
 */
export function getTrackOrThrow(audioEngine: AudioEngine, trackId: string) {
  const track = audioEngine.session.getTrack(trackId);
  if (!track) {
    throw new TrackNotFoundError(trackId);
  }
  return track;
}

/**
 * Helper: Range 조회 (없으면 RangeNotFoundError)
 */
export function getRangeOrThrow(audioEngine: AudioEngine, rangeId: string) {
  const range = audioEngine.session.getRange(rangeId);
  if (!range) {
    throw new RangeNotFoundError(rangeId);
  }
  return range;
}

/**
 * Type-safe payload field extractors.
 * Throw descriptive errors instead of silently returning undefined via `as` casts.
 */
export function requireString(
  payload: CommandHandlerPayload,
  key: string,
): string {
  const val = payload[key];
  if (typeof val !== "string")
    throw new Error(`Missing required string field: ${key}`);
  return val;
}

export function requireNumber(
  payload: CommandHandlerPayload,
  key: string,
): number {
  const val = payload[key];
  if (typeof val !== "number")
    throw new Error(`Missing required number field: ${key}`);
  return val;
}

export function optionalString(
  payload: CommandHandlerPayload,
  key: string,
): string | undefined {
  const val = payload[key];
  return typeof val === "string" ? val : undefined;
}

export function optionalNumber(
  payload: CommandHandlerPayload,
  key: string,
): number | undefined {
  const val = payload[key];
  return typeof val === "number" ? val : undefined;
}

export function requireBoolean(
  payload: CommandHandlerPayload,
  key: string,
): boolean {
  const val = payload[key];
  if (typeof val !== "boolean")
    throw new Error(`Missing required boolean field: ${key}`);
  return val;
}

export function optionalBoolean(
  payload: CommandHandlerPayload,
  key: string,
): boolean | undefined {
  const val = payload[key];
  return typeof val === "boolean" ? val : undefined;
}

export function requireStringArray(
  payload: CommandHandlerPayload,
  key: string,
): string[] {
  const val = payload[key];
  if (!Array.isArray(val))
    throw new Error(`Missing required string array field: ${key}`);
  return val;
}
