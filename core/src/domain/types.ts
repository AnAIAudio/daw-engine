export type FrameCount = number;
export type SampleRate = number;
export type Gain = number; // 0.0 to 1.0+ (linear)
export type DB = number; // Decibels

export interface MusicTime {
  bar: number;
  beat: number;
  tick: number;
}

export type ProcessorId = string;
export type RouteId = string;
export type TrackId = string;
export type RegionId = string;
export type SourceId = string;
export type RangeId = string;

export enum ProcessorType {
  FADER = "FADER",
  TRIM = "TRIM",
  METER = "METER",
  PLUGIN = "PLUGIN",
  PANNER = "PANNER",
  POLARITY = "POLARITY",
  SEND = "SEND",
}

export type ProcessorPosition = "pre" | "post";
