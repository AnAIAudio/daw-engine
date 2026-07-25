/**
 * Filename Template Parser
 *
 * Supported tokens:
 *   %s - Session name
 *   %n - Timespan name (range/region name)
 *   %d - Date (YYYY-MM-DD)
 *   %t - Time (HH-MM-SS)
 *   %f - Format (wav/mp3/ogg/flac)
 *   %r - Revision number (auto-increment)
 *   %b - Bit depth / bitrate
 *   %c - Channel config (stereo/mono)
 *   %T - Track name (for stem export)
 */

export interface FilenameTemplateContext {
  sessionName?: string;
  timespanName?: string;
  format?: string;
  revision?: number;
  bitDepthOrRate?: string;
  channelConfig?: string;
  trackName?: string;
}

/**
 * Resolve a filename template string into an actual filename.
 */
export function resolveFilenameTemplate(
  template: string,
  context: FilenameTemplateContext,
): string {
  const now = new Date();

  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  const timeStr = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("-");

  let result = template;

  result = result.replace(
    /%s/g,
    sanitizeFilename(context.sessionName || "Untitled"),
  );
  result = result.replace(
    /%n/g,
    sanitizeFilename(context.timespanName || "export"),
  );
  result = result.replace(/%d/g, dateStr);
  result = result.replace(/%t/g, timeStr);
  result = result.replace(/%f/g, context.format || "wav");
  result = result.replace(
    /%r/g,
    String(context.revision ?? 1).padStart(3, "0"),
  );
  result = result.replace(/%b/g, context.bitDepthOrRate || "");
  result = result.replace(/%c/g, context.channelConfig || "stereo");
  result = result.replace(/%T/g, sanitizeFilename(context.trackName || ""));

  // Remove double separators and trailing separators
  result = result.replace(/_{2,}/g, "_");
  result = result.replace(/-{2,}/g, "-");
  result = result.replace(/[_-]$/, "");

  return result || "export";
}

/**
 * Sanitize a string for use in filenames.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9가-힣ぁ-んァ-ヶー一-龥_\- ]/g, "_").trim();
}

/**
 * Get a human-readable preview of what tokens will resolve to.
 */
export function previewFilenameTemplate(
  template: string,
  context: FilenameTemplateContext,
): string {
  const resolved = resolveFilenameTemplate(template, context);
  const ext = context.format || "wav";
  return `${resolved}.${ext}`;
}

/**
 * List all supported tokens with descriptions.
 */
export function getTemplateTokens(): Array<{
  token: string;
  description: string;
}> {
  return [
    { token: "%s", description: "Session name" },
    { token: "%n", description: "Timespan / range name" },
    { token: "%d", description: "Date (YYYY-MM-DD)" },
    { token: "%t", description: "Time (HH-MM-SS)" },
    { token: "%f", description: "Format (wav/mp3/ogg/flac)" },
    { token: "%r", description: "Revision number" },
    { token: "%b", description: "Bit depth or bitrate" },
    { token: "%c", description: "Channel config (stereo/mono)" },
    { token: "%T", description: "Track name (stem export)" },
  ];
}
