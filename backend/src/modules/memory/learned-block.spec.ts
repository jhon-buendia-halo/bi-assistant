import {
  LEARNED_BLOCK_HEADING,
  MENTAL_MODELS_HEADING,
  learnedBlock,
  mentalModelsBlock,
  toKnowledgeUse,
} from './learned-block';
import type { RecalledMemory } from './learning-store.port';

const memories: RecalledMemory[] = [
  {
    id: 'm-obs',
    type: 'observation',
    text: 'Revenue questions use net_amount,\n not gross_amount.',
    entities: ['main.sales.orders'],
    evidenceCount: 3,
  },
  {
    id: 'm-exp',
    type: 'experience',
    text: 'An analyst rejected a count over all matches for "finals".',
    occurredAt: '2026-09-28T10:00:00.000Z',
    entities: [],
  },
  {
    id: 'm-world',
    type: 'world',
    text: 'Fiscal year starts in February.',
    entities: [],
  },
];

describe('learnedBlock', () => {
  it('renders one labelled line per memory under the not-curated heading', () => {
    expect(learnedBlock(memories)).toBe(
      [
        LEARNED_BLOCK_HEADING,
        '- [observation · 3 evidences] Revenue questions use net_amount, not gross_amount.',
        '- [experience · 2026-09-28] An analyst rejected a count over all matches for "finals".',
        '- [world] Fiscal year starts in February.',
      ].join('\n'),
    );
    expect(LEARNED_BLOCK_HEADING).toBe(
      '## Learned from past sessions (not curated; curated knowledge wins on conflict)',
    );
  });

  it('says "evidence" for one and drops the label detail it does not have', () => {
    const block = learnedBlock([
      {
        id: 'a',
        type: 'observation',
        text: 'One rule',
        entities: [],
        evidenceCount: 1,
      },
      { id: 'b', type: 'experience', text: 'Undated', entities: [] },
    ]);
    expect(block).toContain('- [observation · 1 evidence] One rule');
    expect(block).toContain('- [experience] Undated');
  });

  it('is undefined when nothing was recalled — no memories, no block', () => {
    expect(learnedBlock([])).toBeUndefined();
    expect(
      learnedBlock([{ id: 'x', type: 'world', text: '   ', entities: [] }]),
    ).toBeUndefined();
  });
});

describe('mentalModelsBlock', () => {
  it('renders a section per model with content', () => {
    expect(
      mentalModelsBlock([
        {
          id: 'known-pitfalls',
          name: 'Errores conocidos',
          content: '- Use net_amount',
        },
        { id: 'table-guide', name: 'Guía de tablas', content: '  ' },
      ]),
    ).toBe(
      `${MENTAL_MODELS_HEADING}\n\n### Errores conocidos\n- Use net_amount`,
    );
  });

  it('is undefined without models', () => {
    expect(mentalModelsBlock([])).toBeUndefined();
  });
});

describe('toKnowledgeUse', () => {
  it('records each memory as a memory-sourced Knowledge in context entry', () => {
    expect(toKnowledgeUse(memories.slice(0, 1))).toEqual([
      {
        id: 'm-obs',
        kind: 'instruction',
        title: 'observation memory',
        body: 'Revenue questions use net_amount, not gross_amount.',
        source: 'memory',
      },
    ]);
  });
});
