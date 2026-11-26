import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Past chats for the specs. No route starts a chat any more (1.23.27), so a
 * past chat is written the way an earlier version left it: a document in the
 * app's SQLite `sessions` table and, for a visual, its files in the session's
 * workspace. The store reads the table on every call and the workspace
 * registry watches the folder, so the running app lists and opens it at once.
 */

interface SqlRecord {
  tool: string;
  input?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  rationale?: string;
}

export interface PastChatTurn {
  question: string;
  answer: string;
  /** The SQL results the answer ran, kept as the answer's data. */
  data?: SqlRecord[];
}

export interface PastChatVisual {
  title: string;
  description: string;
  /** A visual spec (visuals R2): the document is built from it on load. */
  spec: unknown;
}

export interface PastChatSeed {
  name: string;
  datasets?: string[];
  /** A built-in agent the chat was bound to. */
  agentKey?: string;
  agentName?: string;
  /** A user agent the chat was started from. */
  agentId?: string;
  /** Left out for a chat saved before workflows (past-chats R65). */
  workflowId?: string;
  turns?: PastChatTurn[];
  /** When the chat started; now when left out. */
  createdAt?: Date;
  /** A visual designed from the last turn's answer. */
  visual?: PastChatVisual;
}

const backendRequire = (): NodeJS.Require =>
  createRequire(path.resolve(__dirname, '../../../backend/package.json'));

interface StoredVisualMeta {
  id: string;
  title: string;
  description: string;
  path: string;
  sourceMessageAt: string;
  createdAt: string;
  currentVersion: number;
  versions: { version: number; createdAt: string; sourceMessageAt: string }[];
}

/** Writes a spec visual's v1 files into the workspace `workspace` and returns its metadata. */
function writeVisual(
  appDataDir: string,
  workspace: string,
  visual: PastChatVisual,
  sourceMessageAt: string,
  createdAt: string,
  data: SqlRecord[],
): StoredVisualMeta {
  const visualId = randomUUID();
  const visualPath = `visuals/${visualId}`;
  const meta: StoredVisualMeta = {
    id: visualId,
    title: visual.title,
    description: visual.description,
    path: visualPath,
    sourceMessageAt,
    createdAt,
    currentVersion: 1,
    versions: [{ version: 1, createdAt, sourceMessageAt }],
  };
  const dir = path.join(appDataDir, 'workspaces', workspace, visualPath, 'v1');
  fs.mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><body></body></html>',
    'styles.css': '',
    'script.js': '',
    'body.html': '',
    'spec.json': JSON.stringify(visual.spec, null, 2),
    'data.json': JSON.stringify(data, null, 2),
    'manifest.json': JSON.stringify(
      { ...meta, version: 1, renderer: 'spec' },
      null,
      2,
    ),
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return meta;
}

interface SqliteDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(): { rid: number; doc: string }[];
  };
  close(): void;
}

function openAppDb(appDataDir: string): SqliteDb {
  const Database = backendRequire()('better-sqlite3') as new (
    file: string,
  ) => SqliteDb;
  return new Database(path.join(appDataDir, 'app.sqlite'));
}

/**
 * Gives a stored run the visual an earlier version designed from its answer
 * (the designer is gone, 2026-11-26; the viewer stays): the files in the run's
 * workspace `session-run-<id>` and the run's `visualizations` and `panelItems`.
 */
export function seedRunVisual(
  appDataDir: string,
  runId: string,
  visual: PastChatVisual,
  data: SqlRecord[] = [],
): { id: string; title: string } {
  const now = new Date().toISOString();
  const meta = writeVisual(
    appDataDir,
    `session-run-${runId}`,
    visual,
    now,
    now,
    data,
  );
  const db = openAppDb(appDataDir);
  try {
    const row = db
      .prepare('SELECT rid, doc FROM "workflow_runs"')
      .all()
      .find((candidate) => (JSON.parse(candidate.doc) as { id: string }).id === runId);
    if (!row) throw new Error(`No stored run ${runId}`);
    const doc = JSON.parse(row.doc) as Record<string, unknown>;
    doc['visualizations'] = [meta];
    doc['panelItems'] = [
      {
        id: `visual:${meta.id}`,
        kind: 'visual',
        title: meta.title,
        shownAt: meta.createdAt,
        visualId: meta.id,
      },
    ];
    // The thread's artifact card of the visual (visuals R41).
    const events = (doc['events'] as unknown[] | undefined) ?? [];
    doc['events'] = [
      ...events,
      {
        role: 'assistant',
        content: `Created interactive visual "${meta.title}" (v1).`,
        at: now,
        visual: {
          visualId: meta.id,
          version: 1,
          title: meta.title,
          action: 'created',
        },
      },
    ];
    db.prepare('UPDATE "workflow_runs" SET doc = ? WHERE rid = ?').run(
      JSON.stringify(doc),
      row.rid,
    );
  } finally {
    db.close();
  }
  return { id: meta.id, title: meta.title };
}

/** Writes a past chat into `appDataDir` and returns its id. */
export function seedPastChat(appDataDir: string, seed: PastChatSeed): string {
  const id = randomUUID();
  const created = seed.createdAt ?? new Date();
  const at = (offsetSeconds: number) =>
    new Date(created.getTime() + offsetSeconds * 1000).toISOString();
  const messages: Record<string, unknown>[] = [];
  let lastAnswerAt = at(0);
  for (const [index, turn] of (seed.turns ?? []).entries()) {
    messages.push({ role: 'user', content: turn.question, at: at(index * 2) });
    lastAnswerAt = at(index * 2 + 1);
    messages.push({
      role: 'assistant',
      content: turn.answer,
      at: lastAnswerAt,
      ...(turn.data ? { data: turn.data } : {}),
    });
  }

  const doc: Record<string, unknown> = {
    id,
    name: seed.name,
    datasets: seed.datasets ?? [],
    ...(seed.agentKey ? { agentKey: seed.agentKey } : {}),
    ...(seed.agentName ? { agentName: seed.agentName } : {}),
    ...(seed.agentId ? { agentId: seed.agentId } : {}),
    ...(seed.workflowId ? { workflowId: seed.workflowId } : {}),
    visualizations: [],
    createdAt: at(0),
    updatedAt: at(messages.length),
  };

  if (seed.visual) {
    const meta = writeVisual(
      appDataDir,
      `session-${id}`,
      seed.visual,
      lastAnswerAt,
      at(messages.length + 1),
      seed.turns?.at(-1)?.data ?? [],
    );
    const visualId = meta.id;
    doc['visualizations'] = [meta];
    doc['panelItems'] = [
      {
        id: `visual:${visualId}`,
        kind: 'visual',
        title: meta.title,
        shownAt: meta.createdAt,
        visualId,
      },
    ];
    messages.push({
      role: 'assistant',
      content: `Created interactive visual "${meta.title}".`,
      at: at(messages.length + 1),
      visual: {
        visualId,
        version: 1,
        title: meta.title,
        action: 'created',
      },
    });
  } else {
    fs.mkdirSync(path.join(appDataDir, 'workspaces', `session-${id}`), {
      recursive: true,
    });
  }
  doc['messages'] = messages;

  const db = openAppDb(appDataDir);
  try {
    db.prepare('INSERT INTO "sessions" (doc) VALUES (?)').run(
      JSON.stringify(doc),
    );
  } finally {
    db.close();
  }
  return id;
}
