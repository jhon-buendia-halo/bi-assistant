import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import type { WorkflowRunDoc } from '../workflow-run-steps';
import { WorkflowRunsRepository } from './workflow-runs.repository';

const run = (overrides: Partial<WorkflowRunDoc> = {}): WorkflowRunDoc => ({
  id: 'r-1',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: { question: 'Who won?', datasets: ['World Cup Core'] },
  status: 'running',
  steps: [],
  datasets: [],
  startedAt: '2026-11-11T10:00:00.000Z',
  ...overrides,
});

/** Real `SqliteDocStore` over an in-memory database (data-model 3.16). */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<WorkflowRunDoc>(db, 'workflow_runs');
  return { repository: new WorkflowRunsRepository(store), db };
}

describe('WorkflowRunsRepository (data-model 3.16)', () => {
  let db: BetterSqlite3.Database;
  let repository: WorkflowRunsRepository;

  beforeEach(() => {
    ({ repository, db } = build());
  });

  afterEach(() => db.close());

  it('inserts a run stamped with the legacy owner and reads it back by id', async () => {
    await repository.insert(run());
    const found = await repository.get('r-1');
    expect(found).toMatchObject({ ...run(), ownerId: 'local' });
    expect(found?.createdAt).toBeDefined();
    expect(found?.updatedAt).toBeDefined();
  });

  it('answers null for an unknown id', async () => {
    await expect(repository.get('missing')).resolves.toBeNull();
  });

  it('lists every run newest startedAt first, or one workflow’s', async () => {
    await repository.insert(
      run({ id: 'old', startedAt: '2026-11-10T10:00:00.000Z' }),
    );
    await repository.insert(
      run({
        id: 'new',
        workflowId: 'seq-text-demo',
        startedAt: '2026-11-11T12:00:00.000Z',
      }),
    );
    await repository.insert(
      run({ id: 'mid', startedAt: '2026-11-11T09:00:00.000Z' }),
    );
    expect((await repository.list()).map((doc) => doc.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
    expect(
      (await repository.list('agent:assistant')).map((doc) => doc.id),
    ).toEqual(['mid', 'old']);
  });

  it('updates a run when it ends, keeping what it does not patch', async () => {
    await repository.insert(run());
    const updated = await repository.update('r-1', {
      status: 'success',
      steps: [{ id: 'answer', title: 'Answer', status: 'success' }],
      finishedAt: '2026-11-11T10:01:00.000Z',
    });
    expect(updated).toMatchObject({
      id: 'r-1',
      input: run().input,
      status: 'success',
      steps: [{ id: 'answer', title: 'Answer', status: 'success' }],
      finishedAt: '2026-11-11T10:01:00.000Z',
    });
    await expect(
      repository.update('missing', { status: 'failed' }),
    ).resolves.toBeNull();
  });

  it('lists the runs still running (the start-up recovery)', async () => {
    await repository.insert(run({ id: 'a' }));
    await repository.insert(run({ id: 'b', status: 'success' }));
    expect((await repository.listRunning()).map((doc) => doc.id)).toEqual([
      'a',
    ]);
  });

  it('deletes a run and answers how many it removed', async () => {
    await repository.insert(run());
    await expect(repository.delete('r-1')).resolves.toBe(1);
    await expect(repository.get('r-1')).resolves.toBeNull();
    await expect(repository.delete('r-1')).resolves.toBe(0);
  });
});
