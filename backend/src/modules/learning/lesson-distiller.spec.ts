// `lesson-distiller.ts` imports `schemaSection` from `expert-mode.service.ts`,
// which (for its own `business-expert` agent and `MastraService` constructor
// param type) pulls in real Mastra `Agent`s and `mastra/index.ts` at module
// scope — same ESM-under-Jest problem `expert-mode.service.spec.ts` and
// `knowledge.service.spec.ts` work around; mocked out the same way.
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(readonly config: unknown) {}
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));

import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type { AssumptionsBlock } from '../expert-mode/entities/reasoning-trace.entity';
import {
  blockTitle,
  buildLearnPrompt,
  sanitiseLessons,
  verbatimFallback,
  type LearnPromptInput,
} from './lesson-distiller';

const ENTITIES: DatasetEntitySnapshot[] = [
  {
    key: 'world_cup.retail.orders',
    columns: [
      { name: 'id', type: 'integer', nullable: false },
      { name: 'ordered_at', type: 'date', nullable: false },
      { name: 'total_amount', type: 'numeric', nullable: false },
    ],
  },
  {
    key: 'world_cup.retail.order_lines',
    columns: [{ name: 'order_id', type: 'integer', nullable: false }],
  },
];

const BLOCK: AssumptionsBlock = {
  kind: 'assumptions',
  items: [],
  confidence: { score: 0.5, band: 'medium', signals: [] },
};

function promptInput(overrides: Partial<LearnPromptInput> = {}): LearnPromptInput {
  return {
    datasets: ['Retail'],
    question: 'What was our net revenue in fiscal year 2025?',
    answer: 'Net revenue in FY2025 was $1,204,300.',
    block: 'assumptions',
    vote: 'down',
    comment: 'Fiscal year runs 1 Feb to 31 Jan.',
    blockSnapshot: BLOCK,
    finalSql: 'SELECT SUM(total_amount) FROM world_cup.retail.orders',
    entities: ENTITIES,
    existingTitles: ['Order date'],
    ...overrides,
  };
}

describe('buildLearnPrompt', () => {
  it('includes every section with the given content', () => {
    const prompt = buildLearnPrompt(promptInput());
    expect(prompt).toContain('<dataset>\nRetail\n</dataset>');
    expect(prompt).toContain('world_cup.retail.orders');
    expect(prompt).toContain('<question>\nWhat was our net revenue in fiscal year 2025?\n</question>');
    expect(prompt).toContain('Net revenue in FY2025 was $1,204,300.');
    expect(prompt).toContain('<rated-block kind="assumptions" vote="down">');
    expect(prompt).toContain('"kind":"assumptions"');
    expect(prompt).toContain('SELECT SUM(total_amount) FROM world_cup.retail.orders');
    expect(prompt).toContain('<existing-knowledge-titles>\nOrder date\n</existing-knowledge-titles>');
    expect(prompt).toContain('<reviewer-note>\nFiscal year runs 1 Feb to 31 Jan.\n</reviewer-note>');
  });

  it('clips a long answer to the budget', () => {
    const prompt = buildLearnPrompt(promptInput({ answer: 'x'.repeat(3000) }));
    const answerSection = prompt.split('<answer>')[1].split('</answer>')[0];
    expect(answerSection.trim().length).toBeLessThanOrEqual(2000);
  });

  it('falls back to placeholders for an unrated dataset/vote/sql', () => {
    const prompt = buildLearnPrompt(
      promptInput({ datasets: [], vote: undefined, finalSql: undefined }),
    );
    expect(prompt).toContain('<dataset>\n(none)\n</dataset>');
    expect(prompt).toContain('kind="assumptions" vote="none"');
    expect(prompt).toContain('<final-sql>\n(no final SQL ran)\n</final-sql>');
  });
});

describe('blockTitle', () => {
  it('maps every reasoning block kind to a human label', () => {
    expect(blockTitle('interpretation')).toBe('Interpretation');
    expect(blockTitle('data-selection')).toBe('Data selection');
    expect(blockTitle('assumptions')).toBe('Assumptions');
    expect(blockTitle('metric')).toBe('Metric');
    expect(blockTitle('sql')).toBe('SQL');
  });
});

