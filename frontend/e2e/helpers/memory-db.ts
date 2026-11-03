import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect } from '@playwright/test';
import { appSql } from './app-db';

/**
 * What the memory of past sessions holds, read straight from the app's two
 * files (knowledge R30 to R43): the `memory_signals` outbox in `app.sqlite`
 * (data-model 3.15) and the learning memories in `mastra.sqlite` (5.2).
 * Read only; the app may be running.
 */

/** One `memory_signals` row (data-model 3.15). */
export interface OutboxRow {
  id: string;
  documentId: string;
  kind: 'verified_query' | 'correction' | 'rejection';
  datasourceId: string;
  content: string;
  status: 'pending' | 'stored' | 'failed';
  attempts: number;
  lastError?: string;
}

/** A message of a learning thread: one signal (data-model 5.2). */
export interface LearnedMessage {
  /** The signal's document id. */
  id: string;
  /** `learning-<datasource id>`. */
  threadId: string;
  text: string;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  pragma(statement: string): unknown;
  prepare(statement: string): SqliteStatement;
  close(): void;
}

/** `better-sqlite3` is a backend dependency; the tests borrow it. */
const requireFromBackend = createRequire(
  path.resolve(__dirname, '../../../backend/package.json'),
);

/** The framework's message index of 1536-dimension embeddings. */
const MESSAGE_INDEX = 'memory_messages';

export function outboxRows(dataDir: string): OutboxRow[] {
  return appSql<{ doc: string }>(
    dataDir,
    'SELECT doc FROM "memory_signals" ORDER BY rid',
  ).map((row) => JSON.parse(row.doc) as OutboxRow);
}

/** Runs one read statement on `<dataDir>/mastra.sqlite`. */
function mastraSql<T>(
  dataDir: string,
  statement: string,
  ...params: unknown[]
): T[] {
  const Database = requireFromBackend('better-sqlite3') as new (
    file: string,
    options: { readonly: boolean; fileMustExist: boolean },
  ) => SqliteDatabase;
  const db = new Database(path.join(dataDir, 'mastra.sqlite'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma('busy_timeout = 5000');
    return db.prepare(statement).all(...params) as T[];
  } finally {
    db.close();
  }
}

function tableExists(dataDir: string, table: string): boolean {
  return (
    mastraSql(
      dataDir,
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      table,
    ).length > 0
  );
}

/** Every message of every learning thread, or of one datasource's. */
export function learnedMessages(
  dataDir: string,
  datasourceId?: string,
): LearnedMessage[] {
  const rows = mastraSql<{ id: string; thread_id: string; content: string }>(
    dataDir,
    "SELECT id, thread_id, content FROM mastra_messages WHERE thread_id LIKE 'learning-%' ORDER BY createdAt",
  );
  return rows
    .filter(
      (row) => !datasourceId || row.thread_id === `learning-${datasourceId}`,
    )
    .map((row) => {
      const content = JSON.parse(row.content) as {
        parts?: { type?: string; text?: string }[];
      };
      return {
        id: row.id,
        threadId: row.thread_id,
        text: (content.parts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join(''),
      };
    });
}

/** Whether a datasource's learning thread exists. */
export function holdsThread(dataDir: string, datasourceId: string): boolean {
  return (
    mastraSql(
      dataDir,
      'SELECT 1 FROM mastra_threads WHERE id = ?',
      `learning-${datasourceId}`,
    ).length > 0
  );
}

/**
 * The vectors of a signal (or of a whole learning thread), each with the
 * copy of the text the index keeps beside the embedding.
 */
export function indexCopies(
  dataDir: string,
  filter: { documentId?: string; datasourceId?: string },
): string[] {
  if (!tableExists(dataDir, MESSAGE_INDEX)) return [];
  return mastraSql<{ metadata: string }>(
    dataDir,
    `SELECT metadata FROM "${MESSAGE_INDEX}"`,
  )
    .map(
      (row) =>
        JSON.parse(row.metadata) as {
          message_id?: string;
          thread_id?: string;
          content?: string;
        },
    )
    .filter(
      (metadata) =>
        (!filter.documentId || metadata.message_id === filter.documentId) &&
        (!filter.datasourceId ||
          metadata.thread_id === `learning-${filter.datasourceId}`),
    )
    .map((metadata) => metadata.content ?? '');
}

/** A datasource's summary (its resource's working memory), when written. */
export function summaryOf(
  dataDir: string,
  datasourceId: string,
): string | null {
  const [row] = mastraSql<{ workingMemory: string | null }>(
    dataDir,
    'SELECT workingMemory FROM mastra_resources WHERE id = ?',
    datasourceId,
  );
  return row?.workingMemory?.trim() || null;
}

/** Whether a resource row (the summary's home) exists for a datasource. */
export function holdsResource(dataDir: string, datasourceId: string): boolean {
  return (
    mastraSql(
      dataDir,
      'SELECT 1 FROM mastra_resources WHERE id = ?',
      datasourceId,
    ).length > 0
  );
}

/**
 * Whether `text` is anywhere in a database file's bytes, its write-ahead
 * log and rollback journal included: free pages keep a deleted row's text
 * until the file is compacted (data-model 5.2).
 */
export function fileBytesHold(
  dataDir: string,
  file: 'app.sqlite' | 'mastra.sqlite',
  text: string,
): boolean {
  const needle = Buffer.from(text, 'utf8');
  return ['', '-wal', '-journal'].some((suffix) => {
    const full = path.join(dataDir, file + suffix);
    return fs.existsSync(full) && fs.readFileSync(full).includes(needle);
  });
}

/** Waits until the outbox row of `documentId` is stored, and returns it. */
export async function storedSignal(
  dataDir: string,
  documentId: string,
): Promise<OutboxRow> {
  let row: OutboxRow | undefined;
  await expect
    .poll(
      () => {
        row = outboxRows(dataDir).find((r) => r.documentId === documentId);
        return row?.status;
      },
      { message: `the signal ${documentId} is stored`, timeout: 30_000 },
    )
    .toBe('stored');
  return row!;
}
