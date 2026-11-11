import { once } from 'events';
import type { Writable } from 'stream';

export const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A validated, ready-to-stream attachment. Nothing has been written when it is built. */
export interface Download {
  contentType: string;
  fileName: string;
  headers: Record<string, string>;
  /** Writes the whole body into `out` and ends it. */
  write(out: Writable): Promise<void>;
}

/** Writes text chunks respecting backpressure, then ends the stream. */
export async function writeChunks(
  out: Writable,
  chunks: Iterable<string>,
): Promise<void> {
  for (const chunk of chunks) {
    if (out.destroyed) return;
    if (!out.write(chunk, 'utf8')) await once(out, 'drain');
  }
  await new Promise<void>((resolve) => out.end(() => resolve()));
}
