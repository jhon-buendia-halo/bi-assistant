// `feedback-learner.agent.ts` (and `expert-mode.service.ts`'s own
// `business-expert.agent.ts` import) build real Mastra `Agent`s at module
// scope; `mastra.service.ts` pulls in `mastra/index.ts` (every registered
// agent, plus `@mastra/core/agent`'s ESM-only transitive deps); `knowledge
// .service.ts` pulls in the Databricks connector via `DatasourcesService`.
// All mocked out, same pattern as `knowledge.service.spec.ts` and
// `expert-mode.service.spec.ts`, so this suite stays on Jest's CommonJS
// transform without needing the real Mastra runtime or a live datasource.
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(readonly config: unknown) {}
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));

import { LearningService, type LearnInput } from './learning.service';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type { AssumptionsBlock } from '../expert-mode/entities/reasoning-trace.entity';
import type { KnowledgeSnippet } from '../knowledge/entities/knowledge-snippet.entity';

const ENTITIES: DatasetEntitySnapshot[] = [
  {
    key: 'world_cup.retail.orders',
    columns: [
      { name: 'id', type: 'integer', nullable: false },
      { name: 'ordered_at', type: 'date', nullable: false },
    ],
  },
];

const BLOCK: AssumptionsBlock = {
  kind: 'assumptions',
  items: [],
  confidence: { score: 0.5, band: 'medium', signals: [] },
};

function input(overrides: Partial<LearnInput> = {}): LearnInput {
  return {
    sessionId: 'session-1',
    messageAt: '2026-09-30T00:00:00.000Z',
    feedbackId: 'feedback-1',
    datasets: ['Retail'],
    question: 'What was our net revenue in fiscal year 2025?',
    answer: 'Net revenue in FY2025 was $1,204,300.',
    block: 'assumptions',
    vote: 'down',
    comment: 'Our fiscal year runs 1 Feb to 31 Jan.',
    blockSnapshot: BLOCK,
    finalSql: 'SELECT SUM(total_amount) FROM world_cup.retail.orders',
    entities: ENTITIES,
    existingTitles: [],
    ...overrides,
  };
}

function build(options: { generate?: jest.Mock; superseded?: number } = {}) {
  const generate = options.generate ?? jest.fn();
  const mastra = { getAgent: jest.fn().mockReturnValue({ generate }) };
  const created: KnowledgeSnippet[] = [];
  const calls: string[] = [];
  const knowledge = {
    createLearned: jest.fn().mockImplementation(async (draft, provenance) => {
      calls.push('createLearned');
      const snippet: KnowledgeSnippet = {
        id: `snippet-${created.length + 1}`,
        ...draft,
        scope: draft.scope ?? null,
        enabled: draft.enabled ?? true,
        source: 'feedback' as const,
        provenance,
        createdAt: '2026-09-30T00:05:00.000Z',
        updatedAt: '2026-09-30T00:05:00.000Z',
      };
      created.push(snippet);
      return snippet;
    }),
    deleteLearnedFor: jest.fn().mockImplementation(async () => {
      calls.push('deleteLearnedFor');
      return options.superseded ?? 0;
    }),
    listLearned: jest.fn().mockResolvedValue([]),
  };
  const service = new LearningService(mastra as never, knowledge as never);
  return { service, mastra, generate, knowledge, created, calls };
}

