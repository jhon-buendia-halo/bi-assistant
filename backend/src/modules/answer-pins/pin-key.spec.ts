import {
  fingerprintFor,
  knowledgePart,
  lineageKeyFor,
  modelPart,
  normalizeQuestion,
  schemaPart,
  textPart,
} from './pin-key';
import type { FingerprintParts } from './entities/answer-pin.entity';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import type { SchemaDataset } from './pin-key';

const KNOWLEDGE: KnowledgeUse[] = [
  { id: 'k1', kind: 'term', title: 'Fiscal year', body: 'Feb-Jan.' },
];

const SCHEMA: SchemaDataset[] = [
  {
    name: 'Retail',
    tables: ['retail.public.orders'],
    entities: [
      {
        key: 'retail.public.orders',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'total_amount', type: 'numeric', nullable: false },
        ],
      },
    ],
  },
];

function parts(overrides: Partial<FingerprintParts> = {}): FingerprintParts {
  return {
    v: 1,
    knowledge: knowledgePart(KNOWLEDGE),
    metrics: textPart('net revenue = ...'),
    verified: textPart(undefined),
    schema: schemaPart(SCHEMA),
    model: modelPart({
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'medium',
    }),
    ...overrides,
  };
}

describe('normalizeQuestion', () => {
  it('lowercases, collapses whitespace, trims and drops trailing punctuation', () => {
    expect(normalizeQuestion('  What was   Net Revenue?? ')).toBe(
      'what was net revenue',
    );
    expect(normalizeQuestion('Net revenue.')).toBe('net revenue');
    expect(normalizeQuestion('Net revenue!')).toBe('net revenue');
    expect(normalizeQuestion('Net revenue')).toBe('net revenue');
  });
});

describe('lineageKeyFor', () => {
  const base = {
    question: 'What was net revenue in fiscal year 2025?',
    datasets: ['Retail'],
    chain: [] as string[],
    mode: 'expert' as const,
  };

  it('is stable for the same inputs', () => {
    expect(lineageKeyFor(base)).toBe(lineageKeyFor({ ...base }));
  });

  it('ignores question case, whitespace and trailing punctuation', () => {
    const reworded = {
      ...base,
      question: '  what was   NET REVENUE in fiscal year 2025',
    };
    expect(lineageKeyFor(base)).toBe(lineageKeyFor(reworded));
  });

  it('ignores dataset order', () => {
    const reordered = { ...base, datasets: ['Orders', 'Retail'] };
    const original = { ...base, datasets: ['Retail', 'Orders'] };
    expect(lineageKeyFor(original)).toBe(lineageKeyFor(reordered));
  });

  it('changes when the chain changes', () => {
    const withChain = { ...base, chain: ['What datasets do we have?'] };
    expect(lineageKeyFor(base)).not.toBe(lineageKeyFor(withChain));
  });

  it('changes when the mode changes', () => {
    const plain = { ...base, mode: 'plain' as const };
    expect(lineageKeyFor(base)).not.toBe(lineageKeyFor(plain));
  });

  it('changes when the question changes', () => {
    const different = { ...base, question: 'How many orders in FY2025?' };
    expect(lineageKeyFor(base)).not.toBe(lineageKeyFor(different));
  });
});

describe('fingerprintFor', () => {
  it('is stable for the same parts', () => {
    expect(fingerprintFor(parts())).toBe(fingerprintFor(parts()));
  });

  it('changes when a knowledge body changes', () => {
    const changed: KnowledgeUse[] = [
      { id: 'k1', kind: 'term', title: 'Fiscal year', body: 'Mar-Feb.' },
    ];
    const fp = fingerprintFor(parts());
    const fpChanged = fingerprintFor(
      parts({ knowledge: knowledgePart(changed) }),
    );
    expect(fp).not.toBe(fpChanged);
  });

  it('changes when the metrics block changes', () => {
    const fp = fingerprintFor(parts());
    const fpChanged = fingerprintFor(
      parts({ metrics: textPart('net revenue = something else') }),
    );
    expect(fp).not.toBe(fpChanged);
  });

  it('changes when the verified block changes', () => {
    const fp = fingerprintFor(parts());
    const fpChanged = fingerprintFor(
      parts({ verified: textPart('SELECT 1 -- verified reference') }),
    );
    expect(fp).not.toBe(fpChanged);
  });

  it('changes when a column type changes', () => {
    const changedSchema: SchemaDataset[] = [
      {
        ...SCHEMA[0],
        entities: [
          {
            key: 'retail.public.orders',
            columns: [
              { name: 'id', type: 'integer', nullable: false },
              { name: 'total_amount', type: 'text', nullable: false },
            ],
          },
        ],
      },
    ];
    const fp = fingerprintFor(parts());
    const fpChanged = fingerprintFor(
      parts({ schema: schemaPart(changedSchema) }),
    );
    expect(fp).not.toBe(fpChanged);
  });

  it('changes when the model or reasoning effort changes', () => {
    const fp = fingerprintFor(parts());
    const fpModel = fingerprintFor(
      parts({
        model: modelPart({
          provider: 'openai',
          model: 'gpt-4.1',
          reasoningEffort: 'medium',
        }),
      }),
    );
    const fpEffort = fingerprintFor(
      parts({
        model: modelPart({
          provider: 'openai',
          model: 'gpt-5',
          reasoningEffort: 'high',
        }),
      }),
    );
    expect(fp).not.toBe(fpModel);
    expect(fp).not.toBe(fpEffort);
  });

  it('falls back to a stable default model id when unconfigured', () => {
    const unconfigured = modelPart({
      provider: null,
      model: null,
      reasoningEffort: 'high',
    });
    expect(unconfigured).toBe('openai/gpt-4o-mini|effort=high');
  });

  it('does NOT change when only sample values change — schema hashes structure, not data', () => {
    const withSamples: SchemaDataset[] = [
      {
        ...SCHEMA[0],
        entities: [
          {
            key: 'retail.public.orders',
            columns: [
              { name: 'id', type: 'integer', nullable: false },
              {
                name: 'total_amount',
                type: 'numeric',
                nullable: false,
                sampleValues: ['12.50', '99.99'],
              },
            ],
          },
        ],
      },
    ];
    const fp = fingerprintFor(parts());
    const fpWithSamples = fingerprintFor(
      parts({ schema: schemaPart(withSamples) }),
    );
    expect(fp).toBe(fpWithSamples);
  });
});
