import type { RecalledSignal } from './learning-store.port';
import { LEARNED_BLOCK_HEADING, learnedBlock } from './learned-block';

const recalled = (
  documentId: string,
  day: string,
  question: string,
  kind: RecalledSignal['kind'] = 'verified_query',
): RecalledSignal => ({
  documentId,
  kind,
  content: `[${kind} · ${day}]\nQuestion: ${question}\nApproved SQL: SELECT 1`,
  occurredAt: `${day}T10:00:00.000Z`,
});

describe('learnedBlock (agents.md 4.1, Block 3b)', () => {
  it('sends no block when no memory has a summary or a signal', () => {
    expect(
      learnedBlock([
        { scope: 'ds-1', summary: null, signals: [] },
        { scope: 'ds-2', summary: '  ', signals: [] },
      ]),
    ).toEqual({ used: [] });
  });

  it('puts the summaries first, then the signals oldest first, a blank line apart', () => {
    const older = recalled('rating:s1:a', '2026-10-01', 'Goals in 2018?');
    const newer = recalled(
      'rating:s2:a',
      '2026-10-07',
      'Goals in 2022?',
      'rejection',
    );

    const { block, used } = learnedBlock([
      {
        scope: 'ds-1',
        summary: 'Known pitfalls\n- own goals',
        signals: [newer],
      },
      { scope: 'ds-2', summary: null, signals: [older] },
    ]);

    expect(block).toBe(
      [
        LEARNED_BLOCK_HEADING,
        'Summary:',
        'Known pitfalls',
        '- own goals',
        '',
        older.content,
        '',
        newer.content,
      ].join('\n'),
    );
    expect(used).toEqual([
      {
        id: 'summary:ds-1',
        kind: 'summary',
        title: 'summary',
        body: 'Known pitfalls\n- own goals',
        source: 'memory',
      },
      {
        id: 'rating:s1:a',
        kind: 'verified_query',
        title: 'verified_query · 2026-10-01',
        body: older.content,
        source: 'memory',
      },
      {
        id: 'rating:s2:a',
        kind: 'rejection',
        title: 'rejection · 2026-10-07',
        body: newer.content,
        source: 'memory',
      },
    ]);
  });

  it('sends a text found in two memories once', () => {
    const one = recalled('rating:s1:a', '2026-10-01', 'Goals in 2018?');
    const same = {
      ...one,
      documentId: 'rating:s9:a',
      occurredAt: '2026-10-01T11:00:00.000Z',
    };

    const { used } = learnedBlock([
      { scope: 'ds-1', summary: null, signals: [one] },
      { scope: 'ds-2', summary: null, signals: [same] },
    ]);

    expect(used.map((u) => u.id)).toEqual(['rating:s9:a']);
  });

  it('leaves the oldest signals out first when they do not all fit', () => {
    const signals = ['01', '02', '03', '04'].map((d) =>
      recalled(`rating:s:${d}`, `2026-10-${d}`, 'q'.repeat(40)),
    );
    const size = signals[0].content.length;

    const { used } = learnedBlock(
      [{ scope: 'ds-1', summary: 's'.repeat(10), signals }],
      10 + size * 2 + 5,
    );

    expect(used.map((u) => u.id)).toEqual([
      'summary:ds-1',
      'rating:s:03',
      'rating:s:04',
    ]);
  });

  it('keeps the budget at 6,000 characters of summaries and signals', () => {
    const signals = Array.from({ length: 80 }, (_, i) =>
      recalled(
        `rating:s:${i}`,
        `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        `q${i} ${'x'.repeat(60)}`,
      ),
    );

    const { used } = learnedBlock([
      { scope: 'ds-1', summary: 'y'.repeat(2_000), signals },
    ]);

    const total = used.reduce((sum, entry) => sum + entry.body.length, 0);
    expect(total).toBeLessThanOrEqual(6_000);
    expect(total).toBeGreaterThan(6_000 - signals[0].content.length - 10);
  });
});
