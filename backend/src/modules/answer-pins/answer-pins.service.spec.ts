import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { AnswerPinsRepository } from './repositories/answer-pins.repository';
import { AnswerPinsService, stripForPin } from './answer-pins.service';
import { toPinSummary } from './entities/answer-pin.entity';
import type { AnswerPinDoc } from './entities/answer-pin.entity';
import type { ChatMessage } from '../sessions/entities/session.entity';
import type { ReasoningTrace } from '../expert-mode/entities/reasoning-trace.entity';

function pin(overrides: Partial<AnswerPinDoc> = {}): AnswerPinDoc {
  return {
    id: 'p1',
    lineageKey: 'lineage-1',
    fingerprint: 'fp-1',
    fingerprintParts: {
      v: 1,
      knowledge: 'k',
      metrics: 'm',
      verified: 'v',
      schema: 's',
      model: 'openai/gpt-5|effort=medium',
    },
    question: 'What was net revenue in fiscal year 2025?',
    normalizedQuestion: 'what was net revenue in fiscal year 2025',
    datasets: ['Retail'],
    chain: [],
    mode: 'expert',
    datasourceId: 'ds-1',
    sql: 'SELECT 1',
    columns: ['n'],
    rows: [{ n: 1 }],
    rowCount: 1,
    rowLimit: 500,
    message: { role: 'assistant', content: 'The answer is 1.' },
    knowledgeIds: ['k1'],
    sourceSessionId: 'session-1',
    sourceMessageAt: '2026-09-30T00:00:00.000Z',
    replays: 0,
    ...overrides,
  };
}

