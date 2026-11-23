// The checks of the `avery-michael-workflow` set, each on one run shaped as
// the run store keeps it (api.md 121: the Orchestrate step's tool calls,
// Avery's signed `chief-of-staff`, Michael's unsigned). No model is called.
import type { EvalCustomCheck, EvalCustomCheckInput } from './assistant.evals';
import {
  answerFromDataCalls,
  asksAtMostOnce,
  callsOnlyHerTools,
  clarificationOffersOptions,
  closesIn,
  closingFiguresFromMichael,
  figuresIn,
  playbooksRead,
  readsNoPlaybook,
  readsPlaybook,
  runEndsIn,
  sentencesOf,
} from './avery-workflow-eval-checks';
import { averyRunView, type StoredAveryRun } from './avery-workflow-target';

const QUESTION =
  'How did the number of goals change from the 2018 World Cup to the 2022 World Cup?';

const MICHAEL =
  '**Goals rose from 23 in 2018 to 24 in 2022.**\n\n' +
  '| Tournament | Matches | Goals |\n|---|---|---|\n| 2018 | 8 | 23 |\n| 2022 | 8 | 24 |\n\n' +
  'The data holds the quarter-finals to the final of each tournament.';

const CLOSING =
  'Goals went up by 1, about 4%, over the 8 matches of each tournament. ' +
  'The data covers only the last 8 matches of each World Cup, not the group stage.';

