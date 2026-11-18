/**
 * The run context's read tools (agents.md 3.16). `createTool` is stood in
 * by its config, so the test calls `execute` as Mastra would.
 */
jest.mock('@mastra/core/tools', () => ({
  createTool: (config: unknown) => config,
}));

import { readRunContextTool, listRunContextTool } from './run-context.tools';
import { RUN_CONTEXT_KEY, RunContextBoard } from '../workflows/run-context';

type Execute = (input: unknown, context: unknown) => Promise<unknown>;

function contextWith(board?: RunContextBoard) {
  return {
    requestContext: {
      get: (key: string) => (key === RUN_CONTEXT_KEY ? board : undefined),
    },
  };
}

describe('the run context tools', () => {
  const board = new RunContextBoard();
  board.write('catalog/wc.goals', 'Columns of wc.goals', 'id int');
  const read = (readRunContextTool as unknown as { execute: Execute }).execute;
  const list = (listRunContextTool as unknown as { execute: Execute }).execute;

  it('reads an entry by its key', async () => {
    await expect(
      read({ key: 'catalog/wc.goals' }, contextWith(board)),
    ).resolves.toMatchObject({ found: true, content: 'id int' });
  });

  it('answers an unknown key as a miss, not an error', async () => {
    const result = await read({ key: 'catalog/goals' }, contextWith(board));
    expect(result).toEqual({
      found: false,
      message:
        'No run context entry "catalog/goals". Known keys: catalog/wc.goals',
    });
    expect(result).not.toHaveProperty('error');
  });

  it('answers with an error when the run has no board', async () => {
    await expect(read({ key: 'x' }, contextWith())).resolves.toEqual({
      error: 'This run has no shared context.',
    });
    await expect(list({}, contextWith())).resolves.toEqual({
      error: 'This run has no shared context.',
    });
  });
});
