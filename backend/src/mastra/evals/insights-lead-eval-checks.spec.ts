// The checks of the `insights-lead` set, each on one run shaped as the run
// store keeps it (the `answer` step's tool calls and the stored answer with
// its rows and checks). The fixture's calls, rows and answer are those of a
// real stored Avery run (Retail Ops), restructured as Elena's one-step run.
// No model is called.
import { readFileSync } from 'fs';
import { join } from 'path';
import type { EvalCustomCheck } from './assistant.evals';
import { INSIGHTS_LEAD_TOOL_NAMES } from '../agents/insights-lead-catalog';
import {
  answerIncludes,
  answerMatches,
  asksAtMostOnce,
  calledTool,
  callsOnlyHerTools,
  clarificationOffersOptions,
  didNotCall,
  figureText,
  figuresFromQueries,
  noToolErrors,
  ranAQuery,
  repairAtMostOnce,
  runEndsIn,
  toolOrder,
} from './insights-lead-eval-checks';
import {
  insightsLeadRunView,
  type InsightsLeadRunView,
  type StoredInsightsLeadRun,
} from './insights-lead-target';

const QUESTION = 'Which store had the highest sales last quarter?';

const stored: StoredInsightsLeadRun = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'insights-lead-run.json'),
    'utf8',
  ),
) as StoredInsightsLeadRun;

function view(
  overrides: Partial<InsightsLeadRunView> = {},
): InsightsLeadRunView {
  return { ...insightsLeadRunView(stored), ...overrides };
}

async function verdict(
  check: EvalCustomCheck,
  run: InsightsLeadRunView,
): Promise<string | undefined> {
  return check.run({
    answer: run.answer,
    toolCalls: [],
    datasets: [],
    vars: {},
    details: { output: run },
  });
}

describe('ranAQuery', () => {
  it('passes on a run whose queries succeeded', async () => {
    await expect(verdict(ranAQuery(), view())).resolves.toBeUndefined();
  });

  it('fails when she ran no query', async () => {
    await expect(verdict(ranAQuery(), view({ calls: [] }))).resolves.toBe(
      'she ran no query',
    );
  });

  it('fails when every query failed', async () => {
    const calls = [{ tool: 'run_readonly_sql', error: 'bad column' }];
    await expect(verdict(ranAQuery(), view({ calls }))).resolves.toBe(
      'all 1 of her queries failed',
    );
  });

  it('passes while the run waits for the user', async () => {
    const waitingFor = { question: 'Which?', options: ['a', 'b'] };
    await expect(
      verdict(ranAQuery(), view({ calls: [], waitingFor })),
    ).resolves.toBeUndefined();
  });
});

describe('asksAtMostOnce', () => {
  it('passes with no question and with one', async () => {
    await expect(verdict(asksAtMostOnce(), view())).resolves.toBeUndefined();
    const calls = [{ tool: 'ask_clarification' }];
    await expect(
      verdict(asksAtMostOnce(), view({ calls })),
    ).resolves.toBeUndefined();
  });

  it('fails on two questions', async () => {
    const calls = [
      { tool: 'ask_clarification' },
      { tool: 'ask_clarification' },
    ];
    await expect(verdict(asksAtMostOnce(), view({ calls }))).resolves.toBe(
      'she asked 2 questions',
    );
  });

  it('counts the wait as her question when its call was not stored', async () => {
    const calls = [{ tool: 'ask_clarification' }];
    const waitingFor = { question: 'Which?', options: ['a', 'b'] };
    await expect(
      verdict(asksAtMostOnce(), view({ calls, waitingFor })),
    ).resolves.toBeUndefined();
  });
});

