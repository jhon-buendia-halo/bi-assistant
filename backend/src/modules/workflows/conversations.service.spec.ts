import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { ConversationsService } from './conversations.service';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import type { WorkflowRunDoc } from './workflow-run-steps';

const run = (overrides: Partial<WorkflowRunDoc>): WorkflowRunDoc => ({
  id: 'r1',
  workflowId: 'agent:insights-lead',
  workflowName: 'Elena',
  input: {},
  status: 'success',
  steps: [],
  datasets: [],
  startedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

describe('ConversationsService (api.md 168)', () => {
  let db: BetterSqlite3.Database;
  let repository: WorkflowRunsRepository;
  let service: ConversationsService;

  beforeEach(async () => {
    db = new BetterSqlite3(':memory:');
    repository = new WorkflowRunsRepository(
      new SqliteDocStore<WorkflowRunDoc>(db, 'workflow_runs'),
    );
    service = new ConversationsService(repository);
    await repository.insert(run({ id: 'live', conversationId: 'live' }));
    await repository.insert(
      run({
        id: 'old',
        conversationId: 'old',
        archivedAt: '2026-11-02T00:00:00.000Z',
      }),
    );
    await repository.insert(
      run({ id: 'other', conversationId: 'other', workflowId: 'x' }),
    );
  });

  afterEach(() => db.close());

  it('lists only the not archived conversations of the binding by default', async () => {
    const rows = await service.list('agent:insights-lead', false);
    expect(rows.map((r) => r.id)).toEqual(['live']);
  });

  it('lists only the archived ones when asked', async () => {
    const rows = await service.list('agent:insights-lead', true);
    expect(rows.map((r) => r.id)).toEqual(['old']);
  });

  it('answers 404 for a workflow that is not conversational', async () => {
    await expect(service.list('x', false)).rejects.toThrow(
      'Workflow "x" has no conversations',
    );
  });
});
