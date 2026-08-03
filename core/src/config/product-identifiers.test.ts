import { describe, expect, it } from "vitest";

import {
  BWF_ORIGINATOR_REFERENCE_PREFIX,
  DAW_DATABASE_NAME,
  KEY_BINDINGS_STORAGE_KEY,
  PLUGIN_PRESET_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
} from "./product-identifiers";

describe("product identifiers", () => {
  it("uses the anaidev namespace for browser persistence", () => {
    expect(DAW_DATABASE_NAME).toBe("anaidev-daw");
    expect(PLUGIN_PRESET_STORAGE_KEY).toBe("anaidev-plugin-presets");
    expect(KEY_BINDINGS_STORAGE_KEY).toBe("anaidev-keybindings");
    expect(PREFERENCES_STORAGE_KEY).toBe("anaidev-preferences");
  });

  it("uses the anaidev prefix for BWF originator references", () => {
    expect(BWF_ORIGINATOR_REFERENCE_PREFIX).toBe("ANAIDEV");
  });
});