describe('sanitiseLessons', () => {
  const entityKeys = ENTITIES.map((e) => e.key);

  it('passes through a well-formed lesson', () => {
    const result = sanitiseLessons(
      [
        {
          kind: 'term',
          title: 'Fiscal year',
          body: 'Runs 1 Feb to 31 Jan, named for the year it starts.',
          synonyms: ['FY'],
          entities: ['world_cup.retail.orders'],
        },
      ],
      entityKeys,
    );
    expect(result).toEqual([
      {
        kind: 'term',
        title: 'Fiscal year',
        body: 'Runs 1 Feb to 31 Jan, named for the year it starts.',
        synonyms: ['FY'],
        entities: ['world_cup.retail.orders'],
      },
    ]);
  });

  it('drops entities not present in the schema keys', () => {
    const [lesson] = sanitiseLessons(
      [
        {
          kind: 'term',
          title: 'Fiscal year',
          body: 'Runs 1 Feb to 31 Jan.',
          synonyms: [],
          entities: ['world_cup.retail.orders', 'world_cup.retail.made_up'],
        },
      ],
      entityKeys,
    );
    expect(lesson.entities).toEqual(['world_cup.retail.orders']);
  });

  it('folds appliesWhen into the body as "Applies when: …"', () => {
    const [lesson] = sanitiseLessons(
      [
        {
          kind: 'term',
          title: 'Fiscal year',
          body: 'Runs 1 Feb to 31 Jan.',
          synonyms: [],
          entities: [],
          appliesWhen: 'the question says fiscal year or FY',
        },
      ],
      entityKeys,
    );
    expect(lesson.body).toBe(
      'Runs 1 Feb to 31 Jan.\n\nApplies when: the question says fiscal year or FY',
    );
  });

  it('de-duplicates titles, keeping the first occurrence', () => {
    const result = sanitiseLessons(
      [
        {
          kind: 'term',
          title: 'Fiscal year',
          body: 'First version of the rule.',
          synonyms: [],
          entities: [],
        },
        {
          kind: 'term',
          title: 'fiscal year',
          body: 'Second, different version of the rule.',
          synonyms: [],
          entities: [],
        },
      ],
      entityKeys,
    );
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('First version of the rule.');
  });

  it('clamps an overlong title and body', () => {
    const [lesson] = sanitiseLessons(
      [
        {
          kind: 'instruction',
          title: 'T'.repeat(200),
          body: 'B'.repeat(900),
          synonyms: [],
          entities: [],
        },
      ],
      entityKeys,
    );
    expect(lesson.title.length).toBeLessThanOrEqual(80);
    expect(lesson.body.length).toBeLessThanOrEqual(500);
  });

  it('drops a draft with no title or no body', () => {
    const result = sanitiseLessons(
      [
        { kind: 'term', title: '  ', body: 'Has a body.', synonyms: [], entities: [] },
        { kind: 'term', title: 'Has a title', body: '   ', synonyms: [], entities: [] },
      ],
      entityKeys,
    );
    expect(result).toEqual([]);
  });

  it('returns [] for an empty or undefined list', () => {
    expect(sanitiseLessons([], entityKeys)).toEqual([]);
    expect(sanitiseLessons(undefined, entityKeys)).toEqual([]);
  });
});

describe('verbatimFallback', () => {
  it('titles the lesson after the rated block and copies the comment verbatim', () => {
    const lesson = verbatimFallback('assumptions', '  Wrong fiscal year.  ');
    expect(lesson).toEqual({
      kind: 'instruction',
      title: 'Reviewer note: Assumptions',
      body: 'Wrong fiscal year.',
      synonyms: [],
      entities: [],
    });
  });

  it('clamps an overlong comment', () => {
    const lesson = verbatimFallback('sql', 'x'.repeat(900));
    expect(lesson.body.length).toBeLessThanOrEqual(500);
  });
});
