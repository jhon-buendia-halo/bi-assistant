/**
 * What an eval case sends the agent, one case per agent kind that has evals
 * (plan 1.25.5, 1.23.26b): the input, the context blocks, the step budget and
 * the requestContext entries, recorded against a mocked `runEvals` and held
 * in a snapshot. Moving evals from a throwaway chat session onto a run host
 * changed none of it; the host id is the only entry left out, as it names
 * the throwaway host and is never read by the model. Questions to Insights v2
 * has no eval set, so its requests are covered by the run e2e instead.
 */
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(() => Promise.resolve({ scores: {} })),
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({
  assistantAgent: { id: 'assistant' },
}));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: () => Promise.resolve([]),
  }),
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { runEvals } from '@mastra/core/evals';
import { writeFileSync } from 'node:fs';
import { runAssistantEvalCase } from './assistant.evals';
import { dataReadinessEvalTarget } from './data-readiness.evals';
import { evalSetsFor, evalTargetFor } from './eval-sets';

interface SentConfig {
  data: { input: unknown; requestContext: Map<string, unknown> }[];
  target: { id?: string };
  targetOptions: { maxSteps: number; context: unknown };
}

const recordings: Record<string, unknown> = {};

describe('the requests an eval case sends each agent', () => {
  for (const agentKey of ['assistant', 'data-readiness']) {
    it(`${agentKey}: the first case`, async () => {
      // The Data Readiness block says "Today is <date>": pin the clock so the
      // snapshot does not change with the day the suite runs.
      const target =
        agentKey === 'data-readiness'
          ? dataReadinessEvalTarget(() => new Date('2026-11-12T12:00:00Z'))
          : evalTargetFor(agentKey);
      const evalCase = evalSetsFor(agentKey)[0].cases[0];
      (runEvals as jest.Mock).mockClear();
      await runAssistantEvalCase(
        evalCase,
        ['World Cup Core'],
        'host-1',
        undefined,
        target,
      );
      const [config] = (runEvals as jest.Mock).mock.calls.at(-1) as [
        SentConfig,
      ];
      const entries = Object.fromEntries(
        [...config.data[0].requestContext.entries()].filter(
          ([key]) => key !== 'session-id',
        ),
      );
      const sent = {
        agent: config.target.id,
        input: config.data[0].input,
        requestContextKeys: Object.keys(entries).sort(),
        datasets: entries['datasets'],
        maxSteps: config.targetOptions.maxSteps,
        context: config.targetOptions.context,
      };
      recordings[agentKey] = sent;
      expect(sent).toMatchSnapshot();
    });
  }

  afterAll(() => {
    const file = process.env['EVAL_REQUESTS_FILE'];
    if (file) writeFileSync(file, JSON.stringify(recordings, null, 2));
  });
});
