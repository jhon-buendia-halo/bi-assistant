/**
 * What an eval case sends the agent (plan 1.25.5, 1.23.26b): the input, the
 * context blocks, the step budget and the requestContext entries, recorded
 * against a mocked `runEvals` and held in a snapshot. Elena's first case is
 * a ported data set's (`insights-lead-data.evals.ts`): a whole run of her
 * conversation, which builds its own context, so the runner sends none of
 * its own and no host or visual key (the eval host is gone).
 */
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(() => Promise.resolve({ scores: {} })),
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/insights-lead.agent', () => ({
  insightsLeadAgent: { id: 'insights-lead' },
}));
jest.mock('../agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
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
import { evalSetsFor, evalTargetFor } from './eval-sets';

interface SentConfig {
  data: { input: unknown; requestContext: Map<string, unknown> }[];
  target: { id?: string };
  targetOptions: { maxSteps: number; context: unknown };
}

const recordings: Record<string, unknown> = {};

describe('the requests an eval case sends each agent', () => {
  for (const agentKey of ['insights-lead']) {
    it(`${agentKey}: the first case`, async () => {
      const target = evalTargetFor(agentKey);
      const evalCase = evalSetsFor(agentKey)[0].cases[0];
      (runEvals as jest.Mock).mockClear();
      await runAssistantEvalCase(evalCase, ['World Cup Core'], target);
      const [config] = (runEvals as jest.Mock).mock.calls.at(-1) as [
        SentConfig,
      ];
      const entries = Object.fromEntries([
        ...config.data[0].requestContext.entries(),
      ]);
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
