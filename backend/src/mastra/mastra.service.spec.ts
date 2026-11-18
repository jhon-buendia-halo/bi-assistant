// The real Mastra instance and the model-backed helpers pull in ESM-only
// packages Jest cannot require: a fake Mastra stands in for them.
const fakeMastra = {
  listWorkflows: jest.fn(),
  getWorkflow: jest.fn(),
  getStorage: jest.fn(),
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

type Row = { runId: string; workflowName: string; status: string };

/**
 * A fake workflows store holding snapshot rows. It pages like the real one
 * (`perPage` and `page` both given) and honours the `status` filter; with
 * `failDelete` a delete of that run id and workflow name rejects.
 */
function fakeStore(rows: Row[], failDelete?: { runId: string }) {
  type ListArgs = { status?: string; perPage?: number; page?: number };
  const store: {
    rows: Row[];
    listWorkflowRuns: jest.Mock<Promise<{ runs: Row[] }>, [ListArgs]>;
    deleteWorkflowRunById: jest.Mock<
      Promise<void>,
      [{ runId: string; workflowName: string }]
    >;
  } = {
    rows: [...rows],
    listWorkflowRuns: jest.fn((args: ListArgs) => {
      const matching = store.rows.filter(
        (row) => !args.status || row.status === args.status,
      );
      const perPage = args.perPage ?? matching.length;
      const start = (args.page ?? 0) * perPage;
      return Promise.resolve({
        runs: matching.slice(start, start + perPage),
      });
    }),
    deleteWorkflowRunById: jest.fn(
      (args: { runId: string; workflowName: string }) => {
        if (failDelete && args.runId === failDelete.runId) {
          return Promise.reject(new Error('locked'));
        }
        store.rows = store.rows.filter(
          (row) =>
            !(
              row.runId === args.runId && row.workflowName === args.workflowName
            ),
        );
        return Promise.resolve();
      },
    ),
  };
  return store;
}

const row = (runId: string, workflowName: string, status = 'suspended') => ({
  runId,
  workflowName,
  status,
});

/** Make the fake Mastra's storage hand out `store` as its workflows store. */
function useStore(store: unknown) {
  fakeMastra.getStorage.mockReturnValue({
    getStore: jest.fn(() => Promise.resolve(store)),
  });
}

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

  it('with no key deletes every suspended row of the store, nested workflows too, and no other', async () => {
    const store = fakeStore([
      row('r1', 'answer-business-question'),
      row('r1', 'question-path'),
      row('r1', 'plan-round'),
      row('r2', 'review-website'),
      row('r3', 'answer-business-question', 'success'),
    ]);
    useStore(store);
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(),
    ).resolves.toBe(4);
    expect(store.rows).toEqual([
      row('r3', 'answer-business-question', 'success'),
    ]);
    expect(store.listWorkflowRuns.mock.calls[0][0]).toMatchObject({
      status: 'suspended',
    });
    expect(store.listWorkflowRuns.mock.calls[0][0]).not.toHaveProperty(
      'workflowName',
    );
    expect(fakeMastra.listWorkflows).not.toHaveBeenCalled();
  });

  it('follows the paging until nothing is left', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(`r${i}`, 'nested'));
    const store = fakeStore(rows);
    useStore(store);
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(),
    ).resolves.toBe(250);
    expect(store.rows).toEqual([]);
  });

  it('a row that fails to delete is logged and the others still go, without looping', async () => {
    const store = fakeStore(
      Array.from({ length: 120 }, (_, i) => row(`r${i}`, 'nested')),
      { runId: 'r5' },
    );
    useStore(store);
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(),
    ).resolves.toBe(119);
    expect(store.rows).toEqual([row('r5', 'nested')]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(store.listWorkflowRuns).toHaveBeenCalledTimes(2);
  });

  it('a list that fails is logged and answers what was deleted so far', async () => {
    const store = fakeStore(
      Array.from({ length: 150 }, (_, i) => row(`r${i}`, 'nested')),
    );
    const list = store.listWorkflowRuns.getMockImplementation()!;
    store.listWorkflowRuns.mockImplementation((args) =>
      args.page === 1 ? Promise.reject(new Error('closed')) : list(args),
    );
    useStore(store);
    await expect(
      new MastraService().discardSuspendedWorkflowRuns(),
    ).resolves.toBe(100);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a storage with no workflows store, or a stand-in, deletes nothing and logs once', async () => {
    for (const storage of [
      undefined,
      { getStore: jest.fn(() => Promise.resolve(undefined)) },
      { getStore: jest.fn(() => Promise.resolve({})) },
    ]) {
      warn.mockClear();
      fakeMastra.getStorage.mockReturnValue(storage);
      await expect(
        new MastraService().discardSuspendedWorkflowRuns(),
      ).resolves.toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it("a run's discard deletes its top and nested rows only, leaving another run's", async () => {
    const store = fakeStore([
      row('r1', 'answer-business-question'),
      row('r1', 'question-path'),
      row('r1', 'analysis-path', 'success'),
      row('r2', 'answer-business-question'),
      row('r2', 'question-path'),
    ]);
    useStore(store);
    // The workflow's own delete drops the top row and the in-memory Run.
    const workflow = {
      createRun: () =>
        Promise.resolve({
          runId: 'r1',
          stream: () => ({ fullStream: [], result: Promise.resolve({}) }),
        }),
      deleteWorkflowRunById: jest.fn((runId: string) => {
        store.rows = store.rows.filter(
          (r) =>
            !(
              r.runId === runId && r.workflowName === 'answer-business-question'
            ),
        );
        return Promise.resolve();
      }),
    };
    fakeMastra.getWorkflow.mockReturnValue(workflow);
    const stream = await new MastraService().streamWorkflow(
      'answer-business-question',
      {},
    );
    await stream.discard?.();
    expect(workflow.deleteWorkflowRunById).toHaveBeenCalledWith('r1');
    expect(store.rows).toEqual([
      row('r2', 'answer-business-question'),
      row('r2', 'question-path'),
    ]);
    expect(store.deleteWorkflowRunById).toHaveBeenCalledTimes(2);
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
