export enum InterpolationType {
  Linear = "Linear",
  Exponential = "Exponential",
  Logarithmic = "Logarithmic",
  Hold = "Hold", // Step function
  Curved = "Curved", // CJC Kruger constrained cubic spline
}

export interface AutomationPoint {
  id: string;
  time: number; // In seconds (or beats, depending on implementation. Using seconds for AudioEngine sync)
  value: number; // Normalized value (0-1) or actual value depending on parameter?
  // Usually parameters handle normalization. Let's assume actual value for now.
  interpolation: InterpolationType;
}
