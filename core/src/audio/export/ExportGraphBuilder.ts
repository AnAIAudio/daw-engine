import {
  ExportConfig,
  ExportFormat,
  ExportSampleFormat,
} from "../../domain/ExportConfig";
import { DitherType } from "../../utils/DitherProcessor";

/**
 * Analysis results from the analyzer node.
 */
export interface ExportAnalysis {
  peakDb: number;
  rmsDb: number;
  lufs: number;
  truePeakDb: number;
  dcOffset: number;
  clippedSamples: number;
}

/**
 * A single processing node in the export graph.
 * Each node receives multi-channel audio (Float32Array[]) and returns processed arrays.
 */
export interface ExportNode {
  id: string;
  type:
    | "source"
    | "normalize"
    | "limiter"
    | "dither"
    | "encoder"
    | "analyzer"
    | "silence_trim"
    | "gain"
    | "sample_rate_convert";
  process(
    buffer: Float32Array[],
    sampleRate: number,
  ): Float32Array[] | Promise<Float32Array[]>;
}

/**
 * Builds a dynamic processing chain for audio export.
 *
 * Instead of a fixed pipeline (as in OfflineExporter), ExportGraphBuilder
 * assembles an ordered sequence of ExportNode instances based on the
 * ExportConfig.  Custom nodes can be inserted at any position to extend
 * the chain without modifying the core logic.
 */
export class ExportGraphBuilder {
  private _nodes: ExportNode[] = [];
  private _sampleRate: number;
  private _channelCount: number;
  private _config: ExportConfig;

  constructor(config: ExportConfig) {
    this._config = config;
    this._sampleRate = config.sampleRate;
    this._channelCount = config.exportMasterOnly ? 2 : 2; // default stereo
    this.buildFromConfig(config);
  }

  // ------------------------------------------------------------------ graph
  /**
   * Build the processing graph from an ExportConfig.
   * Clears any existing nodes and re-creates the chain.
   */
  public buildFromConfig(config: ExportConfig): void {
    this._nodes = [];
    this._config = config;
    this._sampleRate = config.sampleRate;

    // 1. Silence trim (before everything else)
    if (config.trimSilence) {
      this._nodes.push(ExportGraphBuilder.createSilenceTrimNode(-60));
    }

    // 2. Normalization
    if (config.normalize) {
      const mode = config.normalizeMode ?? "peak";
      const targetLevel =
        mode === "lufs"
          ? (config.targetLufs ?? -14)
          : (config.targetPeakDb ?? -1);
      this._nodes.push(
        ExportGraphBuilder.createNormalizeNode(mode, targetLevel),
      );
    }

    // 3. True-peak limiter
    if (config.truePeakLimit) {
      this._nodes.push(
        ExportGraphBuilder.createTruePeakLimiterNode(
          config.truePeakCeiling ?? -1.0,
        ),
      );
    }

    // 4. Dithering (only when reducing bit depth below 32-bit float)
    if (config.ditherType && config.ditherType !== DitherType.NONE) {
      const targetBits =
        config.sampleFormat === ExportSampleFormat.INT16
          ? 16
          : config.sampleFormat === ExportSampleFormat.INT24
            ? 24
            : 32;
      if (targetBits < 32) {
        const ditherTypeMap: Record<string, "none" | "triangular" | "shaped"> =
          {
            [DitherType.NONE]: "none",
            [DitherType.TPDF]: "triangular",
            [DitherType.SHAPED]: "shaped",
          };
        this._nodes.push(
          ExportGraphBuilder.createDitherNode(
            ditherTypeMap[config.ditherType] ?? "none",
            targetBits,
          ),
        );
      }
    }

    // 5. Final analyzer (captures stats of the processed audio)
    this._nodes.push(ExportGraphBuilder.createAnalyzerNode());
  }

  // -------------------------------------------------------- node management
  /**
   * Add a node to the graph.
   * @param node   The node to insert.
   * @param position  Optional zero-based index. Appends if omitted.
   */
  public addNode(node: ExportNode, position?: number): void {
    if (
      position !== undefined &&
      position >= 0 &&
      position <= this._nodes.length
    ) {
      this._nodes.splice(position, 0, node);
    } else {
      this._nodes.push(node);
    }
  }

  /**
   * Remove a node by id.
   */
  public removeNode(id: string): void {
    this._nodes = this._nodes.filter((n) => n.id !== id);
  }

  /**
   * Get the current ordered list of nodes (read-only copy).
   */
  public getNodes(): ReadonlyArray<ExportNode> {
    return [...this._nodes];
  }

