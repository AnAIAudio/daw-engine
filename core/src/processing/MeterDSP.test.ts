import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { LUFSReading } from "./MeterDSP";

// A synchronous DSP loop can stall Vitest itself. Run boundary cases in a
// worker so the regression fails within a deadline instead of hanging CI.
const meterSource = ts.transpileModule(
  readFileSync(new URL("./MeterDSP.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;

interface ProbeOptions {
  sampleRate: number;
  channelCount: number;
  scenario?: "partitions" | "channel-order" | "reset" | "partial" | "silence";
}

function probe(options: ProbeOptions): Promise<LUFSReading[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `${meterSource}
      const { parentPort, workerData } = require("node:worker_threads");
      const { sampleRate, channelCount, scenario = "partitions" } = workerData;
      const length = sampleRate;
      const signal = Array.from({ length: channelCount }, (_, channel) =>
        Float32Array.from({ length }, (_, frame) =>
          (0.1 + channel * 0.03) *
          Math.sin(2 * Math.PI * (431 + channel * 137) * frame / sampleRate)
        )
      );
      const createMeter = () => new exports.MeterDSP(exports.MeterType.LUFS, sampleRate, channelCount);
      const run = (pattern, direct = false, reverse = false) => {
        const meter = createMeter();
        let offset = 0;
        let block = 0;
        while (offset < length) {
          const size = Math.min(pattern[block++ % pattern.length], length - offset);
          const channels = signal.map(samples => samples.subarray(offset, offset + size));
          if (direct) {
            const order = Array.from({ length: channelCount }, (_, channel) => channel);
            if (reverse) order.reverse();
            for (const channel of order) meter.process(channels[channel], channel);
          } else {
            meter.processBlock(channels, size);
          }
          offset += size;
        }
        return meter.getLUFSReading();
      };
      let result;
      if (scenario === "reset") {
        const meter = createMeter();
        const window = Math.round(sampleRate * 0.1);
        meter.process(signal[0].subarray(0, window + 128), 0);
        meter.reset();
        meter.processBlock(Array.from({ length: channelCount }, () => new Float32Array(window)), window);
        result = [meter.getLUFSReading()];
      } else if (scenario === "partial") {
        const meter = createMeter();
        const window = Math.round(sampleRate * 0.1);
        meter.process(signal[0].subarray(0, window), 0);
        const before = meter.getLUFSReading();
        for (let channel = 1; channel < channelCount; channel++) {
          meter.process(signal[channel].subarray(0, window), channel);
        }
        result = [before, meter.getLUFSReading()];
      } else if (scenario === "silence") {
        const meter = createMeter();
        const channels = Array.from({ length: channelCount }, () => new Float32Array(128));
        for (let block = 0; block < 100; block++) meter.processBlock(channels, 128);
        result = [meter.getLUFSReading()];
      } else if (scenario === "channel-order") {
        result = [run([128]), run([128], true), run([128], true, true)];
      } else {
        result = [[length], [128], [256], [480], [1, 127, 4097, 64, 10000]].map(pattern => run(pattern));
      }
      parentPort.postMessage(result);`,
      { eval: true, workerData: options },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("MeterDSP did not finish within 3 seconds"));
    }, 3000);
    worker.once("message", (readings: LUFSReading[]) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(readings);
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function expectSameLoudness({
  actual,
  expected,
}: {
  actual: LUFSReading;
  expected: LUFSReading;
}): void {
  for (const key of [
    "momentary",
    "shortTerm",
    "integrated",
    "range",
    "truePeak",
  ] as const) {
    expect(actual[key], key).toBeCloseTo(expected[key], 10);
  }
}

describe("MeterDSP LUFS block boundaries", () => {
  it.each([
    { sampleRate: 44100, channelCount: 2 },
    { sampleRate: 48000, channelCount: 1 },
    { sampleRate: 48000, channelCount: 2 },
    { sampleRate: 48000, channelCount: 6 },
    { sampleRate: 96000, channelCount: 2 },
  ])(
    "keeps loudness independent of input partitions at $sampleRate Hz / $channelCount channels",
    async (options) => {
      const [reference, ...partitions] = await probe(options);
      expect(Number.isFinite(reference.integrated)).toBe(true);
      for (const reading of partitions) {
        expectSameLoudness({ actual: reading, expected: reference });
      }
    },
  );

  it("supports direct channel processing in either channel order", async () => {
    const [reference, forward, reverse] = await probe({
      sampleRate: 48000,
      channelCount: 2,
      scenario: "channel-order",
    });
    expectSameLoudness({ actual: forward, expected: reference });
    expectSameLoudness({ actual: reverse, expected: reference });
  });

  it("waits for the matching window from every channel before publishing loudness", async () => {
    const [partial, complete] = await probe({
      sampleRate: 48000,
      channelCount: 2,
      scenario: "partial",
    });
    expect(partial.integrated).toBe(-Infinity);
    expect(Number.isFinite(complete.integrated)).toBe(true);
  });

  it("discards pending channel windows on reset", async () => {
    const [reading] = await probe({
      sampleRate: 48000,
      channelCount: 2,
      scenario: "reset",
    });
    expect(reading.integrated).toBe(-Infinity);
    expect(reading.momentary).toBe(-Infinity);
  });

  it("returns silence readings after repeated stereo blocks", async () => {
    const [reading] = await probe({
      sampleRate: 48000,
      channelCount: 2,
      scenario: "silence",
    });
    expect(reading.integrated).toBe(-Infinity);
    expect(reading.momentary).toBe(-Infinity);
    expect(reading.truePeak).toBe(-Infinity);
  });
});
