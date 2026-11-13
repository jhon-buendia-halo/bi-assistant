import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import type { NodeChatMessage } from '../node-chat-context';
import {
  WorkflowNodeChatsRepository,
  type NodeChatDoc,
} from './workflow-node-chats.repository';

const message = (
  id: string,
  overrides: Partial<NodeChatMessage> = {},
): NodeChatMessage => ({
  id,
  role: 'user',
  content: `Message ${id}`,
  createdAt: '2026-11-12T10:00:00.000Z',
  ...overrides,
});

describe('WorkflowNodeChatsRepository (data-model 3.17)', () => {
  let db: BetterSqlite3.Database;
  let repository: WorkflowNodeChatsRepository;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    repository = new WorkflowNodeChatsRepository(
      new SqliteDocStore<NodeChatDoc>(db, 'workflow_run_node_chats'),
    );
  });

  afterEach(() => db.close());

  it('creates a step chat with its first message and appends the next ones, round-tripping every field', async () => {
    await expect(repository.get('r-1', 'analyse')).resolves.toBeNull();
    await repository.append('r-1', 'analyse', message('m1'));
    const answer = message('m2', {
      role: 'assistant',
      content: 'It is 172.',
      toolCalls: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT 1',
          rowCount: 1,
          durationMs: 5,
        },
      ],
      stopped: true,
      error: 'Model error',
    });
    await repository.append('r-1', 'analyse', answer);
    const chat = await repository.get('r-1', 'analyse');
    expect(chat).toMatchObject({
      runId: 'r-1',
      stepId: 'analyse',
      messages: [message('m1'), answer],
    });
    expect(chat?.id).toEqual(expect.any(String));
    expect(chat?.createdAt).toBeDefined();
    expect(chat?.updatedAt).toBeDefined();
    // One document per run and step.
    await repository.append('r-1', 'other', message('m3'));
    await repository.append('r-2', 'analyse', message('m4'));
    expect((await repository.get('r-1', 'analyse'))?.messages).toHaveLength(2);
    expect((await repository.get('r-1', 'other'))?.messages).toEqual([
      message('m3'),
    ]);
  });

  it('deletes every chat of one run and no other', async () => {
    await repository.append('r-1', 'analyse', message('m1'));
    await repository.append('r-1', 'other', message('m2'));
    await repository.append('r-2', 'analyse', message('m3'));
    await expect(repository.deleteByRun('r-1')).resolves.toBe(2);
    await expect(repository.get('r-1', 'analyse')).resolves.toBeNull();
    await expect(repository.get('r-1', 'other')).resolves.toBeNull();
    expect(await repository.get('r-2', 'analyse')).not.toBeNull();
  });
});
