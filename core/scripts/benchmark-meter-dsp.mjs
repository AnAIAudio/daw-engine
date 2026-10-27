// From the repository root:
// node core/scripts/benchmark-meter-dsp.mjs --before origin/main --runs 5 --timeout 1000 --output /tmp/meter-results.json
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, platform, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = "core/src/processing/MeterDSP.ts";
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index].replace(/^--/, "");
  if (
    !["before", "runs", "timeout", "output"].includes(key) ||
    args[index + 1] === undefined
  ) {
    throw new Error(
      "Expected --before REF, --runs N, --timeout MS or --output PATH",
    );
  }
  options[key] = args[index + 1];
}
const beforeRef = options.before ?? "origin/main";
const runs = Number(options.runs ?? 5);
const timeoutMs = Number(options.timeout ?? 1000);
if (
  !Number.isInteger(runs) ||
  runs < 1 ||
  !Number.isFinite(timeoutMs) ||
  timeoutMs <= 0
) {
  throw new Error(
    "--runs must be a positive integer and --timeout must be positive",
  );
}
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sources = {
  before: git("show", `${beforeRef}:${sourcePath}`),
  after: readFileSync(
    new URL("../src/processing/MeterDSP.ts", import.meta.url),
    "utf8",
  ),
};
const compiled = Object.fromEntries(
  Object.entries(sources).map(([version, source]) => [
    version,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
  ]),
);
const cases = [
  {
    name: "48k stereo / 128",
    sampleRate: 48000,
    channelCount: 2,
    blockSize: 128,
  },
  {
    name: "48k stereo / 256",
    sampleRate: 48000,
    channelCount: 2,
    blockSize: 256,
  },
  {
    name: "44.1k stereo / 128",
    sampleRate: 44100,
    channelCount: 2,
    blockSize: 128,
  },
  {
    name: "48k 6-channel / 128",
    sampleRate: 48000,
    channelCount: 6,
    blockSize: 128,
  },
  {
    name: "48k mono / 128",
    sampleRate: 48000,
    channelCount: 1,
    blockSize: 128,
  },
  {
    name: "48k stereo / 480",
    sampleRate: 48000,
    channelCount: 2,
    blockSize: 480,
  },
];

function measure({ version, input }) {
  return new Promise((resolve, reject) => {
    let completedBlocks = 0;
    const worker = new Worker(
      `${compiled[version]}
      const { parentPort, workerData } = require("node:worker_threads");
      const { sampleRate, channelCount, blockSize } = workerData;
      const channels = Array.from({ length: channelCount }, (_, channel) =>
        Float32Array.from({ length: sampleRate }, (_, frame) =>
          (0.1 + channel * 0.03) * Math.sin(2 * Math.PI * (431 + channel * 137) * frame / sampleRate)
        )
      );
      const warmup = new exports.MeterDSP(exports.MeterType.LUFS, sampleRate, channelCount);
      const warmupChannels = channels.map(samples => samples.subarray(0, 128));
      for (let block = 0; block < 8; block++) warmup.processBlock(warmupChannels, 128);
      const meter = new exports.MeterDSP(exports.MeterType.LUFS, sampleRate, channelCount);
      const blockTimes = [];
      parentPort.postMessage({ type: "ready" });
      for (let offset = 0; offset < sampleRate; offset += blockSize) {
        parentPort.postMessage({ type: "progress", completedBlocks: blockTimes.length });
        const size = Math.min(blockSize, sampleRate - offset);
        const block = channels.map(samples => samples.subarray(offset, offset + size));
        const start = performance.now();
        meter.processBlock(block, size);
        blockTimes.push(performance.now() - start);
      }
      parentPort.postMessage({ type: "complete", completedBlocks: blockTimes.length,
        processingMs: blockTimes.reduce((sum, value) => sum + value, 0),
        maxBlockMs: Math.max(...blockTimes), reading: meter.getLUFSReading() });`,
      { eval: true, workerData: input },
    );
    let timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Meter worker failed to initialize within 10 seconds"));
    }, 10000);
    worker.on("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          void worker.terminate();
          resolve({
            status: "timeout",
            completedBlocks,
            stalledBlock: completedBlocks + 1,
            timeoutMs,
          });
        }, timeoutMs);
      } else if (message.type === "progress") {
        completedBlocks = message.completedBlocks;
      } else {
        clearTimeout(timeout);
        void worker.terminate();
        const { type: _type, ...result } = message;
        resolve({ status: "complete", ...result });
      }
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const input of cases) {
  const entry = {
    ...input,
    audioSeconds: 1,
    expectedBlocks: Math.ceil(input.sampleRate / input.blockSize),
  };
  for (const version of ["before", "after"]) {
    const samples = [];
    for (let run = 0; run < runs; run++)
      samples.push(await measure({ version, input }));
    const completed = samples.filter((sample) => sample.status === "complete");
    entry[version] = {
      completedRuns: completed.length,
      timedOutRuns: runs - completed.length,
      completedBlocks: samples.map((sample) => sample.completedBlocks),
      ...(completed.length
        ? {
            medianProcessingMs: median(
              completed.map((sample) => sample.processingMs),
            ),
            maxBlockMs: Math.max(
              ...completed.map((sample) => sample.maxBlockMs),
            ),
          }
        : { stalledBlock: samples[0].stalledBlock }),
      samples,
    };
    console.log(
      `${input.name} ${version}: ${completed.length}/${runs} complete; ${completed.length ? `${entry[version].medianProcessingMs.toFixed(3)} ms median DSP time` : `stalled on block ${entry[version].stalledBlock}`}`,
    );
  }
  results.push(entry);
}
const report = {
  measuredAt: new Date().toISOString(),
  beforeCommit: git("rev-parse", beforeRef),
  checkoutCommit: git("rev-parse", "HEAD"),
  afterSourceSha256: createHash("sha256").update(sources.after).digest("hex"),
  environment: {
    node: process.version,
    typescript: ts.version,
    os: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
  },
  method: {
    runs,
    timeoutMs,
    audioSeconds: 1,
    warmupBlocks: 8,
    warmupBlockSize: 128,
    timing:
      "Sum of processBlock call durations; excludes source compilation, worker startup, PCM generation, slicing and progress messages. Timing covers synthetic PCM only; this is not a device or standards conformance test.",
  },
  results,
};
if (options.output)
  writeFileSync(options.output, JSON.stringify(report, null, 2) + "\n");
else console.log(JSON.stringify(report, null, 2));
