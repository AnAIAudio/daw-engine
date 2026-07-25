import { Processor, ProcessorId } from "./Processor";
import { Plugin, ParameterId } from "../plugins/Plugin";

/**
 * Default sample rate assumption for tail-time estimation when the actual
 * session sample rate is not available.
 */
const DEFAULT_SAMPLE_RATE = 44100;

/**
 * PluginInsert wraps a Plugin instance inside the Processor graph, bridging
 * the plugin parameter world with the route's latency-compensation and
 * tail-length bookkeeping.
 *
 * It automatically estimates processing latency and tail time based on the
 * plugin type and name, and re-evaluates those estimates whenever a plugin
 * parameter changes.
 */
export class PluginInsert extends Processor {
  private _plugin: Plugin;
  private _sampleRate: number;
  private _parameterSubscription: { dispose: () => void };

  constructor(
    id: ProcessorId,
    plugin: Plugin,
    sampleRate: number = DEFAULT_SAMPLE_RATE,
  ) {
    super(id, `Insert: ${plugin.name}`);
    this._plugin = plugin;
    this._sampleRate = sampleRate;

    // Initial latency / tail estimation based on the plugin's current state.
    this.updateLatencyFromPlugin();
    this.updateTailFromPlugin();

    // Re-estimate whenever a plugin parameter changes.
    this._parameterSubscription = this._plugin.parameterChanged.connect(
      (_change: { id: ParameterId; value: number }) => {
        this.updateLatencyFromPlugin();
        this.updateTailFromPlugin();
      },
    );
  }

  public get plugin(): Plugin {
    return this._plugin;
  }

  /** The sample rate used for time-to-sample conversions in tail estimation. */
  public get sampleRate(): number {
    return this._sampleRate;
  }

  public set sampleRate(rate: number) {
    if (rate > 0 && rate !== this._sampleRate) {
      this._sampleRate = rate;
      // Re-estimate with the new sample rate.
      this.updateLatencyFromPlugin();
      this.updateTailFromPlugin();
    }
  }

  // Proxy active state to plugin bypass if supported
  public set active(value: boolean) {
    super.active = value;
    // When bypassed, the processor introduces no latency or tail.
    if (!value) {
      this.setLatency(0);
      this.setTailLength(0);
    } else {
      this.updateLatencyFromPlugin();
      this.updateTailFromPlugin();
    }
  }

  public get active(): boolean {
    return super.active;
  }

  // ── Latency Estimation ──────────────────────────────────────────────────

  /**
   * Estimate latency (in samples) based on plugin name / type heuristics.
   *
   * Real-world plugins would report their exact latency; here we use
   * conservative estimates for common processor categories:
   *
   * - Linear-phase EQ: ~512 samples (FIR filter latency)
   * - Compressor / Limiter: ~64-256 samples (look-ahead)
   * - De-esser: ~64 samples
   * - Other effects / instruments / analyzers: 0
   */
  public updateLatencyFromPlugin(): void {
    if (!this.active) return;

    const nameLower = this._plugin.name.toLowerCase();
    let latency = 0;

    if (nameLower.includes("linear")) {
      // Linear-phase EQ – significant FIR latency
      latency = 512;
    } else if (nameLower.includes("comp") || nameLower.includes("limit")) {
      // Compressor / Limiter – look-ahead buffer
      // Scale with a "lookahead" parameter if available, otherwise default.
      const lookaheadParam = this._plugin.getParameter(
        "lookahead" as ParameterId,
      );
      if (lookaheadParam) {
        // Parameter value is a 0-1 normalised range; scale to 64-256 samples.
        latency = Math.round(64 + lookaheadParam.value * (256 - 64));
      } else {
        latency = 64;
      }
    } else if (nameLower.includes("de-ess") || nameLower.includes("deess")) {
      latency = 64;
    }

    this.setLatency(latency);
  }

  // ── Tail Time Estimation ────────────────────────────────────────────────

  /**
   * Estimate the tail length (in frames / samples) based on plugin name and
   * parameter state.
   *
   * - Reverb / convolution: 2-5 seconds, scaled by decay / wet parameters.
   * - Delay: delay-time * estimated feedback-loop count.
   * - Everything else: 0.
   */
  public updateTailFromPlugin(): void {
    if (!this.active) return;

    const nameLower = this._plugin.name.toLowerCase();
    let tailSeconds = 0;

    if (nameLower.includes("reverb") || nameLower.includes("convol")) {
      tailSeconds = this._estimateReverbTail();
    } else if (nameLower.includes("delay")) {
      tailSeconds = this._estimateDelayTail();
    }

    const tailFrames = Math.ceil(tailSeconds * this._sampleRate);
    this.setTailLength(tailFrames);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Estimate reverb tail between 2 and 5 seconds.
   * Uses 'decay' or 'time' parameters for the base, and 'wet' / 'mix' to
   * scale down when the effect is barely audible.
   */
  private _estimateReverbTail(): number {
    const baseTail = 2; // minimum tail in seconds
    const maxTail = 5;

    // Look for a decay / time parameter.
    const decayParam =
      this._plugin.getParameter("decay" as ParameterId) ??
      this._plugin.getParameter("time" as ParameterId);

    let tail: number;
    if (decayParam) {
      // Normalised 0-1 → 2-5 seconds.
      const norm =
        (decayParam.value - decayParam.min) /
        (decayParam.max - decayParam.min || 1);
      tail = baseTail + norm * (maxTail - baseTail);
    } else {
      tail = baseTail;
    }

    // Scale by wet/mix level – if wet is near zero the audible tail is negligible.
    const wetParam =
      this._plugin.getParameter("wet" as ParameterId) ??
      this._plugin.getParameter("mix" as ParameterId);
    if (wetParam) {
      const wetNorm =
        (wetParam.value - wetParam.min) / (wetParam.max - wetParam.min || 1);
      tail *= wetNorm;
    }

    return tail;
  }

  /**
   * Estimate delay tail based on delay-time and feedback.
   *
   * The effective tail is roughly `delayTime * loops` where loops is
   * derived from the feedback amount:  loops ≈ log(threshold) / log(feedback).
   * We cap at a sensible maximum (10 s).
   */
  private _estimateDelayTail(): number {
    const MAX_TAIL = 10; // seconds

    const timeParam =
      this._plugin.getParameter("time" as ParameterId) ??
      this._plugin.getParameter("delay" as ParameterId);
    const feedbackParam = this._plugin.getParameter("feedback" as ParameterId);

    // Default delay time 0.5 s if not found.
    let delayTime = 0.5;
    if (timeParam) {
      // Assume parameter value is already in seconds, or normalised 0-1 → 0-2 s.
      if (timeParam.max <= 1) {
        delayTime = timeParam.value * 2;
      } else {
        delayTime = timeParam.value;
      }
    }

    let loops = 1;
    if (feedbackParam) {
      const fbNorm =
        (feedbackParam.value - feedbackParam.min) /
        (feedbackParam.max - feedbackParam.min || 1);
      const fb = Math.min(fbNorm, 0.99); // clamp to avoid infinite loops
      if (fb > 0.01) {
        // Number of iterations until signal drops below -60 dB.
        const threshold = 0.001; // -60 dB
        loops = Math.ceil(Math.log(threshold) / Math.log(fb));
      }
    }

    return Math.min(delayTime * loops, MAX_TAIL);
  }

  /**
   * Dispose of internal subscriptions.  Call when removing the insert from
   * the processing chain.
   */
  public dispose(): void {
    this._parameterSubscription.dispose();
  }
}
