/**
 * Where the `file` kind's files live and how they get there (ADR-0052,
 * plan m1-31 6 and 7): uploads streamed to `<dataDir>/files/uploads/
 * <uploadId>/<name>`, a test (16) imported into a throwaway database, a
 * save (18) moving the uploads to `<dataDir>/files/<datasourceId>/
 * originals/<fileId>.<ext>` and building `data.duckdb`, and the sweep of
 * stale uploads at backend start.
 */
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { SourceFile } from '../entities/datasource.entity';
import { duckDbMessage, fileDatabasePath, filesRoot } from './duckdb';
import { excelExtension } from './excel-extension';
import {
  assignEntityKeys,
  detectSheets,
  fileFormatOf,
  importFiles,
} from './file-import';

/** The largest file an upload takes: 200 MB. */
export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
/** Injection token of the upload cap; tests inject a small one. */
export const FILE_UPLOAD_MAX_BYTES = 'FILE_UPLOAD_MAX_BYTES';
/** An upload not saved this long after it came is removed at start. */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A datasource id used as a folder name. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function uploadsRoot(): string {
  return join(filesRoot(), 'uploads');
}

function uploadDir(uploadId: string): string {
  if (!UUID.test(uploadId ?? '')) {
    throw new BadRequestException('uploadId must be an upload id');
  }
  return join(uploadsRoot(), uploadId);
}

/** `<dataDir>/files/<datasourceId>`; refuses an id that is not a plain name. */
export function datasourceFilesDir(datasourceId: string): string {
  if (!SAFE_ID.test(datasourceId ?? '')) {
    throw new BadRequestException(`Invalid datasource id ${datasourceId}`);
  }
  return join(filesRoot(), datasourceId);
}

function originalsDir(datasourceId: string): string {
  return join(datasourceFilesDir(datasourceId), 'originals');
}

/** `<dataDir>/files/<datasourceId>/originals/<fileId>.<ext>`. */
export function originalPath(
  datasourceId: string,
  file: Pick<SourceFile, 'id' | 'format'>,
): string {
  return join(originalsDir(datasourceId), originalName(file));
}

function originalName(file: Pick<SourceFile, 'id' | 'format'>): string {
  if (!UUID.test(file.id ?? '') || !['xlsx', 'csv'].includes(file.format)) {
    throw new BadRequestException(`Invalid file id ${file.id}`);
  }
  return `${file.id}.${file.format}`;
}

function sizeText(bytes: number): string {
  const mb = 1024 * 1024;
  if (bytes % mb === 0) return `${bytes / mb} MB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KB`;
  return `${bytes} bytes`;
}

/**
 * The upload's file name from the `X-File-Name` header (URI-encoded),
 * without any folder, checked for an extension the importer takes.
 */
export function uploadName(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  let decoded = '';
  try {
    decoded = decodeURIComponent(raw ?? '');
  } catch {
    throw new BadRequestException('X-File-Name must be URI-encoded');
  }
  const name = (decoded.split(/[\\/]/).pop() ?? '').trim();
  if (!name || name === '.' || name === '..') {
    throw new BadRequestException('X-File-Name header is required');
  }
  if (/\.xls$/i.test(name)) {
    throw new BadRequestException(
      '.xls files are not supported — save the workbook as .xlsx',
    );
  }
  if (!fileFormatOf(name)) {
    throw new BadRequestException('Only .xlsx and .csv files can be imported');
  }
  return name;
}

/**
 * Stream `body` to `<uploads>/<new uploadId>/<name>`, counting and hashing
 * it. Over `maxBytes` (declared or counted) → 413, the partial file
 * deleted and the rest of the body drained. The body is never piped with
 * `pipeline`, which would destroy the request and so the 413 response.
 */
