/**
 * Write answer's model call (agents.md 5.11; plan 1.25.6): the answer's row
 * markers are expanded into tables from the stored rows, in the stored
 * answer and in the streamed text, and never reach a reader. The agents are
 * stubbed: Jest cannot load Mastra's ESM.
 */
const stream = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/answer-writer.agent', () => ({
  answerWriterAgent: { stream: (...args: unknown[]) => stream(...args) },
}));
jest.mock('../agents/analysis-planner.agent', () => ({
  analysisPlannerAgent: {},
}));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessStepAgent: {},
}));

import { writeAnswerWithModel } from './answer-business-question.agents';
import type {
  AnalyseQuery,
  AnalysisPlan,
} from './answer-business-question.steps';

const PLAN: AnalysisPlan = {
  question: 'Which 100 drivers have the most race starts?',
  measures: ['race starts'],
  entities: ['f1.drivers'],
  scope: 'All seasons.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

const rows = Array.from({ length: 102 }, (_, i) => ({
  name: `Driver ${i + 1}`,
  total_race_starts: 400 - i,
}));
const QUERY: AnalyseQuery = {
  sql: 'SELECT name, total_race_starts FROM drivers ORDER BY 2 DESC LIMIT 102',
  rationale: 'I rank the drivers by race starts.',
  rows,
  rowCount: 102,
  truncated: false,
};

/** A model reply streamed as partial objects, a few characters at a time. */
function reply(answer: string, headline: string) {
  const partials: { headline: string; answer: string }[] = [];
  for (let i = 3; i < answer.length; i += 3) {
    partials.push({ headline, answer: answer.slice(0, i) });
  }
  return {
    objectStream: (async function* () {
      for (const partial of partials) yield await Promise.resolve(partial);
    })(),
    object: Promise.resolve({ headline, answer }),
    text: Promise.resolve(JSON.stringify({ headline, answer })),
    error: undefined,
  };
}

describe('writeAnswerWithModel (plan 1.25.6)', () => {
  beforeEach(() => stream.mockReset());

  it('stores the answer with its marker expanded, and never streams a marker', async () => {
    stream.mockResolvedValue(
      reply(
        'Lewis Hamilton leads with 400 starts.\n\n[[rows:1 | name=Driver, total_race_starts=Race starts]]\n\nThe list covers every season.',
        'Lewis Hamilton leads with 400 starts.',
      ),
    );
    const deltas: string[] = [];
    const { answer } = await writeAnswerWithModel(
      { question: PLAN.question, plan: PLAN, queries: [QUERY], findings: [] },
      { onText: (delta) => deltas.push(delta) },
    );
    expect(answer.headline).toBe('Lewis Hamilton leads with 400 starts.');
    expect(answer.answer).not.toContain('[[');
    expect(answer.answer).toContain('| Driver | Race starts |');
    expect(answer.answer).toContain('| Driver 102 | 299 |');
    expect(answer.answer.endsWith('The list covers every season.')).toBe(true);
    expect(deltas.join('')).toBe(answer.answer);
    expect(deltas.some((delta) => delta.includes('[['))).toBe(false);
  });

  it('removes a marker it cannot expand', async () => {
    stream.mockResolvedValue(reply('Nothing to list.\n[[rows:7]]', 'Nothing.'));
    const { answer } = await writeAnswerWithModel(
      { question: PLAN.question, plan: PLAN, queries: [QUERY], findings: [] },
      {},
    );
    expect(answer.answer).toBe('Nothing to list.');
  });
});
