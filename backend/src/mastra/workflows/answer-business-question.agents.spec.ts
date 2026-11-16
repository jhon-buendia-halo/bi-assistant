/**
 * Write answer's model call (agents.md 5.11; plan 1.25.6): the answer's row
 * markers are expanded into tables from the stored rows, in the stored
 * answer and in the streamed text, and never reach a reader. The agents are
 * stubbed: Jest cannot load Mastra's ESM.
 */
const stream = jest.fn<Promise<unknown>, unknown[]>();
const generate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/answer-writer.agent', () => ({
  answerWriterAgent: { stream: (...args: unknown[]) => stream(...args) },
}));
jest.mock('../agents/analysis-planner.agent', () => ({
  analysisPlannerAgent: {
    generate: (...args: unknown[]) => generate(...args),
  },
}));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessStepAgent: {},
}));

import {
  planWithModel,
  writeAnswerWithModel,
} from './answer-business-question.agents';
import {
  findingStatus,
  writeAnswerRequest,
} from './answer-business-question.prompts';
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

// Read images' notes (agents.md 2.15, 5.11): what the model receives.
describe("the model calls with Read images' notes", () => {
  const NOTES = '## Reference images\nA bar chart of race starts.';
  const INPUT = {
    question: PLAN.question,
    plan: PLAN,
    queries: [QUERY],
    findings: [],
  };

  beforeEach(() => {
    stream.mockReset();
    generate.mockReset();
  });

  it("sends Write answer's request unchanged without notes, and with them after the plan", async () => {
    stream.mockResolvedValue(reply('Lewis leads.', 'Lewis leads.'));
    await writeAnswerWithModel({ ...INPUT, imageNotes: '' }, {});
    await writeAnswerWithModel({ ...INPUT, imageNotes: NOTES }, {});
    const [plain, noted] = stream.mock.calls.map((call) => call[0] as string);
    expect(plain).toBe(writeAnswerRequest(INPUT));
    expect(noted).toContain(`${JSON.stringify(PLAN)}\n\n${NOTES}\n\n`);
  });

  it("sends Plan's request unchanged without notes, and with them after the catalog", async () => {
    generate.mockResolvedValue({ object: PLAN, text: JSON.stringify(PLAN) });
    const base = { messages: 'Q', question: 'Q', catalogBlock: 'CAT' };
    await planWithModel({ ...base, imageNotes: '' }, {});
    await planWithModel({ ...base, imageNotes: NOTES }, {});
    expect(generate.mock.calls.map((call) => call[0])).toEqual([
      'Question: Q\n\nCAT',
      `Question: Q\n\nCAT\n\n${NOTES}`,
    ]);
  });
});

describe('the findings as the writer reads them (roadmap 1.29.8, issue D)', () => {
  it('reads a warning-only check that did not pass as a warning, never as failed', () => {
    expect(findingStatus({ passed: true, check: 'Ran a query' })).toBe(
      'passed',
    );
    expect(findingStatus({ passed: false, check: 'Ran a query' })).toBe(
      'failed',
    );
    expect(
      findingStatus({
        passed: false,
        check: 'Measures covered (warning only)',
      }),
    ).toBe('warning');
  });

  it('writes the warning into the request with its status', () => {
    const request = writeAnswerRequest({
      question: 'How many orders were delivered?',
      plan: {
        question: 'How many orders were delivered?',
        measures: ['delivered orders'],
        entities: ['orders'],
        scope: 'all',
        assumptions: [],
        needsClarification: false,
        clarification: null,
      },
      queries: [],
      findings: [
        {
          check: 'Measures covered (warning only)',
          passed: false,
          detail: 'No query names "delivery rate".',
        },
        { check: 'Ran a query', passed: false, detail: 'No SQL query ran.' },
      ],
    });
    expect(request).toContain('- warning: Measures covered (warning only).');
    expect(request).toContain('- failed: Ran a query.');
  });
});
