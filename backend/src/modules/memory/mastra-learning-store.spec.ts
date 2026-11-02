// The real `@mastra/memory` and `@mastra/libsql` run here. Their bundles
// require three ESM-only packages, which this repo's Jest cannot load (no
// `--experimental-vm-modules`); none is on the store's path (slug names,
// workspace skills, observational-memory token estimates), so plain
// stand-ins do.
jest.mock('@sindresorhus/slugify', () => ({
  __esModule: true,
  default: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));
jest.mock('p-map', () => ({
  __esModule: true,
  default: (items: Iterable<unknown>, map: (item: unknown) => unknown) =>
    Promise.all([...items].map(map)),
}));
jest.mock('tokenx', () => ({
  estimateTokenCount: (text: string) => Math.ceil((text ?? '').length / 4),
}));

import { createClient } from '@libsql/client';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Logger } from '@nestjs/common';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { LearningSignal, MemoryModelUsage } from './learning-store.port';
import { MastraLearningStore } from './mastra-learning-store';
import type { EmbedArgs, EmbeddingModelLike, SummaryModel } from './models';

/** Dimensions of the fake embedder (index `memory_messages_512`). */
const DIMENSIONS = 512;
const STOP_WORDS = new Set(
  'a an the of in at on to by for and or is was were did do does who what which how many much'.split(
    ' ',
  ),
);

/**
 * A deterministic stand-in for the embedding model: the words of a signal's
 * question (or of the whole text), hashed into a bag of words. Two
 * questions sharing their content words score high, unrelated ones near 0.
 */
function fakeEmbed(text: string): number[] {
  // The framework joins a text's words with single spaces before it embeds.
  const question =
    /Question: (.*?)(?=\s+(?:Approved|Rejected|Corrected) SQL|$)/s.exec(
      text,
    )?.[1] ?? text;
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[0] = 0.01;
  for (const word of question.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP_WORDS.has(word)) continue;
    let hash = 7;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[1 + (hash % (DIMENSIONS - 1))] += 1;
  }
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

function fakeEmbedder(delayMs = 0) {
  const calls: string[][] = [];
  const embedder: EmbeddingModelLike = {
    specificationVersion: 'v2',
    provider: 'openai',
    modelId: 'text-embedding-3-small',
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    doEmbed: async ({ values }: EmbedArgs) => {
      calls.push(values);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        embeddings: values.map(fakeEmbed),
        usage: { tokens: values.join(' ').split(/\s+/).length },
      };
    },
  };
  return { embedder, calls };
}

const SIGNAL_DAY = '2026-10-05T10:00:00.000Z';

function signal(
  documentId: string,
  question: string,
  overrides: Partial<LearningSignal> = {},
): LearningSignal {
  const kind = overrides.kind ?? 'verified_query';
  const label =
    kind === 'verified_query'
      ? 'Approved SQL'
      : kind === 'rejection'
        ? 'Rejected SQL (do not reuse)'
        : 'Corrected SQL (do not reuse)';
  return {
    documentId,
    kind,
    content: `[${kind} · 2026-10-05]\nQuestion: ${question}\n${label}: SELECT 1`,
    occurredAt: SIGNAL_DAY,
    metadata: { datasourceId: 'ds-1', datasetIds: ['football'], entities: [] },
    ...overrides,
  };
}