/** Real `SqliteDocStore` over an in-memory database, as other doc-store repo specs do. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<AnswerPinDoc>(db, 'answer_pins');
  const repository = new AnswerPinsRepository(store);
  return { service: new AnswerPinsService(repository), db };
}

describe('AnswerPinsService', () => {
  let db: BetterSqlite3.Database;
  let service: AnswerPinsService;

  beforeEach(() => {
    ({ service, db } = build());
  });

  afterEach(() => db.close());

  it('lookup finds nothing before a save', async () => {
    await expect(service.lookup('lineage-1')).resolves.toBeNull();
  });

  it('save inserts a new pin', async () => {
    const saved = await service.save(pin());
    expect(saved.lineageKey).toBe('lineage-1');
    await expect(service.lookup('lineage-1')).resolves.toEqual(
      expect.objectContaining({ lineageKey: 'lineage-1', sql: 'SELECT 1' }),
    );
  });

  it('save replaces — a re-derivation with a different shape leaves no stale fields', async () => {
    await service.save(
      pin({ knowledgeIds: ['k1', 'k2'], rows: [{ n: 1 }, { n: 2 }] }),
    );

    const replaced = await service.save(
      pin({ sql: 'SELECT 2', knowledgeIds: ['k3'], rows: [{ n: 9 }] }),
    );

    expect(replaced.knowledgeIds).toEqual(['k3']);
    expect(replaced.rows).toEqual([{ n: 9 }]);
    const stored = await service.lookup('lineage-1');
    // Only one document ever exists at this lineage.
    expect(stored?.knowledgeIds).toEqual(['k3']);
    await expect(service.list()).resolves.toHaveLength(1);
  });

  const approval = {
    fingerprint: 'fp-2',
    fingerprintParts: {
      v: 1 as const,
      knowledge: 'k',
      metrics: 'm',
      verified: 'v-approved',
      schema: 's',
      model: 'openai/gpt-5|effort=medium',
    },
    message: {
      role: 'assistant' as const,
      content: 'The answer is 1.',
      verified: true,
    },
  };

  it('approve merge-patches fingerprint, its parts and message', async () => {
    await service.save(pin());

    const approved = await service.approve('lineage-1', approval);

    expect(approved?.fingerprint).toBe('fp-2');
    expect(approved?.fingerprintParts.verified).toBe('v-approved');
    expect(approved?.message).toEqual(
      expect.objectContaining({ verified: true }),
    );
    // Fields not in the patch survive the merge.
    expect(approved?.sql).toBe('SELECT 1');
    await expect(service.lookup('lineage-1')).resolves.toEqual(
      expect.objectContaining({
        fingerprintParts: approval.fingerprintParts,
      }),
    );
  });

  it('approve on a missing pin is a no-op', async () => {
    await expect(service.approve('missing', approval)).resolves.toBeNull();
  });

  it('reject marks the pin rejected — it is kept, not deleted', async () => {
    await service.save(pin());

    await expect(
      service.reject('lineage-1', '2026-09-30T03:00:00.000Z', {
        block: 'metric',
      }),
    ).resolves.toBe(1);

    const stored = await service.lookup('lineage-1');
    expect(stored).toEqual(
      expect.objectContaining({
        sql: 'SELECT 1',
        rejectedAt: '2026-09-30T03:00:00.000Z',
        rejectedBy: { block: 'metric' },
      }),
    );
    await expect(
      service.reject('missing', '2026-09-30T03:00:00.000Z'),
    ).resolves.toBe(0);
  });

  it('a whole-answer reject drops the block an earlier reject named', async () => {
    await service.save(pin());
    await service.reject('lineage-1', '2026-09-30T03:00:00.000Z', {
      block: 'sql',
    });

    await service.reject('lineage-1', '2026-09-30T04:00:00.000Z');

    const stored = await service.lookup('lineage-1');
    expect(stored?.rejectedAt).toBe('2026-09-30T04:00:00.000Z');
    expect(stored).not.toHaveProperty('rejectedBy');
  });

  it('approve lifts a rejection', async () => {
    await service.save(pin());
    await service.reject('lineage-1', '2026-09-30T03:00:00.000Z', {
      block: 'sql',
    });

    const approved = await service.approve('lineage-1', approval);

    expect(approved).not.toHaveProperty('rejectedAt');
    expect(approved).not.toHaveProperty('rejectedBy');
    const stored = await service.lookup('lineage-1');
    expect(stored).not.toHaveProperty('rejectedAt');
    expect(stored?.fingerprint).toBe('fp-2');
  });

  it('save of a fresh derivation replaces a rejected pin with an un-rejected one', async () => {
    await service.save(pin());
    await service.reject('lineage-1', '2026-09-30T03:00:00.000Z');

    await service.save(pin({ sql: 'SELECT 2' }));

    const stored = await service.lookup('lineage-1');
    expect(stored?.sql).toBe('SELECT 2');
    expect(stored).not.toHaveProperty('rejectedAt');
  });

  it('remove deletes the pin and reports how many were removed', async () => {
    await service.save(pin());

    await expect(service.remove('lineage-1')).resolves.toBe(1);
    await expect(service.lookup('lineage-1')).resolves.toBeNull();
    await expect(service.remove('lineage-1')).resolves.toBe(0);
  });

  it('touchReplay bumps replays and stamps lastReplayedAt', async () => {
    await service.save(pin());

    const once = await service.touchReplay(
      'lineage-1',
      '2026-09-30T01:00:00.000Z',
    );
    expect(once?.replays).toBe(1);
    expect(once?.lastReplayedAt).toBe('2026-09-30T01:00:00.000Z');

    const twice = await service.touchReplay(
      'lineage-1',
      '2026-09-30T02:00:00.000Z',
    );
    expect(twice?.replays).toBe(2);
    expect(twice?.lastReplayedAt).toBe('2026-09-30T02:00:00.000Z');
  });

  it('touchReplay on a missing pin is a no-op', async () => {
    await expect(
      service.touchReplay('missing', '2026-09-30T00:00:00.000Z'),
    ).resolves.toBeNull();
  });

  it('list scopes to one dataset', async () => {
    await service.save(pin({ lineageKey: 'l-retail', datasets: ['Retail'] }));
    await service.save(
      pin({
        id: 'p2',
        lineageKey: 'l-hr',
        datasets: ['HR'],
        question: 'How many employees?',
        normalizedQuestion: 'how many employees',
      }),
    );

    await expect(service.list()).resolves.toHaveLength(2);
    const retailOnly = await service.list('Retail');
    expect(retailOnly.map((p) => p.lineageKey)).toEqual(['l-retail']);
  });

  it('deleteForDataset removes only pins touching that dataset', async () => {
    await service.save(pin({ lineageKey: 'l-retail', datasets: ['Retail'] }));
    await service.save(
      pin({
        id: 'p2',
        lineageKey: 'l-both',
        datasets: ['Retail', 'HR'],
        question: 'Cross-dataset question?',
        normalizedQuestion: 'cross-dataset question',
      }),
    );
    await service.save(
      pin({
        id: 'p3',
        lineageKey: 'l-hr',
        datasets: ['HR'],
        question: 'How many employees?',
        normalizedQuestion: 'how many employees',
      }),
    );

    const deleted = await service.deleteForDataset('Retail');

    expect(deleted).toBe(2);
    const remaining = await service.list();
    expect(remaining.map((p) => p.lineageKey)).toEqual(['l-hr']);
  });
});

describe('toPinSummary', () => {
  it('shows when a pin was rejected, and nothing when it was not', () => {
    expect(
      toPinSummary(pin({ rejectedAt: '2026-09-30T03:00:00.000Z' })),
    ).toEqual(
      expect.objectContaining({ rejectedAt: '2026-09-30T03:00:00.000Z' }),
    );
    expect(toPinSummary(pin())).not.toHaveProperty('rejectedAt');
    expect(toPinSummary(pin())).not.toHaveProperty('rows');
  });
});

describe('stripForPin', () => {
  const trace: ReasoningTrace = {
    id: 'trace-1',
    version: 1,
    blocks: [],
    overall: { score: 0.9, band: 'high', signals: [] },
    generatedAt: '2026-09-30T00:00:00.000Z',
    feedback: { sql: { vote: 'up', at: '2026-09-30T00:00:00.000Z' } },
  };

  const message: ChatMessage = {
    role: 'assistant',
    content: 'The answer is 1.',
    at: '2026-09-30T00:00:00.000Z',
    feedback: 'up',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    },
    consistency: { kind: 'replay', pinnedAt: '2026-09-29T00:00:00.000Z' },
    expertTrace: trace,
  };

  it('drops at/feedback/usage/consistency', () => {
    const stripped = stripForPin(message);
    expect(stripped).not.toHaveProperty('at');
    expect(stripped).not.toHaveProperty('feedback');
    expect(stripped).not.toHaveProperty('usage');
    expect(stripped).not.toHaveProperty('consistency');
    expect(stripped.content).toBe('The answer is 1.');
  });

  it('strips expertTrace.feedback but keeps the rest of the trace', () => {
    const stripped = stripForPin(message);
    expect(stripped.expertTrace).not.toHaveProperty('feedback');
    expect(stripped.expertTrace?.id).toBe('trace-1');
    expect(stripped.expertTrace?.overall).toEqual(trace.overall);
  });

  it('is a no-op on a message with no expertTrace', () => {
    const plain: ChatMessage = {
      role: 'assistant',
      content: 'Hi',
      at: '2026-09-30T00:00:00.000Z',
    };
    expect(stripForPin(plain)).toEqual({ role: 'assistant', content: 'Hi' });
  });
});
