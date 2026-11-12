import type { WorkflowRunResult } from '../../mastra/workflows/workflow-run';
import {
  RUN_INTERRUPTED_ERROR,
  interruptedRunPatch,
  runHostDoc,
  runOfResult,
  runSummaryOf,
  runTitle,
  type WorkflowRunDoc,
} from './workflow-run-steps';

const base: WorkflowRunDoc = {
  id: 'r-1',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: { question: 'Who won?', datasets: ['World Cup Core'] },
  status: 'running',
  steps: [],
  datasets: [],
  startedAt: '2026-11-11T10:00:00.000Z',
};

describe('runTitle (plan 5.3)', () => {
  it('is the question, trimmed, at most 120 characters', () => {
    expect(runTitle({ ...base, question: '  Who won?  ' }, [])).toBe(
      'Who won?',
    );
    const long = 'x'.repeat(130);
    expect(runTitle({ ...base, question: long }, [])).toBe('x'.repeat(120));
  });

  it('else the first text or textarea input with a value', () => {
    expect(
      runTitle(
        {
          workflowName: 'Sequential test workflow',
          input: { other: 'skip me', text: '  Hello   world ' },
        },
        ['missing', 'text'],
      ),
    ).toBe('Hello   world');
  });

  it('else the workflow name', () => {
    expect(runTitle({ ...base, input: { text: '   ' } }, ['text'])).toBe(
      'Assistant',
    );
  });
});

describe('runSummaryOf (api.md 120)', () => {
  it('carries the id, workflow, status, title and times only', () => {
    expect(
      runSummaryOf(
        {
          ...base,
          status: 'success',
          question: 'Who won?',
          finishedAt: '2026-11-11T10:01:00.000Z',
          answer: { role: 'assistant', content: 'Brazil.', at: 't' },
        },
        [],
      ),
    ).toEqual({
      id: 'r-1',
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      status: 'success',
      title: 'Who won?',
      startedAt: '2026-11-11T10:00:00.000Z',
      finishedAt: '2026-11-11T10:01:00.000Z',
    });
  });
});

describe('runHostDoc (plan 5.2: a run-backed host)', () => {
  it('shapes a stored agent run as its host: id, workspace, binding, question and answer, panel and visuals', () => {
    const answer = {
      role: 'assistant' as const,
      content: 'Brazil.',
      at: '2026-11-11T10:00:30.000Z',
    };
    const host = runHostDoc({
      ...base,
      workflowId: 'agent:rfp',
      workflowName: 'RFP Builder',
      status: 'success',
      question: 'Who won?',
      answer,
      datasets: ['World Cup Core'],
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      rfpId: 'rfp-1',
      panelItems: [
        {
          id: 'p1',
          kind: 'document',
          title: 'Notes',
          markdown: '# Notes',
          shownAt: 't',
        },
      ],
      visualizations: [
        {
          id: 'v1',
          title: 'Goals',
          description: '',
          path: 'visuals/v1',
          createdAt: 't',
          updatedAt: 't',
        } as never,
      ],
      workflowState: { phases: [], updatedAt: 't' } as never,
    });
    expect(host).toEqual({
      id: 'run-r-1',
      name: 'RFP Builder',
      workspaceId: 'session-run-r-1',
      run: true,
      datasets: ['World Cup Core'],
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      workflowId: 'agent:rfp',
      rfpId: 'rfp-1',
      messages: [
        { role: 'user', content: 'Who won?', at: '2026-11-11T10:00:00.000Z' },
        answer,
      ],
      panelItems: [
        {
          id: 'p1',
          kind: 'document',
          title: 'Notes',
          markdown: '# Notes',
          shownAt: 't',
        },
      ],
      visualizations: [expect.objectContaining({ id: 'v1' })],
      workflowState: { phases: [], updatedAt: 't' },
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });
  });

  it('a run without an answer or panel has an empty transcript beyond its question', () => {
    const host = runHostDoc({ ...base, question: 'Who won?' });
    expect(host.messages).toEqual([
      { role: 'user', content: 'Who won?', at: base.startedAt },
    ]);
    expect(host.visualizations).toEqual([]);
    expect(host.panelItems).toBeUndefined();
  });
});

describe('runOfResult (api.md 118 stores a code-only run)', () => {
  it('projects a WorkflowRunResult into the stored run', () => {
    const result: WorkflowRunResult = {
      workflowId: 'seq-text-demo',
      status: 'failed',
      steps: [
        {
          id: 'clean-text',
          title: 'Clean text',
          status: 'failed',
          error: 'The text is empty',
        },
        { id: 'count-words', title: 'Count words', status: 'skipped' },
      ],
      error: 'The text is empty',
    };
    expect(runOfResult(result, '2026-11-11T10:00:01.000Z')).toEqual({
      status: 'failed',
      steps: result.steps,
      error: 'The text is empty',
      finishedAt: '2026-11-11T10:00:01.000Z',
    });
  });

  it('caps a step output larger than 20 000 JSON characters', () => {
    const big = { text: 'x'.repeat(20_001) };
    const patch = runOfResult(
      {
        workflowId: 'seq-text-demo',
        status: 'success',
        steps: [{ id: 'a', title: 'A', status: 'success', output: big }],
        output: { summary: 'ok' },
      },
      't',
    );
    expect(patch.steps).toEqual([
      { id: 'a', title: 'A', status: 'success', outputTruncated: true },
    ]);
    expect(patch.output).toEqual({ summary: 'ok' });
  });
});

describe('interruptedRunPatch (plan 5.1 step 5)', () => {
  it('fails a run the app stopped in, and any step still running', () => {
    expect(
      interruptedRunPatch(
        {
          ...base,
          steps: [
            { id: 'a', title: 'A', status: 'success' },
            { id: 'b', title: 'B', status: 'running' },
          ],
        },
        '2026-11-11T11:00:00.000Z',
      ),
    ).toEqual({
      status: 'failed',
      error: RUN_INTERRUPTED_ERROR,
      steps: [
        { id: 'a', title: 'A', status: 'success' },
        { id: 'b', title: 'B', status: 'failed', error: RUN_INTERRUPTED_ERROR },
      ],
      finishedAt: '2026-11-11T11:00:00.000Z',
    });
    expect(RUN_INTERRUPTED_ERROR).toBe(
      'The app stopped before the run finished',
    );
  });
});
