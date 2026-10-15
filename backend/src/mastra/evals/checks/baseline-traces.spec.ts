import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEvalSets } from '../eval-set-files';
import type { EvalCaseDefinition, EvalSetDefinition } from '../eval-set-files';
import {
  DETERMINISTIC_CHECKS,
  isDeterministicCheckType,
  turnFromCaseResult,
} from './index';
import type { CheckVerdict } from './check';

/**
 * The checks on real traces: the six run records of the baseline on main
 * (evidence/1.1.2/baseline, gpt-4o-mini, 2026-10-13), scored offline with
 * the checks the set files attach (agents-evals R125). The records keep tool
 * inputs and outputs clipped at 2,000 characters (R33), which the turn model
 * reads as far as the clip allows.
 */
const BASELINE = join(__dirname, '../../../../../evidence/1.1.2/baseline');

interface RecordedResult {
  id: string;
  question: string;
  answer: string;
  error?: string;
  toolCalls: {
    name: string;
    input?: string;
    output?: string;
    error?: string;
  }[];
}

const records = readdirSync(BASELINE)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({
    file,
    results: (
      JSON.parse(readFileSync(join(BASELINE, file), 'utf8')) as {
        results: RecordedResult[];
      }
    ).results,
  }));

const cases = new Map<
  string,
  { set: EvalSetDefinition; evalCase: EvalCaseDefinition }
>();
for (const set of loadEvalSets()) {
  for (const evalCase of set.cases) cases.set(evalCase.id, { set, evalCase });
}

/** Every attached deterministic check's verdict on one recorded result. */
function score(result: RecordedResult): Record<string, CheckVerdict> {
  const entry = cases.get(result.id);
  if (!entry) throw new Error(`no case ${result.id}`);
  const turn = turnFromCaseResult(result);
  const verdicts: Record<string, CheckVerdict> = {};
  for (const check of entry.evalCase.checks) {
    if (!isDeterministicCheckType(check.type)) continue;
    verdicts[check.type] = DETERMINISTIC_CHECKS[check.type].evaluate(
      turn,
      check.args ?? {},
      {
        dialect: entry.set.dialect,
        ...(entry.evalCase.expectedSql !== undefined
          ? { expectedSql: entry.evalCase.expectedSql }
          : {}),
      },
    );
  }
  return verdicts;
}

function result(file: string, id: string): RecordedResult {
  const found = records
    .find((record) => record.file === file)
    ?.results.find((r) => r.id === id);
  if (!found) throw new Error(`no ${id} in ${file}`);
  return found;
}

describe('the deterministic checks on the baseline traces', () => {
  it('pass the champion-2022 lookup except for its repaired query', () => {
    const verdicts = score(
      result('world-cup-postgres-run1.json', 'champion-2022'),
    );
    expect(verdicts.noRepairs.passed).toBe(false);
    expect(verdicts.noRepairs.reason).toMatch(
      /^the SQL fixer rewrote 1 of 1 queries; the first as written: "SELECT t\.name AS champion_team/,
    );
    for (const type of [
      'rationaleOk',
      'noHtml',
      'dialect',
      'qualifiedNames',
      'namesNotIds',
      'numbersGrounded',
    ]) {
      expect([type, verdicts[type]]).toEqual([type, { passed: true }]);
    }
  });

  it('catch a score answered from general knowledge (G1) and a join that never reached the teams (D2)', () => {
    const verdicts = score(
      result('world-cup-postgres-run1.json', 'final-score-2018'),
    );
    expect(verdicts.numbersGrounded.reason).toBe(
      'the answer states 4, 2, which no tool result of this turn holds or rounds to',
    );
    expect(verdicts.usesEntities.reason).toBe(
      'no single successful SQL reads every entity; the closest misses "teams"',
    );
  });

  it('catch an invented figure on the out-of-scope question, and pass the honest refusal', () => {
    expect(
      score(result('world-cup-postgres-run1.json', 'out-of-scope')),
    ).toMatchObject({
      numbersGrounded: { passed: true },
      notMatches: { passed: true },
    });
    const invented = score(
      result('world-cup-rest-run2.json', 'rest-out-of-scope'),
    );
    expect(invented.numbersGrounded.reason).toBe(
      'the answer states 6, but no tool call of this turn returned data',
    );
    expect(invented.notMatches.reason).toContain(
      'Pelé scored a total of 6 goals in the 1970 World Cup',
    );
    expect(
      score(result('world-cup-rest-run1.json', 'rest-out-of-scope'))
        .numbersGrounded.reason,
    ).toBe(
      'the answer states 1974, 1978, 1982, 1994, which no tool result of this turn holds or rounds to',
    );
  });

  it('catch a rationale that names a column, a bare id, an unread encoding and a failed visual', () => {
    expect(
      score(result('world-cup-postgres-run1.json', 'biggest-venue')).rationaleOk
        .reason,
    ).toContain('the rationale names column-style name "venue_id"');
    expect(
      score(result('world-cup-rest-run3.json', 'rest-champion-2022'))
        .namesNotIds.reason,
    ).toBe('the answer reports a bare identifier ("ID 2") instead of a name');
    expect(
      score(result('world-cup-postgres-run1.json', 'shootouts')).sqlMatches
        .reason,
    ).toMatch(/^no successful SQL matches \/penalt\/i; the last: "SELECT /);
    expect(
      score(result('world-cup-postgres-run1.json', 'visual-request'))
        .visualKeywords.reason,
    ).toBe('create_visual failed: completed assistant answer not found');
  });

  it('score the six records as the BA-183 report states', () => {
    const tally: Record<string, [number, number]> = {};
    let errored = 0;
    for (const record of records) {
      for (const recorded of record.results) {
        // A run that threw has no check results (R29); nothing to score.
        if (recorded.error) {
          errored++;
          continue;
        }
        for (const [type, verdict] of Object.entries(score(recorded))) {
          const [passed, scored] = tally[type] ?? [0, 0];
          tally[type] = [passed + (verdict.passed ? 1 : 0), scored + 1];
        }
      }
    }
    expect(errored).toBe(1);
    expect(tally).toEqual({
      noRepairs: [18, 47],
      rationaleOk: [48, 53],
      noHtml: [59, 59],
      dialect: [47, 47],
      qualifiedNames: [47, 47],
      namesNotIds: [46, 47],
      numbersGrounded: [42, 47],
      usesEntities: [1, 6],
      sqlMatches: [0, 6],
      optionCount: [6, 6],
      notMatches: [4, 6],
      visualKeywords: [0, 5],
    });
  });
});