  // --------------------------------------------------------------- process
  /**
   * Process multi-channel audio through every node in sequence.
   */
  public async processBuffer(
    inputBuffer: Float32Array[],
  ): Promise<Float32Array[]> {
    let buffer = inputBuffer;
    for (const node of this._nodes) {
      buffer = await node.process(buffer, this._sampleRate);
    }
    return buffer;
  }

  /**
   * Encode the processed buffer into a Blob according to the config format.
   * This is a lightweight wrapper that delegates to format-specific logic.
   */
  public async encode(buffer: Float32Array[]): Promise<Blob> {
    const format = this._config.format;
    const sampleRate = this._sampleRate;

    switch (format) {
      case ExportFormat.WAV:
      case "wav" as ExportFormat:
        return this._encodeWav(buffer, sampleRate, this._config.sampleFormat);
      case ExportFormat.FLAC:
      case "flac" as ExportFormat:
        return this._encodeRaw(buffer, "audio/flac");
      case ExportFormat.OGG:
      case "ogg" as ExportFormat:
        return this._encodeRaw(buffer, "audio/ogg");
      case ExportFormat.MP3:
      case "mp3" as ExportFormat:
        return this._encodeRaw(buffer, "audio/mp3");
      default:
        return this._encodeWav(buffer, sampleRate, this._config.sampleFormat);
    }
  }

  // ===================================================================
  //  Built-in node factories
  // ===================================================================