/** A real-shaped stored run of the workflow (period change, one brief). */
function storedRun(overrides: Partial<StoredAveryRun> = {}): StoredAveryRun {
  return {
    id: 'run-1',
    status: 'success',
    steps: [
      {
        id: 'orchestrate',
        status: 'success',
        output: { answer: `${MICHAEL}\n\n${CLOSING}` },
        toolCalls: [
          { tool: 'skill', input: 'avery-playbooks', agent: 'chief-of-staff' },
          {
            tool: 'skill_read',
            input: 'reference/period-change.md',
            agent: 'chief-of-staff',
          },
          {
            tool: 'answer_from_data',
            input:
              'How did the number of goals change from 2018 to 2022? Give both totals, the change and the basis.',
            agent: 'chief-of-staff',
            teammate: 'insights-analyst',
            reply: MICHAEL,
          },
          {
            tool: 'run_readonly_sql',
            input:
              'SELECT t.tournament_year, count(*) AS matches, sum(home_goals + away_goals) AS goals FROM world_cup.matches m JOIN world_cup.tournaments t ON t.id = m.tournament_id GROUP BY 1',
            rowCount: 2,
          },
        ],
      },
    ],
    answer: {
      content: `${MICHAEL}\n\n${CLOSING}`,
      data: [
        {
          tool: 'run_readonly_sql',
          rows: [
            { tournament_year: 2018, matches: '8', goals: '23' },
            { tournament_year: 2022, matches: '8', goals: '24' },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function inputOf(run: StoredAveryRun): EvalCustomCheckInput {
  return {
    answer: '',
    toolCalls: [],
    datasets: ['World Cup'],
    vars: {},
    details: { output: averyRunView(run) },
  };
}

async function verdict(check: EvalCustomCheck, run: StoredAveryRun) {
  return check.run(inputOf(run));
}

/** The run with Avery's calls replaced (Michael's kept). */
function withCalls(
  calls: NonNullable<StoredAveryRun['steps'][number]['toolCalls']>,
): StoredAveryRun {
  const run = storedRun();
  return {
    ...run,
    steps: [{ ...run.steps[0], toolCalls: calls }],
  };
}

describe('Avery + Michael checks on a real-shaped run', () => {
  it('pass the run of a period change answered by one brief', async () => {
    const run = storedRun();
    for (const check of [
      answerFromDataCalls(1, 2),
      asksAtMostOnce(),
      callsOnlyHerTools(),
      runEndsIn(['success']),
      closesIn(1, 2),
      closingFiguresFromMichael(QUESTION),
      readsPlaybook('period-change'),
      clarificationOffersOptions(),
    ]) {
      await expect(verdict(check, run)).resolves.toBeUndefined();
    }
  });

  it('count answer_from_data on her calls only', async () => {
    const brief = storedRun().steps[0].toolCalls![2];
    await expect(
      verdict(answerFromDataCalls(1, 2), withCalls([brief, brief, brief])),
    ).resolves.toBe('she called answer_from_data 3 times');
    await expect(
      verdict(
        answerFromDataCalls(1, 1),
        withCalls([{ ...brief, agent: undefined }]),
      ),
    ).resolves.toBe('she called answer_from_data 0 times');
  });

  it('count a run that waits for the user as her one question', async () => {
    const waiting = storedRun({
      status: 'suspended',
      waitingFor: {
        question: 'What do you mean by best?',
        options: ['The champion', 'The most matches won'],
      },
    });
    await expect(verdict(asksAtMostOnce(), waiting)).resolves.toBeUndefined();
    const twice = withCalls([
      { tool: 'ask_clarification', agent: 'chief-of-staff' },
      { tool: 'ask_clarification', agent: 'chief-of-staff' },
    ]);
    await expect(verdict(asksAtMostOnce(), twice)).resolves.toBe(
      'she asked 2 questions',
    );
  });

  it('refuse a tool of hers that a question on data does not use, and ignore Michael’s', async () => {
    const run = withCalls([
      ...storedRun().steps[0].toolCalls!,
      { tool: 'build_dashboard', agent: 'chief-of-staff' },
    ]);
    await expect(verdict(callsOnlyHerTools(), run)).resolves.toBe(
      'she called build_dashboard',
    );
    // Michael's run_readonly_sql is unsigned: not hers.
    await expect(
      verdict(callsOnlyHerTools(), storedRun()),
    ).resolves.toBeUndefined();
  });

  it('report a failed run with its error', async () => {
    const run = storedRun({ status: 'failed', error: 'Model timed out' });
    await expect(verdict(runEndsIn(['success']), run)).resolves.toBe(
      'the run ended failed: Model timed out',
    );
    await expect(
      verdict(
        runEndsIn(['success', 'suspended']),
        storedRun({
          status: 'suspended',
          waitingFor: { question: 'Which?', options: ['A', 'B'] },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('read the playbook from skill_read’s path, reference/ or references/', async () => {
    const view = averyRunView(
      withCalls([
        {
          tool: 'skill_read',
          input: 'references/ranking.md',
          agent: 'chief-of-staff',
        },
        { tool: 'skill_read', input: 'SKILL.md', agent: 'chief-of-staff' },
      ]),
    );
    expect(playbooksRead(view)).toEqual(['ranking']);
    await expect(
      verdict(readsPlaybook('no-answer'), storedRun()),
    ).resolves.toBe('she read period-change.md');
    await expect(verdict(readsNoPlaybook(), storedRun())).resolves.toBe(
      'she read period-change.md',
    );
    await expect(
      verdict(
        readsNoPlaybook(),
        withCalls([
          { tool: 'skill', input: 'avery-playbooks', agent: 'chief-of-staff' },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it('size her question’s options', async () => {
    const run = (options: string[]) =>
      storedRun({
        status: 'suspended',
        waitingFor: { question: 'Which reading?', options },
      });
    await expect(
      verdict(clarificationOffersOptions(), run(['Champion'])),
    ).resolves.toBe('her question offers 1 options');
    await expect(
      verdict(clarificationOffersOptions(), run(['A', 'B', 'C', 'D'])),
    ).resolves.toBeUndefined();
  });

  it('count the sentences of her closing, not a decimal point', async () => {
    expect(
      sentencesOf('It averaged 2.875 goals. It rose to 3.0 in 2022!'),
    ).toHaveLength(2);
    await expect(verdict(closesIn(1, 1), storedRun())).resolves.toMatch(
      /^her closing is 2 sentences/,
    );
    const silent = storedRun({
      steps: [{ ...storedRun().steps[0], output: { answer: MICHAEL } }],
    });
    await expect(verdict(closesIn(1, 2), silent)).resolves.toMatch(
      /^her closing is 0 sentences/,
    );
  });

  it('accept figures from his answer, his rows and the question, derived or rounded', async () => {
    expect(
      figuresIn('Q1 holds 88,966 fans, 4.3% up').map((f) => f.raw),
    ).toEqual(['88,966', '4.3']);
    await expect(
      verdict(closingFiguresFromMichael(QUESTION), storedRun()),
    ).resolves.toBeUndefined();
  });

  it('refuse a figure no answer, row or question of the run holds', async () => {
    const invented = `${MICHAEL}\n\nGoals went up by 1, driven by 61 penalties.`;
    const run = storedRun({
      steps: [{ ...storedRun().steps[0], output: { answer: invented } }],
    });
    await expect(
      verdict(closingFiguresFromMichael(QUESTION), run),
    ).resolves.toBe(
      'her closing states 61, which no answer, row or question of the run holds',
    );
  });

  it('fail when the case has no stored run to read', () => {
    expect(() =>
      answerFromDataCalls(1, 2).run({
        answer: '',
        toolCalls: [],
        datasets: [],
        vars: {},
        details: {},
      }),
    ).toThrow('the case has no stored run to read (details.output)');
  });
});
