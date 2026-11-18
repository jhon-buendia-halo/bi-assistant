/**
 * The sheet names of an `.xlsx` workbook, in workbook order. DuckDB's
 * `read_xlsx` needs a sheet name but cannot list them, and exceljs would read
 * the whole workbook (or, streaming, fails on workbooks whose
 * `xl/workbook.xml` comes after the sheets), so this reads only the zip's
 * central directory and `xl/workbook.xml`.
 */
import { open } from 'fs/promises';
import { inflateRawSync } from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The end-of-central-directory record and the longest zip comment. */
const TAIL_BYTES = 22 + 0xffff;
const WORKBOOK_ENTRY = 'xl/workbook.xml';

function notAWorkbook(): Error {
  return new Error('The file is not a valid .xlsx workbook');
}

export async function readSheetNames(path: string): Promise<string[]> {
  return parseSheetNames(await readZipEntry(path, WORKBOOK_ENTRY));
}

async function readZipEntry(path: string, name: string): Promise<string> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const tailLength = Math.min(size, TAIL_BYTES);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw notAWorkbook();
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);

    let at = 0;
    for (let n = 0; n < entries && at + 46 <= directory.length; n++) {
      if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) break;
      const method = directory.readUInt16LE(at + 10);
      const compressedSize = directory.readUInt32LE(at + 20);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const localOffset = directory.readUInt32LE(at + 42);
      const entryName = directory.toString(
        'utf8',
        at + 46,
        at + 46 + nameLength,
      );
      at += 46 + nameLength + extraLength + commentLength;
      if (entryName !== name) continue;

      const local = Buffer.alloc(30);
      await file.read(local, 0, 30, localOffset);
      if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw notAWorkbook();
      const dataOffset =
        localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const data = Buffer.alloc(compressedSize);
      await file.read(data, 0, compressedSize, dataOffset);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw notAWorkbook();
    }
    throw notAWorkbook();
  } finally {
    await file.close();
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

/** `<sheet name="…" …/>` elements of `xl/workbook.xml`, any namespace prefix. */
export function parseSheetNames(workbookXml: string): string[] {
  const names: string[] = [];
  const sheet = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
  for (const match of workbookXml.matchAll(sheet)) {
    const name = /\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/.exec(match[1]);
    if (name) names.push(decodeXml(name[1] ?? name[2]));
  }
  return names;
}
