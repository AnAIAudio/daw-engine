import { Signal } from "../lib/Signal";

/**
 * SessionArchive packages a session and all its referenced audio files
 * into a single downloadable archive.
 *
 * In the browser context, this creates a custom binary bundle containing:
 * - session.json (the serialized session state)
 * - audio sources (all source audio files as blobs)
 * - metadata.json (archive metadata)
 *
 * Binary format:
 * [4 bytes magic: "DRPA"]
 * [4 bytes version: 1]
 * [4 bytes metadata JSON length]
 * [metadata JSON]
 * [4 bytes session JSON length]
 * [session JSON]
 * [4 bytes source count]
 * For each source:
 *   [4 bytes name length]
 *   [name UTF-8]
 *   [4 bytes blob size]
 *   [blob data]
 */

export interface ArchiveMetadata {
  version: string;
  createdAt: string;
  sessionName: string;
  sourceCount: number;
  totalSize: number;
}

export interface ExtractedArchive {
  sessionData: string;
  sources: Array<{ name: string; blob: Blob }>;
  metadata: ArchiveMetadata;
}

/** Magic bytes identifying a drop.ai archive: "DRPA" */
const ARCHIVE_MAGIC = new Uint8Array([0x44, 0x52, 0x50, 0x41]); // "DRPA"
const ARCHIVE_FORMAT_VERSION = 1;

export class SessionArchive {
  public readonly progress = new Signal<number>();

  /**
   * Create an archive from session data and audio sources.
   *
   * @param sessionData  JSON string of the serialized session.
   * @param sources      Array of audio sources to include.
   * @param metadata     Optional metadata overrides.
   * @returns A Blob containing the packed archive.
   */
  async createArchive(
    sessionData: string,
    sources: Array<{ name: string; url: string; blob: Blob }>,
    metadata?: Partial<ArchiveMetadata>,
  ): Promise<Blob> {
    this.progress.emit(0);

    const encoder = new TextEncoder();

    // Convert all source blobs to ArrayBuffers up front
    const sourceBuffers: Array<{ name: string; data: ArrayBuffer }> = [];
    let totalSourceSize = 0;
    for (let i = 0; i < sources.length; i++) {
      const data = await sources[i].blob.arrayBuffer();
      sourceBuffers.push({ name: sources[i].name, data });
      totalSourceSize += data.byteLength;
      this.progress.emit(((i + 1) / (sources.length + 2)) * 0.5);
    }

    // Build metadata
    const sessionBytes = encoder.encode(sessionData);
    const archiveMetadata: ArchiveMetadata = {
      version: metadata?.version ?? "1.0.0",
      createdAt: metadata?.createdAt ?? new Date().toISOString(),
      sessionName: metadata?.sessionName ?? "Untitled Session",
      sourceCount: sources.length,
      totalSize: 0, // Will be computed after assembly
    };
    const metadataBytes = encoder.encode(JSON.stringify(archiveMetadata));

    // Calculate total size:
    //   4 (magic) + 4 (version) +
    //   4 (metadata len) + metadata +
    //   4 (session len) + session +
    //   4 (source count) +
    //   for each source: 4 (name len) + name + 4 (blob size) + blob
    let totalSize =
      4 + 4 + 4 + metadataBytes.byteLength + 4 + sessionBytes.byteLength + 4;
    for (const src of sourceBuffers) {
      const nameBytes = encoder.encode(src.name);
      totalSize += 4 + nameBytes.byteLength + 4 + src.data.byteLength;
    }

    // Update metadata with actual total size and re-encode
    archiveMetadata.totalSize = totalSize;
    const finalMetadataBytes = encoder.encode(JSON.stringify(archiveMetadata));

    // Recalculate if metadata size changed
    const sizeDiff = finalMetadataBytes.byteLength - metadataBytes.byteLength;
    totalSize += sizeDiff;

    this.progress.emit(0.6);

    // Assemble the archive buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // Magic: "DRPA"
    bytes.set(ARCHIVE_MAGIC, offset);
    offset += 4;

    // Format version
    view.setUint32(offset, ARCHIVE_FORMAT_VERSION, true);
    offset += 4;

    // Metadata JSON length + data
    view.setUint32(offset, finalMetadataBytes.byteLength, true);
    offset += 4;
    bytes.set(finalMetadataBytes, offset);
    offset += finalMetadataBytes.byteLength;

    // Session JSON length + data
    view.setUint32(offset, sessionBytes.byteLength, true);
    offset += 4;
    bytes.set(sessionBytes, offset);
    offset += sessionBytes.byteLength;

    // Source count
    view.setUint32(offset, sourceBuffers.length, true);
    offset += 4;

    this.progress.emit(0.7);

    // Each source
    for (let i = 0; i < sourceBuffers.length; i++) {
      const src = sourceBuffers[i];
      const nameBytes = encoder.encode(src.name);

      // Name length + name
      view.setUint32(offset, nameBytes.byteLength, true);
      offset += 4;
      bytes.set(nameBytes, offset);
      offset += nameBytes.byteLength;

      // Blob size + blob data
      view.setUint32(offset, src.data.byteLength, true);
      offset += 4;
      bytes.set(new Uint8Array(src.data), offset);
      offset += src.data.byteLength;

      this.progress.emit(0.7 + ((i + 1) / sourceBuffers.length) * 0.25);
    }

    this.progress.emit(1.0);

    return new Blob([buffer], { type: "application/x-drop-archive" });
  }

