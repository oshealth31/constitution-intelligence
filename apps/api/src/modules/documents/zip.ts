import { inflateRawSync } from 'node:zlib';

/**
 * A small, defensive ZIP reader for Word (.docx) files, which are ZIP archives.
 * It refuses archives that are encrypted, use unusual compression, have too many entries or
 * would expand to an unreasonable size ("zip bombs"). Nothing is ever written to disk.
 */

export class ZipError extends Error {}

export interface ZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
};

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();

  constructor(
    private readonly data: Buffer,
    private readonly limits: ZipLimits = DEFAULT_ZIP_LIMITS,
  ) {
    const end = this.findEndOfCentralDirectory();
    const count = data.readUInt16LE(end + 10);
    const size = data.readUInt32LE(end + 12);
    const start = data.readUInt32LE(end + 16);
    if (count === 0xffff || start === 0xffffffff) {
      throw new ZipError('ZIP64 archives are not supported.');
    }
    if (count > limits.maxEntries) {
      throw new ZipError('The file contains too many parts.');
    }
    if (start + size > data.length) {
      throw new ZipError('The file is damaged (directory outside the file).');
    }
    let offset = start;
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
        throw new ZipError('The file is damaged (bad directory entry).');
      }
      const flags = data.readUInt16LE(offset + 8);
      const method = data.readUInt16LE(offset + 10);
      const compressedSize = data.readUInt32LE(offset + 20);
      const uncompressedSize = data.readUInt32LE(offset + 24);
      const nameLength = data.readUInt16LE(offset + 28);
      const extraLength = data.readUInt16LE(offset + 30);
      const commentLength = data.readUInt16LE(offset + 32);
      const localHeaderOffset = data.readUInt32LE(offset + 42);
      const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (flags & 0x1) {
        throw new ZipError('The file is password-protected.');
      }
      if (method !== 0 && method !== 8) {
        throw new ZipError('The file uses an unsupported compression method.');
      }
      if (uncompressedSize > limits.maxEntryUncompressedBytes) {
        throw new ZipError('A part of the file is too large.');
      }
      total += uncompressedSize;
      if (total > limits.maxTotalUncompressedBytes) {
        throw new ZipError('The file expands to an unreasonable size.');
      }
      this.entries.set(name, {
        name,
        method,
        flags,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Reads one entry as UTF-8 text, or returns null if it does not exist. */
  readText(name: string): string | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const offset = entry.localHeaderOffset;
    if (offset + 30 > this.data.length || this.data.readUInt32LE(offset) !== 0x04034b50) {
      throw new ZipError('The file is damaged (bad entry header).');
    }
    const nameLength = this.data.readUInt16LE(offset + 26);
    const extraLength = this.data.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const compressed = this.data.subarray(start, start + entry.compressedSize);
    if (compressed.length !== entry.compressedSize) {
      throw new ZipError('The file is damaged (truncated entry).');
    }
    let content: Buffer;
    try {
      content =
        entry.method === 0
          ? compressed
          : inflateRawSync(compressed, { maxOutputLength: this.limits.maxEntryUncompressedBytes });
    } catch {
      throw new ZipError('The file is damaged (could not decompress a part).');
    }
    if (content.length !== entry.uncompressedSize) {
      throw new ZipError('The file is damaged (unexpected size).');
    }
    return content.toString('utf8');
  }

  private findEndOfCentralDirectory(): number {
    const minimum = Math.max(0, this.data.length - 22 - 0xffff);
    for (let offset = this.data.length - 22; offset >= minimum; offset -= 1) {
      if (this.data.readUInt32LE(offset) === 0x06054b50) {
        return offset;
      }
    }
    throw new ZipError('The file is not a valid Word document (no ZIP directory).');
  }
}