  /**
   * Create a normalization node.
   * @param mode        'peak' or 'lufs'
   * @param targetLevel Target level in dB (peak) or LUFS
   */
  static createNormalizeNode(
    mode: "peak" | "lufs",
    targetLevel: number,
  ): ExportNode {
    return {
      id: `normalize-${mode}`,
      type: "normalize",
      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        if (mode === "peak") {
          // Peak normalization
          let maxPeak = 0;
          for (const ch of buffer) {
            for (let i = 0; i < ch.length; i++) {
              const abs = Math.abs(ch[i]);
              if (abs > maxPeak) maxPeak = abs;
            }
          }
          if (maxPeak === 0) return buffer;

          const targetLinear = Math.pow(10, targetLevel / 20);
          const gain = targetLinear / maxPeak;

          for (const ch of buffer) {
            for (let i = 0; i < ch.length; i++) {
              ch[i] *= gain;
            }
          }
        } else {
          // Simplified LUFS-style normalization
          // Compute integrated loudness using K-weighted RMS approximation
          let sumSquared = 0;
          let totalSamples = 0;
          for (const ch of buffer) {
            for (let i = 0; i < ch.length; i++) {
              sumSquared += ch[i] * ch[i];
            }
            totalSamples += ch.length;
          }
          if (totalSamples === 0 || sumSquared === 0) return buffer;

          const rms = Math.sqrt(sumSquared / totalSamples);
          const currentLufs = 20 * Math.log10(rms) - 0.691; // simplified K-weighting offset
          const gainDb = targetLevel - currentLufs;
          const gainLinear = Math.pow(10, gainDb / 20);

          for (const ch of buffer) {
            for (let i = 0; i < ch.length; i++) {
              ch[i] *= gainLinear;
            }
          }
        }
        return buffer;
      },
    };
  }

  /**
   * Create a true-peak limiter node.
   * @param ceiling  Maximum true-peak level in dBTP (e.g. -1.0)
   */
  static createTruePeakLimiterNode(ceiling: number): ExportNode {
    return {
      id: "true-peak-limiter",
      type: "limiter",
      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        const ceilingLinear = Math.pow(10, ceiling / 20);
        const attack = 0.001; // ~1 ms in samples (simplified)
        const release = 0.05; // ~50 ms

        for (const ch of buffer) {
          let envelope = 0;
          for (let i = 0; i < ch.length; i++) {
            const abs = Math.abs(ch[i]);
            // Simple peak follower
            if (abs > envelope) {
              envelope = abs + attack * (abs - envelope);
            } else {
              envelope = abs + (1 - release) * (envelope - abs);
            }

            // Apply gain reduction when envelope exceeds ceiling
            if (envelope > ceilingLinear) {
              ch[i] *= ceilingLinear / envelope;
            }
          }
        }
        return buffer;
      },
    };
  }

  /**
   * Create a dither node.
   * @param type      'none', 'triangular', or 'shaped'
   * @param bitDepth  Target bit depth (16 or 24)
   */
  static createDitherNode(
    type: "none" | "triangular" | "shaped",
    bitDepth: number,
  ): ExportNode {
    return {
      id: `dither-${type}-${bitDepth}`,
      type: "dither",
      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        if (type === "none") return buffer;

        const quantizationStep = 1.0 / Math.pow(2, bitDepth - 1);
        const scale = 1.0 / quantizationStep;

        for (const ch of buffer) {
          let previousError = 0;
          for (let i = 0; i < ch.length; i++) {
            const r1 = Math.random();
            const r2 = Math.random();
            const dither = (r1 - r2) * quantizationStep;

            if (type === "shaped") {
              const shaped = ch[i] + dither - previousError * 0.5;
              const quantized = Math.round(shaped * scale) / scale;
              previousError = quantized - ch[i];
              ch[i] = quantized;
            } else {
              // triangular (TPDF)
              const quantized = Math.round((ch[i] + dither) * scale) / scale;
              ch[i] = quantized;
            }
          }
        }
        return buffer;
      },
    };
  }

  /**
   * Create a silence-trimming node.
   * Removes leading and trailing silence below a threshold.
   * @param thresholdDb  Silence threshold in dBFS (e.g. -60)
   */
  static createSilenceTrimNode(thresholdDb: number): ExportNode {
    return {
      id: "silence-trim",
      type: "silence_trim",
      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        if (buffer.length === 0 || buffer[0].length === 0) return buffer;

        const thresholdLinear = Math.pow(10, thresholdDb / 20);
        const length = buffer[0].length;

        // Find first sample above threshold (across all channels)
        let startSample = 0;
        outer_start: for (let i = 0; i < length; i++) {
          for (const ch of buffer) {
            if (Math.abs(ch[i]) > thresholdLinear) {
              startSample = i;
              break outer_start;
            }
          }
        }

        // Find last sample above threshold
        let endSample = length - 1;
        outer_end: for (let i = length - 1; i >= startSample; i--) {
          for (const ch of buffer) {
            if (Math.abs(ch[i]) > thresholdLinear) {
              endSample = i;
              break outer_end;
            }
          }
        }

        // If no signal found at all, return a single-sample silence
        if (startSample > endSample) {
          return buffer.map(() => new Float32Array(1));
        }

        const trimmedLength = endSample - startSample + 1;
        return buffer.map((ch) =>
          ch.slice(startSample, startSample + trimmedLength),
        );
      },
    };
  }

  /**
   * Create a gain node.
   * @param gainDb  Gain in decibels
   */
  static createGainNode(gainDb: number): ExportNode {
    return {
      id: `gain-${gainDb}dB`,
      type: "gain",
      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        const gainLinear = Math.pow(10, gainDb / 20);
        for (const ch of buffer) {
          for (let i = 0; i < ch.length; i++) {
            ch[i] *= gainLinear;
          }
        }
        return buffer;
      },
    };
  }

  /**
   * Create a sample-rate conversion node.
   * Uses linear interpolation for simplicity; a production implementation
   * would use windowed sinc interpolation.
   * @param fromRate  Source sample rate
   * @param toRate    Target sample rate
   */
  static createSampleRateConverter(
    fromRate: number,
    toRate: number,
  ): ExportNode {
    return {
      id: `src-${fromRate}-${toRate}`,
      type: "sample_rate_convert",
      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        if (fromRate === toRate) return buffer;

        const ratio = fromRate / toRate;
        const newLength = Math.round(buffer[0].length / ratio);
        const result: Float32Array[] = [];

        for (const ch of buffer) {
          const output = new Float32Array(newLength);
          for (let i = 0; i < newLength; i++) {
            const srcPos = i * ratio;
            const idx = Math.floor(srcPos);
            const frac = srcPos - idx;

            if (idx + 1 < ch.length) {
              // Linear interpolation
              output[i] = ch[idx] * (1 - frac) + ch[idx + 1] * frac;
            } else if (idx < ch.length) {
              output[i] = ch[idx];
            }
          }
          result.push(output);
        }
        return result;
      },
    };
  }

  /**
   * Create an analyzer node that measures audio characteristics
   * without modifying the signal (pass-through).
   */
  static createAnalyzerNode(): ExportNode & { getAnalysis(): ExportAnalysis } {
    let analysis: ExportAnalysis = {
      peakDb: -Infinity,
      rmsDb: -Infinity,
      lufs: -Infinity,
      truePeakDb: -Infinity,
      dcOffset: 0,
      clippedSamples: 0,
    };

    const node: ExportNode & { getAnalysis(): ExportAnalysis } = {
      id: "analyzer",
      type: "analyzer",

      process(buffer: Float32Array[], _sampleRate: number): Float32Array[] {
        let maxPeak = 0;
        let sumSquared = 0;
        let totalSamples = 0;
        let dcSum = 0;
        let clipped = 0;
        let truePeak = 0;

        for (const ch of buffer) {
          for (let i = 0; i < ch.length; i++) {
            const sample = ch[i];
            const abs = Math.abs(sample);

            if (abs > maxPeak) maxPeak = abs;
            sumSquared += sample * sample;
            dcSum += sample;
            totalSamples++;

            if (abs >= 1.0) clipped++;

            // Simplified true-peak detection via 4x oversampling estimation
            // In production, this would use proper FIR interpolation
            if (i > 0) {
              const interpolated = Math.abs((ch[i - 1] + ch[i]) / 2);
              if (interpolated > truePeak) truePeak = interpolated;
            }
            if (abs > truePeak) truePeak = abs;
          }
        }

        const rms = totalSamples > 0 ? Math.sqrt(sumSquared / totalSamples) : 0;
        const dc = totalSamples > 0 ? dcSum / totalSamples : 0;

        analysis = {
          peakDb: maxPeak > 0 ? 20 * Math.log10(maxPeak) : -Infinity,
          rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
          lufs: rms > 0 ? 20 * Math.log10(rms) - 0.691 : -Infinity,
          truePeakDb: truePeak > 0 ? 20 * Math.log10(truePeak) : -Infinity,
          dcOffset: dc,
          clippedSamples: clipped,
        };

        // Pass through unmodified
        return buffer;
      },

      getAnalysis(): ExportAnalysis {
        return { ...analysis };
      },
    };

    return node;
  }

  // ===================================================================
  //  Private helpers
  // ===================================================================

  /**
   * Encode multi-channel Float32Array[] as a WAV Blob.
   * Supports int16, int24, and float32.
   */
  private _encodeWav(
    buffer: Float32Array[],
    sampleRate: number,
    sampleFormat: ExportSampleFormat,
  ): Blob {
    const numChannels = buffer.length;
    const numSamples = buffer[0]?.length ?? 0;

    let bytesPerSample: number;
    let audioFormat: number; // 1 = PCM integer, 3 = IEEE float
    switch (sampleFormat) {
      case ExportSampleFormat.INT16:
        bytesPerSample = 2;
        audioFormat = 1;
        break;
      case ExportSampleFormat.INT24:
        bytesPerSample = 3;
        audioFormat = 1;
        break;
      case ExportSampleFormat.FLOAT32:
      default:
        bytesPerSample = 4;
        audioFormat = 3;
        break;
    }

    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numSamples * blockAlign;
    const headerSize = 44;
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    this._writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    this._writeString(view, 8, "WAVE");

    // fmt chunk
    this._writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, audioFormat, true); // audio format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);

    // data chunk
    this._writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Interleave and write samples
    let offset = headerSize;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = buffer[ch]?.[i] ?? 0;
        switch (sampleFormat) {
          case ExportSampleFormat.INT16: {
            const clamped = Math.max(-1, Math.min(1, sample));
            const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
            view.setInt16(offset, int16, true);
            offset += 2;
            break;
          }
          case ExportSampleFormat.INT24: {
            const clamped = Math.max(-1, Math.min(1, sample));
            const int24 = Math.round(clamped * 0x7fffff);
            view.setUint8(offset, int24 & 0xff);
            view.setUint8(offset + 1, (int24 >> 8) & 0xff);
            view.setUint8(offset + 2, (int24 >> 16) & 0xff);
            offset += 3;
            break;
          }
          case ExportSampleFormat.FLOAT32:
          default:
            view.setFloat32(offset, sample, true);
            offset += 4;
            break;
        }
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  /**
   * Wrap raw Float32 data in a generic Blob (placeholder for formats
   * that require external encoders such as MP3, OGG, FLAC).
   */
  private _encodeRaw(buffer: Float32Array[], mimeType: string): Blob {
    // Interleave channels into a single Float32Array
    const numChannels = buffer.length;
    const numSamples = buffer[0]?.length ?? 0;
    const interleaved = new Float32Array(numChannels * numSamples);
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        interleaved[i * numChannels + ch] = buffer[ch]?.[i] ?? 0;
      }
    }
    return new Blob([interleaved.buffer], { type: mimeType });
  }

  private _writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
