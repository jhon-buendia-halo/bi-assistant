import type { DatasetSnapshot } from '../tool-services';
import {
  SCHEMA_NOTES_EVAL_NOTES,
  usesConsumptionSchema,
  withLandingCopy,
} from './schema-notes-eval-checks';

const call = (sql: string, failed = false) => ({
  name: 'run_readonly_sql',
  input: { sql },
  output: {},
  failed,
});
const input = (...toolCalls: ReturnType<typeof call>[]) => ({
  answer: '24 goals',
  toolCalls,
  datasets: ['World Cup Core'],
  vars: {},
});

describe('usesConsumptionSchema', () => {
  it('passes a query on the Consumption schema', async () => {
    const result = await usesConsumptionSchema.run(
      input(call('SELECT SUM(home_goals) FROM world_cup.world_cup.matches')),
    );
    expect(result).toBeUndefined();
  });

  it('fails a query on the Landing schema, even after a good one', async () => {
    const result = await usesConsumptionSchema.run(
      input(
        call('SELECT 1 FROM world_cup.world_cup.matches'),
        call('SELECT 1 FROM world_cup.world_cup_raw.matches', true),
      ),
    );
    expect(result).toContain('Landing schema');
  });

  it('fails when no SQL ran or every call failed', async () => {
    expect(await usesConsumptionSchema.run(input())).toContain('no');
    expect(
      await usesConsumptionSchema.run(input(call('SELECT 1', true))),
    ).toContain('failed');
  });
});

describe('withLandingCopy', () => {
  it('adds the Landing copy of each world_cup table and the two notes', () => {
    const snapshot: DatasetSnapshot = {
      name: 'World Cup Core',
      tables: ['world_cup.world_cup.matches', 'other.public.x'],
    };
    const [out] = withLandingCopy([snapshot]);
    expect(out.tables).toEqual([
      'world_cup.world_cup.matches',
      'other.public.x',
      'world_cup.world_cup_raw.matches',
    ]);
    expect(out.schemas).toBe(SCHEMA_NOTES_EVAL_NOTES);
    expect(snapshot.schemas).toBeUndefined();
  });
});
