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
  /** A built-in agent the chat was bound to, as an older readiness chat. */
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
    const visualId = randomUUID();
    const visualPath = `visuals/${visualId}`;
    const meta = {
      id: visualId,
      title: seed.visual.title,
      description: seed.visual.description,
      path: visualPath,
      sourceMessageAt: lastAnswerAt,
      createdAt: at(messages.length + 1),
      currentVersion: 1,
      versions: [
        {
          version: 1,
          createdAt: at(messages.length + 1),
          sourceMessageAt: lastAnswerAt,
        },
      ],
    };
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
    const dir = path.join(
      appDataDir,
      'workspaces',
      `session-${id}`,
      visualPath,
      'v1',
    );
    fs.mkdirSync(dir, { recursive: true });
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><body></body></html>',
      'styles.css': '',
      'script.js': '',
      'body.html': '',
      'spec.json': JSON.stringify(seed.visual.spec, null, 2),
      'data.json': JSON.stringify(
        seed.turns?.at(-1)?.data ?? [],
        null,
        2,
      ),
      'manifest.json': JSON.stringify(
        { ...meta, version: 1, renderer: 'spec' },
        null,
        2,
      ),
    };
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
  } else {
    fs.mkdirSync(path.join(appDataDir, 'workspaces', `session-${id}`), {
      recursive: true,
    });
  }
  doc['messages'] = messages;

  const Database = backendRequire()('better-sqlite3') as new (
    file: string,
  ) => {
    prepare(sql: string): { run(...args: unknown[]): unknown };
    close(): void;
  };
  const db = new Database(path.join(appDataDir, 'app.sqlite'));
  try {
    db.prepare('INSERT INTO "sessions" (doc) VALUES (?)').run(
      JSON.stringify(doc),
    );
  } finally {
    db.close();
  }
  return id;
}