async function receiveUpload(
  body: Readable,
  name: string,
  maxBytes: number,
  declaredBytes: number | undefined,
): Promise<{ uploadId: string; path: string; size: number; sha256: string }> {
  const tooLarge = () =>
    new PayloadTooLargeException(`File is larger than ${sizeText(maxBytes)}`);
  if (declaredBytes !== undefined && declaredBytes > maxBytes) {
    body.resume();
    throw tooLarge();
  }
  const uploadId = randomUUID();
  const dir = uploadDir(uploadId);
  const path = join(dir, name);
  await mkdir(dir, { recursive: true });
  const hash = createHash('sha256');
  let size = 0;
  let over = false;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        done(new Error('too large'));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const written = pipeline(meter, createWriteStream(path));
  body.once('error', (err) => meter.destroy(err));
  body.once('close', () => {
    if (!body.readableEnded) meter.destroy(new Error('The upload was cut off'));
  });
  body.pipe(meter);
  try {
    await written;
  } catch (err) {
    body.unpipe(meter);
    body.resume();
    await rm(dir, { recursive: true, force: true });
    if (over) throw tooLarge();
    throw err;
  }
  return { uploadId, path, size, sha256: hash.digest('hex') };
}

/**
 * Upload one file (api.md 156): stored under its upload id, its sheets
 * detected (plan m1-31 5) and keyed (4). An unreadable file is deleted and
 * answered with 400.
 */
export async function uploadFile(
  body: Readable,
  fileNameHeader: string | string[] | undefined,
  declaredBytes: number | undefined,
  maxBytes: number,
): Promise<{ uploadId: string; file: SourceFile }> {
  let name: string;
  try {
    name = uploadName(fileNameHeader);
  } catch (err) {
    body.resume();
    throw err;
  }
  const received = await receiveUpload(body, name, maxBytes, declaredBytes);
  let sheets: SourceFile['sheets'];
  try {
    sheets = await detectSheets(received.path, name, {
      excelExtension: excelExtension(),
    });
  } catch (err) {
    await removeUpload(received.uploadId);
    throw new BadRequestException(
      `${name} could not be read: ${duckDbMessage(err, true)}`,
    );
  }
  const [file] = assignEntityKeys([
    {
      id: randomUUID(),
      name,
      format: fileFormatOf(name)!,
      sizeBytes: received.size,
      sha256: received.sha256,
      uploadedAt: new Date().toISOString(),
      schema: '',
      sheets,
      uploadId: received.uploadId,
    },
  ]);
  return { uploadId: received.uploadId, file };
}

/** The one file of an upload; 404 when it is gone (saved, dropped, swept). */
export async function uploadedFilePath(uploadId: string): Promise<string> {
  const dir = uploadDir(uploadId);
  const [name] = await readdir(dir).catch(() => [] as string[]);
  if (!name) {
    throw new NotFoundException(
      `Upload ${uploadId} not found — upload the file again`,
    );
  }
  return join(dir, name);
}

/** Drop an unsaved upload (api.md 158); a missing one is no error. */
export async function removeUpload(uploadId: string): Promise<void> {
  await rm(uploadDir(uploadId), { recursive: true, force: true });
}

/** Remove `<dataDir>/files/<datasourceId>/` (delete, 19). */
export async function removeDatasourceFiles(
  datasourceId: string,
): Promise<void> {
  await rm(datasourceFilesDir(datasourceId), { recursive: true, force: true });
}

/**
 * Remove every entry of `uploads/` last changed more than `maxAgeMs` ago
 * (at backend start). Answers how many went.
 */
