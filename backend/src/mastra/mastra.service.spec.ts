// The real Mastra instance pulls in ESM-only packages Jest cannot require:
// the test hands MastraService a stand-in with the workflow it runs.
const getWorkflow = jest.fn();
jest.mock('./index', () => ({ mastra: { getWorkflow } }));
jest.mock('./session-workspaces', () => ({}));

import { MastraService } from './mastra.service';

/** A registered workflow whose run's `start()` answers `result`. */
function registered(result: unknown) {
  const start = jest.fn().mockResolvedValue(result);
  getWorkflow.mockReturnValue({
    stepGraph: [
      { type: 'step', step: { id: 'clean-text', description: 'Clean text' } },
      { type: 'step', step: { id: 'count-words', description: 'Count words' } },
      {
        type: 'step',
        step: { id: 'format-result', description: 'Format result' },
      },
    ],
    createRun: jest.fn().mockResolvedValue({ start }),
  });
  return start;
}

describe('MastraService.runWorkflow (api.md 118)', () => {
  beforeEach(() => getWorkflow.mockReset());

  it('starts one run on the input and maps every step, in order, with the final output', async () => {
    const start = registered({
      status: 'success',
      steps: {
        input: { text: ' a b ' },
        'clean-text': { status: 'success', output: { text: 'a b' } },
        'count-words': {
          status: 'success',
          output: { text: 'a b', words: 2, characters: 3 },
        },
        'format-result': {
          status: 'success',
          output: { summary: '2 words, 3 characters: "a b"' },
        },
      },
      result: { summary: '2 words, 3 characters: "a b"' },
    });
    const result = await new MastraService().runWorkflow('seq-text-demo', {
      text: ' a b ',
    });
    expect(getWorkflow).toHaveBeenCalledWith('seq-text-demo');
    expect(start).toHaveBeenCalledWith({ inputData: { text: ' a b ' } });
    expect(result).toEqual({
      workflowId: 'seq-text-demo',
      status: 'success',
      steps: [
        {
          id: 'clean-text',
          title: 'Clean text',
          status: 'success',
          output: { text: 'a b' },
        },
        {
          id: 'count-words',
          title: 'Count words',
          status: 'success',
          output: { text: 'a b', words: 2, characters: 3 },
        },
        {
          id: 'format-result',
          title: 'Format result',
          status: 'success',
          output: { summary: '2 words, 3 characters: "a b"' },
        },
      ],
      output: { summary: '2 words, 3 characters: "a b"' },
    });
  });

  it('a failing step fails the run with its error, and the later steps are skipped', async () => {
    registered({
      status: 'failed',
      steps: {
        input: { text: '   ' },
        'clean-text': {
          status: 'failed',
          error: { message: 'The text is empty', name: 'Error' },
        },
      },
      error: { message: 'The text is empty', name: 'Error' },
    });
    const result = await new MastraService().runWorkflow('seq-text-demo', {
      text: '   ',
    });
    expect(result).toEqual({
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
        { id: 'format-result', title: 'Format result', status: 'skipped' },
      ],
      error: 'The text is empty',
    });
  });

  it('reads an Error instance, and fails a run that ended any other way', async () => {
    registered({
      status: 'failed',
      steps: {
        'clean-text': { status: 'success', output: { text: 'a' } },
        'count-words': { status: 'failed', error: new Error('boom') },
      },
      error: new Error('boom'),
    });
    const failed = await new MastraService().runWorkflow('seq-text-demo', {});
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('boom');
    expect(failed.steps.map((step) => step.status)).toEqual([
      'success',
      'failed',
      'skipped',
    ]);

    registered({ status: 'suspended', steps: {} });
    const suspended = await new MastraService().runWorkflow(
      'seq-text-demo',
      {},
    );
    expect(suspended).toMatchObject({
      status: 'failed',
      error: 'The run ended as suspended',
    });
    expect(suspended.steps.every((step) => step.status === 'skipped')).toBe(
      true,
    );
  });
});