describe('callsOnlyHerTools', () => {
  const check = callsOnlyHerTools(INSIGHTS_LEAD_TOOL_NAMES);

  it('passes on her tools and her skill tools', async () => {
    const calls = [
      { tool: 'run_readonly_sql' },
      { tool: 'skill_read' },
      { tool: 'explore_result' },
    ];
    await expect(verdict(check, view({ calls }))).resolves.toBeUndefined();
  });

  it('fails on a tool that is not hers (a teammate’s)', async () => {
    const calls = [{ tool: 'answer_from_data' }, { tool: 'answer_from_data' }];
    await expect(verdict(check, view({ calls }))).resolves.toBe(
      'she called answer_from_data',
    );
  });
});

describe('runEndsIn', () => {
  it('passes on the wanted status and fails on another with its error', async () => {
    await expect(
      verdict(runEndsIn(['success']), view()),
    ).resolves.toBeUndefined();
    await expect(
      verdict(
        runEndsIn(['success']),
        view({ status: 'failed', error: 'model down' }),
      ),
    ).resolves.toBe('the run ended failed: model down');
    await expect(
      verdict(
        runEndsIn(['success', 'suspended']),
        view({ status: 'suspended' }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('clarificationOffersOptions', () => {
  it('passes without a question and with 2 to 4 options', async () => {
    const check = clarificationOffersOptions();
    await expect(verdict(check, view())).resolves.toBeUndefined();
    await expect(
      verdict(
        check,
        view({ waitingFor: { question: 'q', options: ['a', 'b'] } }),
      ),
    ).resolves.toBeUndefined();
  });

  it('fails on one option', async () => {
    await expect(
      verdict(
        clarificationOffersOptions(),
        view({ waitingFor: { question: 'q', options: ['a'] } }),
      ),
    ).resolves.toBe('her question offers 1 options');
  });
});

describe('repairAtMostOnce', () => {
  it('passes on one attempt and on one repair round', async () => {
    await expect(verdict(repairAtMostOnce(), view())).resolves.toBeUndefined();
    await expect(
      verdict(repairAtMostOnce(), view({ attempts: 2 })),
    ).resolves.toBeUndefined();
  });

  it('fails on a third attempt', async () => {
    await expect(
      verdict(repairAtMostOnce(), view({ attempts: 3 })),
    ).resolves.toBe('the turn made 3 attempts (2 repair rounds)');
  });
});

describe('figureText', () => {
  it('drops code, list markers, separator rows, rank columns and dates', () => {
    const text = figureText(
      '1. First\n- 2 items `LIMIT 99`\n| Rank | Store | Sales |\n|---|---|---|\n| 1 | A | 10 |\n\nOn 31 December 2024, 7 rows.',
    );
    expect(text).not.toMatch(/99|2024|31/);
    expect(text).toContain('10');
    expect(text).toContain('7 rows');
    expect(text).not.toMatch(/\|\s*1\s*\|/);
  });

  it('drops ISO dates and clock times, as her real answers write the data end date', () => {
    // From two real insights-lead eval answers (2026-11-25).
    const text = figureText(
      '- The data ends on 2022-12-18.\n| 2022 final (match 64) | Lusail Stadium | 2022-12-18 15:00 UTC | 88,966 | 88,966 |',
    );
    expect(text).not.toMatch(/\b(12|18|15|00)\b/);
    expect(text).toContain('88,966');
    expect(text).toContain('64');
  });
});

describe('figuresFromQueries', () => {
  it('passes on a real stored answer: every figure is a row, a derived share or a total', async () => {
    await expect(
      verdict(figuresFromQueries(QUESTION), view()),
    ).resolves.toBeUndefined();
  });

  it('fails on a figure no row holds', async () => {
    const answer = `${view().answer}\n\nThe top store had 91,234 customers.`;
    await expect(
      verdict(figuresFromQueries(QUESTION), view({ answer })),
    ).resolves.toMatch(/states 91,234/);
  });

  it('accepts a figure that is in the question', async () => {
    const answer = 'The top 3 scorers are listed.';
    await expect(
      verdict(
        figuresFromQueries('Who were the top 3 scorers?'),
        view({ answer, rows: [] }),
      ),
    ).resolves.toBeUndefined();
  });

  it('passes while the run waits for the user', async () => {
    await expect(
      verdict(
        figuresFromQueries(QUESTION),
        view({
          answer: '',
          waitingFor: { question: 'Which year, 2077?', options: ['a', 'b'] },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

// The answer and tool checks of the data sets ported from the assistant
// (`insights-lead-data.evals.ts`): Mastra's built-in checks read an agent's
// own result, which a whole run has not, so these read the stored run.
describe('answerIncludes', () => {
  it('passes on a word of a real stored answer, in any case', async () => {
    await expect(
      verdict(answerIncludes('web shop americas'), view()),
    ).resolves.toBeUndefined();
  });

  it('fails when the answer lacks it, quoting the word', async () => {
    await expect(verdict(answerIncludes('Argentina'), view())).resolves.toBe(
      'the answer does not include "Argentina"',
    );
  });

  it('reads her question and options while the run waits', async () => {
    const waitingFor = {
      question: 'Which measure?',
      options: ['Most matches won', 'Goals scored'],
    };
    await expect(
      verdict(answerIncludes('goals scored'), view({ answer: '', waitingFor })),
    ).resolves.toBeUndefined();
  });
});

describe('answerMatches', () => {
  it('passes on a figure of a real stored answer', async () => {
    await expect(
      verdict(answerMatches(/88[,.]?065/), view()),
    ).resolves.toBeUndefined();
  });

  it('fails when nothing matches, naming the pattern', async () => {
    await expect(verdict(answerMatches(/4\s*[-–:]\s*2/), view())).resolves.toBe(
      'the answer does not match /4\\s*[-–:]\\s*2/',
    );
  });

  it('has an id per pattern, so a case can hold two', () => {
    expect(answerMatches(/a/).id).not.toBe(answerMatches(/a/i).id);
  });
});

describe('calledTool and didNotCall', () => {
  it('see the queries of a real stored run', async () => {
    await expect(
      verdict(calledTool('run_readonly_sql'), view()),
    ).resolves.toBeUndefined();
    await expect(verdict(didNotCall('run_readonly_sql'), view())).resolves.toBe(
      'she called run_readonly_sql 3 times',
    );
  });

  it('fail and pass the other way round on a run without that tool', async () => {
    await expect(verdict(calledTool('sample_rows'), view())).resolves.toBe(
      'she never called sample_rows',
    );
    await expect(
      verdict(didNotCall('sample_rows'), view()),
    ).resolves.toBeUndefined();
  });
});

describe('noToolErrors', () => {
  it('passes on a real stored run', async () => {
    await expect(verdict(noToolErrors(), view())).resolves.toBeUndefined();
  });

  it('fails on a call that errored, with its error', async () => {
    const calls = [
      { tool: 'run_readonly_sql', error: 'column "x" does not exist' },
      { tool: 'run_readonly_sql', rowCount: 1 },
    ];
    await expect(verdict(noToolErrors(), view({ calls }))).resolves.toBe(
      '1 call failed: run_readonly_sql (column "x" does not exist)',
    );
  });
});

describe('toolOrder', () => {
  const calls = [
    { tool: 'list_entities' },
    { tool: 'describe_entity' },
    { tool: 'run_readonly_sql', rowCount: 1 },
  ];

  it('passes when the tools come in that order, others between them', async () => {
    await expect(
      verdict(
        toolOrder(['list_entities', 'run_readonly_sql']),
        view({ calls }),
      ),
    ).resolves.toBeUndefined();
  });

  it('fails when they come in another order', async () => {
    await expect(
      verdict(
        toolOrder(['run_readonly_sql', 'list_entities']),
        view({ calls }),
      ),
    ).resolves.toBe(
      'her calls (list_entities, describe_entity, run_readonly_sql) do not hold run_readonly_sql then list_entities',
    );
  });
});
