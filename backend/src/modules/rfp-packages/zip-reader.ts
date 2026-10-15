import { inflateRawSync } from 'zlib';

export interface ZipFile {
  name: string;
  data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * Read the files of a ZIP archive, dependency-free: stored and deflated
 * entries, read through the central directory (so entries written with a
 * data descriptor work too). Directory entries are skipped. Throws on an
 * archive it cannot read, never returns a partial one.
 */
export function readZip(archive: Buffer): ZipFile[] {
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const files: ZipFile[] = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('Invalid ZIP archive: broken central directory');
    }
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;

    if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`Invalid ZIP archive: no local header for "${name}"`);
    }
    const start =
      localOffset +
      30 +
      archive.readUInt16LE(localOffset + 26) +
      archive.readUInt16LE(localOffset + 28);
    const raw = archive.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === STORED) data = Buffer.from(raw);
    else if (method === DEFLATED) data = inflateRawSync(raw);
    else {
      throw new Error(
        `Unsupported ZIP compression method ${method} for "${name}"`,
      );
    }
    if (data.length !== size) {
      throw new Error(`Invalid ZIP archive: "${name}" has the wrong size`);
    }
    files.push({ name, data });
  }
  return files;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65,535 bytes.
  const last = archive.length - 22;
  const first = Math.max(0, last - 0xffff);
  if (last < 0) throw new Error('Invalid ZIP archive: too short');
  for (let offset = last; offset >= first; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error('Invalid ZIP archive: no end of central directory');
}
