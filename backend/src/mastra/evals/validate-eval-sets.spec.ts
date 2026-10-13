// The entry point boots the whole app; its pure part is what is tested here.
// Neither module may load under Jest (ESM-only Mastra deps, connectors), and
// neither is needed: the Nest boot only runs when the file is executed.
jest.mock('../../app.module', () => ({ AppModule: class {} }));
jest.mock('../../modules/datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));

import { loadEvalSets } from './eval-sets';
import type { EvalSetDefinition } from './eval-sets';
import { RESULT_SET_ROW_LIMIT, runReferenceSql } from './result-set-check';
import { validateEvalSet } from './validate-eval-sets';
import type { ReferenceRunner } from './validate-eval-sets';

const WORLD_CUP = loadEvalSets().find((set) => set.id === 'world-cup')!;
const WITH_REFERENCE = WORLD_CUP.cases.filter((c) => c.expectedSql);

/** Runs the validator, collecting what it prints. */
async function validate(
  run: ReferenceRunner,
  set: EvalSetDefinition = WORLD_CUP,
  preflightError?: string,
) {
  const lines: string[] = [];
  const result = await validateEvalSet(set, preflightError, run, (line) =>
    lines.push(line),
  );
  return { result, lines };
}

describe('eval:validate', () => {
  it('prints a ✓ line per reference query and exits 0 when all run', async () => {
    const run = jest.fn().mockResolvedValue({ rowCount: 1 });
    const { result, lines } = await validate(run);

    expect(WITH_REFERENCE).toHaveLength(5);
    expect(run.mock.calls).toEqual(
      WITH_REFERENCE.map((c) => [c.expectedSql, c.id]),
    );
    expect(lines.slice(0, 5)).toEqual(
      WITH_REFERENCE.map((c) => `✓ ${c.id}  postgres  1 rows`),
    );
    // Cases with no reference query have nothing to validate: no line.
    expect(lines.join('\n')).not.toContain('schema-discovery');
    expect(lines.at(-1)).toBe(
      '\nworld-cup: 5 of 5 reference queries passed; 5 cases have no reference query.',
    );
    expect(result).toEqual({
      ran: 5,
      failed: 0,
      withoutReference: 5,
      exitCode: 0,
    });
  });

  it('fails on a broken reference, naming the case, and still runs the others', async () => {
    const run = jest.fn((sql: string, caseId: string) =>
      caseId === 'champion-2022'
        ? Promise.reject(
            new Error('column champion.common_nme does not exist\n  at …'),
          )
        : Promise.resolve({ rowCount: 2 }),
    );
    const { result, lines } = await validate(run);

    expect(lines[0]).toBe(
      '✗ champion-2022  postgres  column champion.common_nme does not exist at …',
    );
    expect(lines.slice(1, 5)).toEqual(
      WITH_REFERENCE.slice(1).map((c) => `✓ ${c.id}  postgres  2 rows`),
    );
    expect(run).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ ran: 5, failed: 1, exitCode: 1 });
  });

  it('fails a reference truncated at the row limit, the way the result-set check does', async () => {
    const execute = jest.fn().mockResolvedValue({
      rows: Array.from({ length: RESULT_SET_ROW_LIMIT }, (_, i) => ({ i })),
    });
    const { result, lines } = await validate(async (sql) => ({
      rowCount: (await runReferenceSql(sql, execute)).length,
    }));

    expect(execute).toHaveBeenCalledWith(
      WITH_REFERENCE[0].expectedSql,
      RESULT_SET_ROW_LIMIT,
    );
    expect(lines[0]).toBe(
      '✗ champion-2022  postgres  reference result is truncated; completeness cannot be verified',
    );
    expect(result.exitCode).toBe(1);
  });

  it('fails a reference that returns no rows', async () => {
    const { result, lines } = await validate(
      jest.fn().mockResolvedValue({ rowCount: 0 }),
    );
    expect(lines[0]).toBe(
      '✗ champion-2022  postgres  the reference returned 0 rows',
    );
    expect(result).toMatchObject({ failed: 5, exitCode: 1 });
  });

  it('stops at the dataset preflight: prints it, runs nothing, exits 1', async () => {
    const run = jest.fn();
    const { result, lines } = await validate(
      run,
      WORLD_CUP,
      'These evals require the bundled World Cup sample. Missing entities: world_cup.tournaments.',
    );
    expect(run).not.toHaveBeenCalled();
    expect(lines[0]).toContain('Missing entities: world_cup.tournaments');
    expect(result).toMatchObject({ ran: 0, exitCode: 1 });
  });

  it('validates the REST variant against its SQLite references', async () => {
    const rest = loadEvalSets().find((set) => set.id === 'world-cup-rest')!;
    const run = jest.fn<ReturnType<ReferenceRunner>, [string, string]>();
    run.mockResolvedValue({ rowCount: 1 });
    const { lines } = await validate(run, rest);
    expect(lines[0]).toBe('✓ rest-champion-2022  sqlite  1 rows');
    expect(run.mock.calls[0][0]).toContain('FROM api.world_cup.tournaments');
  });
});
