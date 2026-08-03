import { describe, expect, it } from "vitest";

import { SessionArchive } from "./SessionArchive";

describe("SessionArchive", () => {
  it("writes the DAWE magic bytes", async () => {
    const archive = new SessionArchive();

    const archiveBlob = await archive.createArchive('{"name":"test"}', []);
    const archiveBytes = new Uint8Array(await archiveBlob.arrayBuffer());

    expect(new TextDecoder().decode(archiveBytes.slice(0, 4))).toBe("DAWE");
  });

  it("extracts an archive created with the current format", async () => {
    const archive = new SessionArchive();
    const sessionData = '{"name":"test"}';

    const archiveBlob = await archive.createArchive(sessionData, []);
    const extractedArchive = await archive.extractArchive(archiveBlob);

    expect(extractedArchive.sessionData).toBe(sessionData);
    expect(extractedArchive.sources).toEqual([]);
    expect(extractedArchive.metadata.version).toBe("1.0.0");
  });
});
