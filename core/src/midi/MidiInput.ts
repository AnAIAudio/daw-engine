import { Signal } from "../lib/Signal";

import { logger } from "../utils/Logger";
export interface MidiNoteOnEvent {
  pitch: number;
  velocity: number;
  channel: number;
}

export interface MidiNoteOffEvent {
  pitch: number;
  channel: number;
}

export interface MidiControlChangeEvent {
  controller: number;
  value: number;
  channel: number;
}

/**
 * Singleton class wrapping the Web MIDI API (navigator.requestMIDIAccess).
 * Parses raw MIDI messages and emits strongly-typed signals.
 */
export class MidiInput {
  private static instance: MidiInput;

  private midiAccess: MIDIAccess | null = null;
  private activeInput: MIDIInput | null = null;
  private _initialized = false;

  // Signals
  public readonly noteOn = new Signal<MidiNoteOnEvent>();
  public readonly noteOff = new Signal<MidiNoteOffEvent>();
  public readonly controlChange = new Signal<MidiControlChangeEvent>();
  public readonly deviceListChanged = new Signal<void>();

  private constructor() {}

  public static getInstance(): MidiInput {
    if (!MidiInput.instance) {
      MidiInput.instance = new MidiInput();
    }
    return MidiInput.instance;
  }

  /** For testing – reset singleton */
  public static resetInstance(): void {
    if (MidiInput.instance) {
      MidiInput.instance.dispose();
    }
    MidiInput.instance = undefined as unknown as MidiInput;
  }

  public get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Request MIDI access from the browser.
   * Must be called before using any other methods.
   */
  public async initialize(): Promise<boolean> {
    if (this._initialized) return true;

    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      logger.warn("MidiInput", "Web MIDI API not available");
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this._initialized = true;

      // Listen for device connect/disconnect
      this.midiAccess.onstatechange = () => {
        this.deviceListChanged.emit();
      };

      logger.debug("MidiInput", "MIDI access granted");
      return true;
    } catch (err) {
      logger.warn("MidiInput", "Failed to get MIDI access:", err);
      return false;
    }
  }

  /**
   * List all available MIDI input devices.
   */
  public getInputDevices(): MIDIInput[] {
    if (!this.midiAccess) return [];
    return Array.from(this.midiAccess.inputs.values());
  }

  /**
   * Get the currently active MIDI input device ID.
   */
  public getActiveInputId(): string | null {
    return this.activeInput?.id ?? null;
  }

  /**
   * Select an active MIDI input device by ID.
   * Pass null to deselect.
   */
  public setActiveInput(inputId: string | null): void {
    // Disconnect from the previous input
    if (this.activeInput) {
      this.activeInput.onmidimessage = null;
      this.activeInput = null;
    }

    if (!inputId || !this.midiAccess) return;

    const input = this.midiAccess.inputs.get(inputId);
    if (!input) {
      logger.warn("MidiInput", `MIDI input device not found: ${inputId}`);
      return;
    }

    this.activeInput = input;
    this.activeInput.onmidimessage = (event: MIDIMessageEvent) => {
      this.handleMidiMessage(event);
    };

    logger.debug("MidiInput", `Active input set: ${input.name} (${inputId})`);
  }

  /**
   * Parse raw MIDI messages and emit appropriate signals.
   */
  private handleMidiMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) return;

    const statusByte = data[0];
    const messageType = statusByte & 0xf0;
    const channel = statusByte & 0x0f;

    switch (messageType) {
      case 0x90: {
        // Note On
        const pitch = data[1];
        const velocity = data.length > 2 ? data[2] : 0;
        if (velocity === 0) {
          // Velocity 0 note-on is equivalent to note-off
          this.noteOff.emit({ pitch, channel });
        } else {
          this.noteOn.emit({ pitch, velocity, channel });
        }
        break;
      }
      case 0x80: {
        // Note Off
        const pitch = data[1];
        this.noteOff.emit({ pitch, channel });
        break;
      }
      case 0xb0: {
        // Control Change
        const controller = data[1];
        const value = data.length > 2 ? data[2] : 0;
        this.controlChange.emit({ controller, value, channel });
        break;
      }
      // Additional message types can be handled here
    }
  }

  /**
   * Clean up resources.
   */
  public dispose(): void {
    if (this.activeInput) {
      this.activeInput.onmidimessage = null;
      this.activeInput = null;
    }
    this.noteOn.clear();
    this.noteOff.clear();
    this.controlChange.clear();
    this.deviceListChanged.clear();
    this._initialized = false;
    this.midiAccess = null;
  }
}