describe('LearningService.learnFromComment', () => {
  it('calls the feedback-learner agent once, tool-free, with structured output', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: {
        lessons: [
          {
            kind: 'term',
            title: 'Fiscal year',
            body: 'Runs 1 Feb to 31 Jan, named for the year it starts.',
            synonyms: [],
            entities: [],
          },
        ],
      },
    });
    const { service, mastra } = build({ generate });

    await service.learnFromComment(input());

    expect(mastra.getAgent).toHaveBeenCalledWith('feedback-learner');
    expect(generate).toHaveBeenCalledTimes(1);
    const [prompt, options] = generate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).toEqual(
      expect.objectContaining({
        maxSteps: 1,
        toolChoice: 'none',
        providerOptions: { openai: { reasoningEffort: 'medium' } },
        structuredOutput: expect.objectContaining({
          jsonPromptInjection: 'inline',
        }),
      }),
    );
    expect(prompt).toContain('What was our net revenue in fiscal year 2025?');
    expect(prompt).toContain('Our fiscal year runs 1 Feb to 31 Jan.');
  });

  it('persists a returned lesson with provenance, once per dataset in scope', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: {
        lessons: [
          {
            kind: 'term',
            title: 'Fiscal year',
            body: 'Runs 1 Feb to 31 Jan.',
            synonyms: ['FY'],
            entities: [],
          },
        ],
      },
    });
    const { service, knowledge } = build({
      generate,
      superseded: 2,
    });

    const result = await service.learnFromComment(
      input({ datasets: ['Retail', 'Retail Returns'] }),
    );

    expect(knowledge.createLearned).toHaveBeenCalledTimes(2);
    const [firstDraft, firstProvenance] = knowledge.createLearned.mock.calls[0];
    expect(firstDraft).toEqual(
      expect.objectContaining({
        kind: 'term',
        scope: { datasetId: 'Retail' },
        title: 'Fiscal year',
        body: 'Runs 1 Feb to 31 Jan.',
        synonyms: ['FY'],
        enabled: true,
      }),
    );
    expect(firstProvenance).toEqual({
      feedbackId: 'feedback-1',
      sessionId: 'session-1',
      messageAt: '2026-09-30T00:00:00.000Z',
      block: 'assumptions',
      question: 'What was our net revenue in fiscal year 2025?',
      comment: 'Our fiscal year runs 1 Feb to 31 Jan.',
      vote: 'down',
      learnedAt: expect.any(String),
      method: 'agent',
    });
    const [secondDraft] = knowledge.createLearned.mock.calls[1];
    expect(secondDraft.scope).toEqual({ datasetId: 'Retail Returns' });

    // One LearnedLesson per distinct lesson (not per dataset copy); its id
    // is the first created snippet's.
    expect(result.lessons).toEqual([
      {
        id: 'snippet-1',
        kind: 'term',
        title: 'Fiscal year',
        body: 'Runs 1 Feb to 31 Jan.',
        method: 'agent',
      },
    ]);
    expect(result.superseded).toBe(2);
  });

  it('re-learn deletes the feedback doc\'s previous lessons before creating new ones', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: { lessons: [{ kind: 'term', title: 'Fiscal year', body: 'Runs 1 Feb to 31 Jan.' }] },
    });
    const { service, calls } = build({ generate, superseded: 1 });

    await service.learnFromComment(input());

    expect(calls[0]).toBe('deleteLearnedFor');
    expect(calls).toContain('createLearned');
    expect(calls.indexOf('deleteLearnedFor')).toBeLessThan(
      calls.indexOf('createLearned'),
    );
  });

  it('falls back to the reviewer\'s note verbatim after two unusable replies', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce({ object: { lessons: [{ kind: 'not-a-kind' }] } })
      .mockResolvedValueOnce({ object: { lessons: [{ kind: 'still-bad' }] } });
    const { service, knowledge } = build({ generate });

    const result = await service.learnFromComment(input());

    expect(generate).toHaveBeenCalledTimes(2);
    expect(knowledge.createLearned).toHaveBeenCalledTimes(1);
    const [draft, provenance] = knowledge.createLearned.mock.calls[0];
    expect(draft).toEqual(
      expect.objectContaining({
        kind: 'instruction',
        title: 'Reviewer note: Assumptions',
        body: 'Our fiscal year runs 1 Feb to 31 Jan.',
      }),
    );
    expect(provenance.method).toBe('verbatim');
    expect(result.lessons).toEqual([
      {
        id: 'snippet-1',
        kind: 'instruction',
        title: 'Reviewer note: Assumptions',
        body: 'Our fiscal year runs 1 Feb to 31 Jan.',
        method: 'verbatim',
      },
    ]);
  });

  it('falls back to verbatim when the agent throws both times', async () => {
    const generate = jest.fn().mockRejectedValue(new Error('boom'));
    const { service, knowledge } = build({ generate });

    const result = await service.learnFromComment(input());

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.lessons[0].method).toBe('verbatim');
    expect(knowledge.createLearned).toHaveBeenCalledTimes(1);
  });

  it('persists nothing when the agent finds nothing to learn, but still counts superseded', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: { lessons: [], nothingToLearn: 'the note only says the answer is wrong' },
    });
    const { service, knowledge } = build({ generate, superseded: 3 });

    const result = await service.learnFromComment(input());

    expect(knowledge.createLearned).not.toHaveBeenCalled();
    expect(result).toEqual({ lessons: [], superseded: 3 });
  });

  it('skips the model call entirely for an empty comment, but still deletes superseded lessons', async () => {
    const generate = jest.fn();
    const { service, knowledge } = build({ generate, superseded: 1 });

    const result = await service.learnFromComment(input({ comment: '   ' }));

    expect(generate).not.toHaveBeenCalled();
    expect(knowledge.deleteLearnedFor).toHaveBeenCalledWith('feedback-1');
    expect(knowledge.createLearned).not.toHaveBeenCalled();
    expect(result).toEqual({ lessons: [], superseded: 1 });
  });

  it('drops an entity the agent named that is not in the schema', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: {
        lessons: [
          {
            kind: 'term',
            title: 'Fiscal year',
            body: 'Runs 1 Feb to 31 Jan.',
            entities: ['world_cup.retail.orders', 'world_cup.retail.made_up'],
          },
        ],
      },
    });
    const { service, knowledge } = build({ generate });

    await service.learnFromComment(input());

    const [draft] = knowledge.createLearned.mock.calls[0];
    expect(draft.entities).toEqual(['world_cup.retail.orders']);
  });

  it('folds appliesWhen into the persisted body', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: {
        lessons: [
          {
            kind: 'term',
            title: 'Fiscal year',
            body: 'Runs 1 Feb to 31 Jan.',
            appliesWhen: 'the question says fiscal year or FY',
          },
        ],
      },
    });
    const { service, knowledge } = build({ generate });

    await service.learnFromComment(input());

    const [draft] = knowledge.createLearned.mock.calls[0];
    expect(draft.body).toBe(
      'Runs 1 Feb to 31 Jan.\n\nApplies when: the question says fiscal year or FY',
    );
  });
});

describe('LearningService.forget', () => {
  it('deletes every lesson learned from the feedback doc', async () => {
    const { service, knowledge } = build({ superseded: 4 });

    const removed = await service.forget('feedback-1');

    expect(knowledge.deleteLearnedFor).toHaveBeenCalledWith('feedback-1');
    expect(removed).toBe(4);
  });
});
