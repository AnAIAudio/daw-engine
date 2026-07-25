/**
 * Describes the properties and value mapping of an automatable parameter.
 *
 * Every automatable parameter (gain, pan, plugin knobs, etc.) has a range,
 * a default value, and potentially a non-linear mapping between the internal
 * representation and the user-facing interface value.
 */
export interface ParameterDescriptor {
  /** Minimum internal value */
  lower: number;
  /** Maximum internal value */
  upper: number;
  /** Default (neutral) internal value */
  normal: number;
  /** True if the parameter is a boolean toggle (0 or 1) */
  toggled: boolean;
  /** True if the parameter uses logarithmic scaling */
  logarithmic: boolean;
  /** Human-readable unit string (e.g. "dB", "Hz", "%") */
  unit: string;
  /**
   * Converts an internal value to the interface (normalized 0-1) representation.
   * @param value The internal value
   * @returns The normalized interface value (0-1)
   */
  internalToInterface(value: number): number;
  /**
   * Converts an interface (normalized 0-1) value to the internal representation.
   * @param value The normalized interface value (0-1)
   * @returns The internal value
   */
  interfaceToInternal(value: number): number;
}

/**
 * Gain parameter descriptor.
 * Maps gain in dB (-60 to +12) to a normalized 0-1 interface value
 * using a linear mapping.
 */
export const GainDescriptor: ParameterDescriptor = {
  lower: -60,
  upper: 12,
  normal: 0,
  toggled: false,
  logarithmic: false,
  unit: "dB",

  internalToInterface(value: number): number {
    return clamp((value - this.lower) / (this.upper - this.lower), 0, 1);
  },

  interfaceToInternal(value: number): number {
    return this.lower + clamp(value, 0, 1) * (this.upper - this.lower);
  },
};

/**
 * Pan parameter descriptor.
 * Maps pan from -1 (full left) to +1 (full right) with center at 0.
 */
export const PanDescriptor: ParameterDescriptor = {
  lower: -1,
  upper: 1,
  normal: 0,
  toggled: false,
  logarithmic: false,
  unit: "",

  internalToInterface(value: number): number {
    return clamp((value - this.lower) / (this.upper - this.lower), 0, 1);
  },

  interfaceToInternal(value: number): number {
    return this.lower + clamp(value, 0, 1) * (this.upper - this.lower);
  },
};

/**
 * Frequency parameter descriptor.
 * Maps frequency from 20 Hz to 20000 Hz using logarithmic scaling,
 * which matches human perception of pitch.
 */
export const FrequencyDescriptor: ParameterDescriptor = {
  lower: 20,
  upper: 20000,
  normal: 1000,
  toggled: false,
  logarithmic: true,
  unit: "Hz",

  internalToInterface(value: number): number {
    // Logarithmic mapping: interface = log(value/lower) / log(upper/lower)
    const clamped = clamp(value, this.lower, this.upper);
    if (clamped <= this.lower) return 0;
    return Math.log(clamped / this.lower) / Math.log(this.upper / this.lower);
  },

  interfaceToInternal(value: number): number {
    // Inverse logarithmic: value = lower * (upper/lower)^interface
    const clamped = clamp(value, 0, 1);
    return this.lower * Math.pow(this.upper / this.lower, clamped);
  },
};

/**
 * Creates a simple linear parameter descriptor with the given range.
 * @param lower Minimum value
 * @param upper Maximum value
 * @param normal Default value
 * @param unit Display unit
 * @returns A ParameterDescriptor with linear mapping
 */
export function createLinearDescriptor(
  lower: number,
  upper: number,
  normal: number,
  unit: string = "",
): ParameterDescriptor {
  return {
    lower,
    upper,
    normal,
    toggled: false,
    logarithmic: false,
    unit,

    internalToInterface(value: number): number {
      return clamp((value - this.lower) / (this.upper - this.lower), 0, 1);
    },

    interfaceToInternal(value: number): number {
      return this.lower + clamp(value, 0, 1) * (this.upper - this.lower);
    },
  };
}

/**
 * Creates a toggle (boolean) parameter descriptor.
 * @returns A ParameterDescriptor for on/off parameters
 */
export function createToggleDescriptor(): ParameterDescriptor {
  return {
    lower: 0,
    upper: 1,
    normal: 0,
    toggled: true,
    logarithmic: false,
    unit: "",

    internalToInterface(value: number): number {
      return value >= 0.5 ? 1 : 0;
    },

    interfaceToInternal(value: number): number {
      return value >= 0.5 ? 1 : 0;
    },
  };
}

/**
 * Clamps a value to the range [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