describe('MastraLearningStore (data-model 5.2)', () => {
  let dir: string;
  let closers: (() => unknown)[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qti-learning-'));
    closers = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const close of closers.reverse()) await close();
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  /** A store on a fresh LibSQL file, with three clients of it as in the app. */
  function build(
    options: {
      hasKey?: boolean;
      embedDelayMs?: number;
      recallTimeoutMs?: number;
      summary?: SummaryModel['generate'];
    } = {},
  ) {
    const url = `file:${join(dir, 'mastra.sqlite')}`;
    const { embedder, calls } = fakeEmbedder(options.embedDelayMs);
    const backend = jest.fn(() => {
      const storage = new LibSQLStore({ id: 'test-storage', url });
      const vector = new LibSQLVector({ id: 'test-vector', url });
      closers.push(
        () => storage.close(),
        () => vector.close(),
      );
      return { storage, vector };
    });
    const raw = createClient({ url });
    closers.push(() => raw.close());
    const summary = {
      generate: jest.fn(
        options.summary ??
          ((_instructions: string, prompt: string) =>
            Promise.resolve({
              text: `Known pitfalls\n- learned from ${prompt.split('\n\n').length - 1} signal(s)`,
              model: 'openai/GPT-5.6-Luna',
              usage: { inputTokens: 120, outputTokens: 30, reasoningTokens: 4 },
            })),
      ),
    };
    const store = new MastraLearningStore({
      backend,
      client: () => Promise.resolve(raw),
      embedder,
      hasEmbeddingKey: () => Promise.resolve(options.hasKey ?? true),
      summaryModel: summary,
      summaryDelayMs: 20,
      ...(options.recallTimeoutMs
        ? { recallTimeoutMs: options.recallTimeoutMs }
        : {}),
    });
    // Closed first: its summary rewrites still use the clients.
    closers.push(() => store.close());
    const count = async (sql: string, args: string[] = []) =>
      Number((await raw.execute({ sql, args })).rows[0].n);
    return { store, backend, raw, calls, summary, count, url };
  }

  it('builds nothing until an operation needs it', () => {
    const { backend } = build();
    expect(backend).not.toHaveBeenCalled();
  });

  it('stores one message per signal and recalls it for a paraphrase', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal(
        'rating:s1:a',
        'Which player scored the most goals in the 2018 World Cup?',
      ),
      signal('rating:s1:b', 'Which stadium hosted the most matches?'),
    ]);

    const recalled = await store.recall(
      'ds-1',
      'Top goals scorer of the 2018 World Cup?',
    );

    expect(recalled).toEqual([
      {
        documentId: 'rating:s1:a',
        kind: 'verified_query',
        content: signal(
          'rating:s1:a',
          'Which player scored the most goals in the 2018 World Cup?',
        ).content,
        occurredAt: SIGNAL_DAY,
      },
    ]);
  });

  it('recalls each of two signals stored at the same time as itself', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
      signal('rating:s1:b', 'Which stadium hosted the most matches?'),
    ]);
    await store.retain('ds-1', [
      signal('rating:s1:c', 'Yellow cards shown in the 2022 final?'),
    ]);

    for (const [question, id] of [
      ['Goals scored in the 2018 World Cup?', 'rating:s1:a'],
      ['Which stadium hosted the most matches?', 'rating:s1:b'],
      ['Yellow cards shown in the 2022 final?', 'rating:s1:c'],
    ]) {
      expect(
        (await store.recall('ds-1', question)).map((s) => s.documentId),
      ).toEqual([id]);
    }
  });

  it('drops an unrelated question with the 0.4 threshold', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal(
        'rating:s1:a',
        'Which player scored the most goals in the 2018 World Cup?',
      ),
    ]);

    expect(
      await store.recall('ds-1', 'Will it rain in Lisbon tomorrow?'),
    ).toEqual([]);
  });

  it('recalls from its own scope only', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);

    expect(
      await store.recall('ds-2', 'Goals scored in the 2018 World Cup?'),
    ).toEqual([]);
  });

  it('replaces a stored id in place: one message, one vector, the new text', async () => {
    const { store, count } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?', {
        kind: 'rejection',
      }),
    ]);
    // An outbox replay of the same signal.
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?', {
        kind: 'rejection',
      }),
    ]);

    expect(
      await count(
        `SELECT count(*) AS n FROM memory_messages_${DIMENSIONS} WHERE json_extract(metadata, '$.message_id') = ?`,
        ['rating:s1:a'],
      ),
    ).toBe(1);
    const items = await store.items('ds-1');
    const signals = items.filter((i) => i.kind === 'signal');
    expect(signals.map((i) => i.documentId)).toEqual(['rating:s1:a']);
    expect(signals[0].text).toContain('[rejection · 2026-10-05]');
    expect(items.filter((i) => i.kind === 'index').map((i) => i.text)).toEqual([
      expect.stringContaining('Rejected SQL (do not reuse)'),
    ]);
    const [recalled] = await store.recall(
      'ds-1',
      'Goals scored in the 2018 World Cup?',
    );
    expect(recalled.kind).toBe('rejection');
  });

  it('sends a text found twice once, the newest', async () => {
    const { store } = build();
    const question = 'Goals scored in the 2018 World Cup?';
    await store.retain('ds-1', [
      signal('rating:s1:a', question),
      signal('rating:s2:a', question, {
        occurredAt: '2026-10-05T12:00:00.000Z',
      }),
    ]);

    const recalled = await store.recall('ds-1', question);

    expect(recalled.map((s) => s.documentId)).toEqual(['rating:s2:a']);
  });

  it('lists recalled signals oldest first', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal('rating:s2:a', 'Goals scored in the 2022 World Cup final?', {
        occurredAt: '2026-10-07T10:00:00.000Z',
      }),
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup final?', {
        occurredAt: '2026-10-01T10:00:00.000Z',
      }),
    ]);

    const recalled = await store.recall(
      'ds-1',
      'Goals scored in the World Cup final?',
    );

    expect(recalled.map((s) => s.documentId)).toEqual([
      'rating:s1:a',
      'rating:s2:a',
    ]);
  });

  it('forgets a signal: its message, its vector and the index copy of its text', async () => {
    const { store, count } = build();
    await store.retain('ds-1', [
      signal(
        'rating:s1:a',
        'Goals decided on penalties in the 2018 World Cup?',
      ),
      signal('rating:s1:b', 'Which stadium hosted the most matches?'),
    ]);

    await store.forget('ds-1', 'rating:s1:a');

    const items = await store.items('ds-1');
    expect(items.some((i) => i.documentId === 'rating:s1:a')).toBe(false);
    expect(items.some((i) => i.text.includes('penalties'))).toBe(false);
    expect(items.filter((i) => i.documentId === 'rating:s1:b')).toHaveLength(2);
    expect(
      await count(
        `SELECT count(*) AS n FROM memory_messages_${DIMENSIONS} WHERE metadata LIKE ?`,
        ['%penalties%'],
      ),
    ).toBe(0);
    expect(
      await store.recall(
        'ds-1',
        'Goals decided on penalties in the 2018 World Cup?',
      ),
    ).toEqual([]);
  });

  it('leaves no forgotten text in the file once compacted', async () => {
    const { store, url } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Is a match decided on penalties a draw?'),
      signal('rating:s1:b', 'Which stadium hosted the most matches?'),
    ]);
    await store.forget('ds-1', 'rating:s1:a');

    await store.compact();

    const file = url.slice('file:'.length);
    const bytes = Buffer.concat(
      ['', '-wal'].map((suffix) => {
        try {
          return readFileSync(file + suffix);
        } catch {
          return Buffer.alloc(0);
        }
      }),
    );
    expect(bytes.includes(Buffer.from('decided on penalties'))).toBe(false);
    expect(bytes.includes(Buffer.from('stadium hosted'))).toBe(true);
  });

  it('forgets a whole scope with its summary', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);
    await store.settle('ds-1');
    expect(await store.mentalModels('ds-1')).not.toBeNull();

    await store.forget('ds-1');

    expect(await store.items('ds-1')).toEqual([]);
    expect(await store.mentalModels('ds-1')).toBeNull();
    expect(await store.holdsScope('ds-1')).toBe(false);
  });

  it('forgets an unknown id without error', async () => {
    const { store } = build();
    await expect(
      store.forget('ds-9', 'rating:none:x'),
    ).resolves.toBeUndefined();
  });

  it('removes the scopes a stopped eval run left, and nothing else', async () => {
    const first = build();
    await first.store.retain('eval-run1-case1-1', [
      signal('rating:e:1', 'Goals scored in the 2018 World Cup?'),
    ]);
    await first.store.retain('ds-1', [
      signal('rating:s1:a', 'Which stadium hosted the most matches?'),
    ]);
    await first.store.settle('eval-run1-case1-1');

    // The next start.
    const second = build();
    expect(await second.store.removeEvalScopes()).toBe(1);

    expect(await second.store.items('eval-run1-case1-1')).toEqual([]);
    expect(await second.store.holdsScope('eval-run1-case1-1')).toBe(false);
    expect((await second.store.items('ds-1')).length).toBeGreaterThan(0);
  });

  it('tells which scope holds a document id', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);

    expect(await store.scopesHolding('rating:s1:a')).toEqual(['ds-1']);
    expect(await store.scopesHolding('rating:none:x')).toEqual([]);
  });

  it('moves a signal whose datasource changed, keeping one copy', async () => {
    const { store } = build();
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);

    await store.retain('ds-2', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);

    expect(await store.items('ds-1')).toEqual([]);
    expect(
      (await store.items('ds-2')).filter((i) => i.kind === 'signal'),
    ).toHaveLength(1);
  });

  it('refuses to retain without an embedding key and recalls nothing', async () => {
    const { store, backend } = build({ hasKey: false });

    await expect(
      store.retain('ds-1', [
        signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
      ]),
    ).rejects.toThrow('No OpenAI key for embeddings');
    expect(await store.recall('ds-1', 'Goals?')).toEqual([]);
    expect(backend).not.toHaveBeenCalled();
  });

  it('gives nothing when recall does not answer within the cut-off', async () => {
    const { store } = build({ recallTimeoutMs: 50 });
    await store.retain('ds-1', [
      signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
    ]);
    const slow = build({ embedDelayMs: 500, recallTimeoutMs: 50 });

    const started = Date.now();
    expect(
      await slow.store.recall('ds-1', 'Goals scored at the 2018 World Cup?'),
    ).toEqual([]);
    expect(Date.now() - started).toBeLessThan(400);
    // The cut-off recall finishes in the background; let it before closing.
    await new Promise((resolve) => setTimeout(resolve, 600));
  });

  describe('the summary (knowledge R42)', () => {
    it('is rewritten from the stored signals, oldest first, after a retain', async () => {
      const { store, summary } = build();
      await store.retain('ds-1', [
        signal('rating:s1:b', 'Which stadium hosted the most matches?', {
          occurredAt: '2026-10-07T10:00:00.000Z',
        }),
        signal('rating:s1:a', 'Goals scored in the 2018 World Cup?', {
          occurredAt: '2026-10-01T10:00:00.000Z',
        }),
      ]);

      await store.settle('ds-1');

      expect(summary.generate).toHaveBeenCalledTimes(1);
      const [instructions, prompt] = summary.generate.mock.calls[0];
      expect(instructions).toContain('Known pitfalls');
      expect(instructions).toContain('Never quote a row value');
      expect(prompt.indexOf('2018 World Cup')).toBeLessThan(
        prompt.indexOf('stadium'),
      );
      expect(await store.mentalModels('ds-1')).toBe(
        'Known pitfalls\n- learned from 2 signal(s)',
      );
      expect(
        (await store.items('ds-1')).filter((i) => i.kind === 'summary'),
      ).toHaveLength(1);
    });

    it('is clipped to 2,000 characters', async () => {
      const { store } = build({
        summary: () =>
          Promise.resolve({ text: 'x'.repeat(3_000), model: 'gpt-5.6-luna' }),
      });
      await store.retain('ds-1', [
        signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
      ]);
      await store.settle('ds-1');

      expect(await store.mentalModels('ds-1')).toHaveLength(2_000);
    });

    it('is not sent after a forget until it is rewritten', async () => {
      const { store } = build();
      await store.retain('ds-1', [
        signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
        signal('rating:s1:b', 'Which stadium hosted the most matches?'),
      ]);
      await store.settle('ds-1');

      await store.forget('ds-1', 'rating:s1:a');
      expect(await store.mentalModels('ds-1')).toBeNull();

      await store.settle('ds-1');
      expect(await store.mentalModels('ds-1')).toBe(
        'Known pitfalls\n- learned from 1 signal(s)',
      );
    });
  });

  describe('usage of its own model calls (BA-190 R245)', () => {
    it('reports each embedding and each summary call under its scope', async () => {
      const { store } = build();
      const events: MemoryModelUsage[] = [];
      const stop = store.onUsage((usage) => events.push(usage));

      await store.retain('eval-r-c-1', [
        signal('rating:e:1', 'Goals scored in the 2018 World Cup?'),
      ]);
      await store.recall('eval-r-c-1', 'How many goals were scored in 2018?');
      await store.settle('eval-r-c-1');

      expect(events.map((e) => [e.scope, e.purpose, e.model])).toEqual([
        ['eval-r-c-1', 'embedding', 'text-embedding-3-small'],
        ['eval-r-c-1', 'embedding', 'text-embedding-3-small'],
        ['eval-r-c-1', 'summary', 'gpt-5.6-luna'],
      ]);
      expect(events[0].inputTokens).toBeGreaterThan(0);
      expect(events[0].outputTokens).toBe(0);
      expect(events[2]).toEqual({
        scope: 'eval-r-c-1',
        purpose: 'summary',
        model: 'gpt-5.6-luna',
        inputTokens: 120,
        outputTokens: 30,
        reasoningTokens: 4,
      });

      stop();
      await store.recall('eval-r-c-1', 'Which team won the 2022 final?');
      expect(events).toHaveLength(3);
    });

    it('survives a listener that throws', async () => {
      const { store } = build();
      store.onUsage(() => {
        throw new Error('listener broke');
      });

      await expect(
        store.retain('ds-1', [
          signal('rating:s1:a', 'Goals scored in the 2018 World Cup?'),
        ]),
      ).resolves.toBeUndefined();
      expect(
        await store.recall('ds-1', 'Goals scored in the 2018 World Cup?'),
      ).toHaveLength(1);
    });
  });
});
