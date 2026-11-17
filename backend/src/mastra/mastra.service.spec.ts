// The real Mastra instance and the model-backed helpers pull in ESM-only
// packages Jest cannot require: a fake Mastra stands in for them.
const fakeMastra = {
  listWorkflows: jest.fn(),
  getWorkflow: jest.fn(),
};
jest.mock('./index', () => ({ mastra: fakeMastra }));
jest.mock('./agents/query-explainer.agent', () => ({}));
jest.mock('./agents/result-explorer.agent', () => ({}));
jest.mock('./workflows/answer-business-question.agents', () => ({}));
jest.mock('./workflows/recreate-dashboard.agents', () => ({}));
jest.mock('./workflows/read-images.agents', () => ({}));
jest.mock('./workflows/consumption-gap-analysis.agents', () => ({}));
jest.mock('./workflows/review-website.agents', () => ({}));
jest.mock('./session-workspaces', () => ({}));
jest.mock('./agent-threads', () => ({}));

import { Logger } from '@nestjs/common';
import { MastraService } from './mastra.service';

/** A registered workflow holding `suspended` snapshots, as Mastra lists them. */
function fakeWorkflow(suspended: string[], failure?: Error) {
  return {
    listWorkflowRuns: jest.fn(() =>
      failure
        ? Promise.reject(failure)
        : Promise.resolve({
            runs: suspended.map((runId) => ({ runId })),
            total: suspended.length,
          }),
    ),
    deleteWorkflowRunById: jest.fn(() => Promise.resolve()),
  };
}

describe('MastraService.discardSuspendedWorkflowRuns (ADR-0043; workflows R20)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  it('with no key walks every registered workflow and deletes its suspended snapshots', async () => {
    const abq = fakeWorkflow(['r1', 'r2']);
    const review = fakeWorkflow(['r3']);
    const gap = fakeWorkflow([]);
    fakeMastra.listWorkflows.mockReturnValue({
      'answer-business-question': abq,
      'review-website': review,
      'consumption-gap-analysis': gap,
    });
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(),
    ).resolves.toBe(3);
    for (const workflow of [abq, review, gap]) {
      expect(workflow.listWorkflowRuns).toHaveBeenCalledWith({
        status: 'suspended',
      });
    }
    expect(abq.deleteWorkflowRunById.mock.calls).toEqual([['r1'], ['r2']]);
    expect(review.deleteWorkflowRunById.mock.calls).toEqual([['r3']]);
    expect(gap.deleteWorkflowRunById).not.toHaveBeenCalled();
  });

  it('one workflow failing to list or delete is logged, and the others are still cleaned', async () => {
    const broken = fakeWorkflow([], new Error('storage closed'));
    const stuck = fakeWorkflow(['s1', 's2']);
    stuck.deleteWorkflowRunById.mockImplementationOnce(() =>
      Promise.reject(new Error('locked')),
    );
    const fine = fakeWorkflow(['f1']);
    fakeMastra.listWorkflows.mockReturnValue({ broken, stuck, fine });
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(),
    ).resolves.toBe(2);
    expect(stuck.deleteWorkflowRunById.mock.calls).toEqual([['s1'], ['s2']]);
    expect(fine.deleteWorkflowRunById).toHaveBeenCalledWith('f1');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('with a key cleans that workflow only', async () => {
    const abq = fakeWorkflow(['r1']);
    fakeMastra.getWorkflow.mockReturnValue(abq);
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(
        'answer-business-question',
      ),
    ).resolves.toBe(1);
    expect(fakeMastra.getWorkflow).toHaveBeenCalledWith(
      'answer-business-question',
    );
    expect(fakeMastra.listWorkflows).not.toHaveBeenCalled();
    expect(abq.deleteWorkflowRunById).toHaveBeenCalledWith('r1');
  });
});