  /**
   * Extract an archive into session data and audio blobs.
   *
   * @param archiveBlob The archive Blob to extract.
   * @returns The extracted session data, sources, and metadata.
   * @throws Error if the archive format is invalid.
   */
  async extractArchive(archiveBlob: Blob): Promise<ExtractedArchive> {
    this.progress.emit(0);

    const arrayBuffer = await archiveBlob.arrayBuffer();
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder();
    let offset = 0;

    // Validate magic
    if (
      bytes[0] !== ARCHIVE_MAGIC[0] ||
      bytes[1] !== ARCHIVE_MAGIC[1] ||
      bytes[2] !== ARCHIVE_MAGIC[2] ||
      bytes[3] !== ARCHIVE_MAGIC[3]
    ) {
      throw new Error("Invalid archive: missing DRPA magic bytes");
    }
    offset += 4;

    // Read format version
    const formatVersion = view.getUint32(offset, true);
    if (formatVersion !== ARCHIVE_FORMAT_VERSION) {
      throw new Error(`Unsupported archive format version: ${formatVersion}`);
    }
    offset += 4;

    this.progress.emit(0.1);

    // Read metadata
    const metadataLength = view.getUint32(offset, true);
    offset += 4;
    const metadataJson = decoder.decode(
      bytes.slice(offset, offset + metadataLength),
    );
    const metadata: ArchiveMetadata = JSON.parse(metadataJson);
    offset += metadataLength;

    this.progress.emit(0.2);

    // Read session data
    const sessionLength = view.getUint32(offset, true);
    offset += 4;
    const sessionData = decoder.decode(
      bytes.slice(offset, offset + sessionLength),
    );
    offset += sessionLength;

    this.progress.emit(0.4);

    // Read source count
    const sourceCount = view.getUint32(offset, true);
    offset += 4;

    // Read each source
    const sources: Array<{ name: string; blob: Blob }> = [];
    for (let i = 0; i < sourceCount; i++) {
      // Name length + name
      const nameLength = view.getUint32(offset, true);
      offset += 4;
      const name = decoder.decode(bytes.slice(offset, offset + nameLength));
      offset += nameLength;

      // Blob size + blob data
      const blobSize = view.getUint32(offset, true);
      offset += 4;
      const blobData = bytes.slice(offset, offset + blobSize);
      offset += blobSize;

      sources.push({
        name,
        blob: new Blob([blobData]),
      });

      this.progress.emit(0.4 + ((i + 1) / sourceCount) * 0.55);
    }

    this.progress.emit(1.0);

    return { sessionData, sources, metadata };
  }

  /**
   * Get archive info without fully extracting all sources.
   * Only reads the header and metadata section.
   *
   * @param archiveBlob The archive Blob to inspect.
   * @returns The archive metadata.
   * @throws Error if the archive format is invalid.
   */
  async getArchiveInfo(archiveBlob: Blob): Promise<ArchiveMetadata> {
    // We only need to read the header portion: magic (4) + version (4) +
    // metadata length (4) + metadata. Read a generous initial chunk.
    const headerSize = Math.min(archiveBlob.size, 64 * 1024); // up to 64KB
    const headerSlice = archiveBlob.slice(0, headerSize);
    const arrayBuffer = await headerSlice.arrayBuffer();
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder();
    let offset = 0;

    // Validate magic
    if (
      bytes[0] !== ARCHIVE_MAGIC[0] ||
      bytes[1] !== ARCHIVE_MAGIC[1] ||
      bytes[2] !== ARCHIVE_MAGIC[2] ||
      bytes[3] !== ARCHIVE_MAGIC[3]
    ) {
      throw new Error("Invalid archive: missing DRPA magic bytes");
    }
    offset += 4;

    // Read format version
    const formatVersion = view.getUint32(offset, true);
    if (formatVersion !== ARCHIVE_FORMAT_VERSION) {
      throw new Error(`Unsupported archive format version: ${formatVersion}`);
    }
    offset += 4;

    // Read metadata
    const metadataLength = view.getUint32(offset, true);
    offset += 4;

    if (offset + metadataLength > arrayBuffer.byteLength) {
      throw new Error("Archive header is truncated; cannot read metadata");
    }

    const metadataJson = decoder.decode(
      bytes.slice(offset, offset + metadataLength),
    );
    return JSON.parse(metadataJson) as ArchiveMetadata;
  }
}