export async function sweepStaleUploads(
  maxAgeMs = STALE_UPLOAD_MS,
  now = Date.now(),
): Promise<number> {
  const root = uploadsRoot();
  const entries = await readdir(root).catch(() => [] as string[]);
  let removed = 0;
  for (const entry of entries) {
    const path = join(root, entry);
    const info = await stat(path).catch(() => undefined);
    if (!info || now - info.mtimeMs <= maxAgeMs) continue;
    await rm(path, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * The entity keys of `files` (plan m1-31 4). A file that replaces a saved
 * one (its saved id with a new upload) keeps the saved schema, and each
 * sheet whose name is unchanged its saved table; a new file or sheet never
 * takes a key the saved ones keep.
 */
export function keyedFiles(
  files: SourceFile[],
  saved: SourceFile[] = [],
): SourceFile[] {
  const savedById = new Map(saved.map((f) => [f.id, f]));
  const keptSchemas = new Set(
    files
      .filter((f) => savedById.has(f.id))
      .map((f) => savedById.get(f.id)!.schema),
  );
  const prepared = files.map((file) => {
    const before = savedById.get(file.id);
    if (!before) {
      return keptSchemas.has(file.schema) ? { ...file, schema: '' } : file;
    }
    if (!file.uploadId) return file;
    const tables = new Map(before.sheets.map((s) => [s.sheet, s.table]));
    const kept = new Set(
      file.sheets
        .filter((s) => tables.has(s.sheet))
        .map((s) => tables.get(s.sheet)),
    );
    return {
      ...file,
      schema: before.schema,
      sheets: file.sheets.map((s) =>
        tables.has(s.sheet)
          ? { ...s, table: tables.get(s.sheet)! }
          : kept.has(s.table)
            ? { ...s, table: '' }
            : s,
      ),
    };
  });
  return assignEntityKeys(prepared);
}

/**
 * Each file with where it is now: its upload, else the saved original of
 * `datasourceId`.
 */
async function sourcePaths(
  files: SourceFile[],
  datasourceId: string | undefined,
): Promise<{ file: SourceFile; path: string }[]> {
  const out: { file: SourceFile; path: string }[] = [];
  for (const file of files) {
    if (fileFormatOf(file.name) !== file.format) {
      throw new BadRequestException(
        'Only .xlsx and .csv files can be imported',
      );
    }
    if (file.uploadId) {
      out.push({ file, path: await uploadedFilePath(file.uploadId) });
      continue;
    }
    const path = datasourceId ? originalPath(datasourceId, file) : '';
    if (!path || !existsSync(path)) {
      throw new BadRequestException(
        `${file.name} is not uploaded — add it again`,
      );
    }
    out.push({ file, path });
  }
  return out;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Test (16) of a `file` config: import every included sheet into a
 * throwaway database under `uploads/`, removed after. Answers
 * `Imported <n> tables · <rows> rows`; a failure throws
 * `<file> · <sheet>: <cause>`.
 */
export async function checkImport(
  files: SourceFile[],
  datasourceId: string | undefined,
  saved: SourceFile[] = [],
): Promise<string> {
  if (!files.length) {
    throw new BadRequestException('Add at least one .xlsx or .csv file');
  }
  if (!files.some((f) => (f.sheets ?? []).some((s) => s.include))) {
    throw new BadRequestException('Include at least one sheet');
  }
  const sources = await sourcePaths(keyedFiles(files, saved), datasourceId);
  const dir = join(uploadsRoot(), `check-${randomUUID()}`);
  try {
    const imported = await importFiles(join(dir, 'data.duckdb'), sources, {
      excelExtension: excelExtension(),
    });
    const sheets = imported.flatMap((f) => f.sheets.filter((s) => s.include));
    const rows = sheets.reduce((n, s) => n + (s.rowCount ?? 0), 0);
    return `Imported ${plural(sheets.length, 'table')} · ${plural(rows, 'row')}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Save (18) of a `file` config: import into the datasource's
 * `data.duckdb` (a failure throws and leaves the previous database), then
 * move each upload to `originals/<fileId>.<ext>` and remove the originals
 * no file names any more. Answers the files to store: keyed, with the
 * import's row counts and columns, without `uploadId`.
 */
export async function saveImport(
  datasourceId: string,
  files: SourceFile[],
  saved: SourceFile[] = [],
): Promise<SourceFile[]> {
  const keyed = keyedFiles(files, saved);
  const databasePath = fileDatabasePath(datasourceId);
  datasourceFilesDir(datasourceId);
  let imported: SourceFile[] = [];
  if (keyed.length) {
    const sources = await sourcePaths(keyed, datasourceId);
    imported = await importFiles(databasePath, sources, {
      excelExtension: excelExtension(),
    });
    await mkdir(originalsDir(datasourceId), { recursive: true });
    for (const { file, path } of sources) {
      if (!file.uploadId) continue;
      await rename(path, originalPath(datasourceId, file));
      await removeUpload(file.uploadId);
    }
  } else {
    await rm(databasePath, { force: true });
  }
  const keep = new Set(imported.map(originalName));
  const originals = await readdir(originalsDir(datasourceId)).catch(
    () => [] as string[],
  );
  for (const name of originals) {
    if (!keep.has(name)) {
      await rm(join(originalsDir(datasourceId), name), { force: true });
    }
  }
  return imported.map((file) => {
    const stored = { ...file };
    delete stored.uploadId;
    return stored;
  });
}
