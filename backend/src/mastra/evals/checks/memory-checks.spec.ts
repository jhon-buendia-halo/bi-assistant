import type { LearningStoreItem } from '../../../modules/memory/learning-store.port';
import { signalText } from '../../../modules/memory/signal-text';
import type { EvalRawToolCall } from '../assistant.evals';
import { loadEvalSets } from '../eval-set-files';
import type { EvalMemoryRecord, TeachSignal } from '../memory-case';
import {
  MEMORY_CHECKS,
  noRowValuesRetained,
  normalizedSql,
  notRejectedSql,
  redactedLiterals,
  rowValues,
  teachNotRecalled,
} from './memory-checks';

/** A teach signal, an approval unless the fields say otherwise. */
function signal(fields: Partial<TeachSignal> = {}): TeachSignal {
  return {
    kind: 'verified_query',
    at: '2026-11-02T15:00:00Z',
    question: 'How many goals did the 2022 champion score?',
    sql: "SELECT COUNT(*) FROM world_cup.goals g JOIN world_cup.teams t ON t.id = g.team_id WHERE t.common_name = 'Argentina'",
    ...fields,
  };
}

/** What the "Mastra only" store holds for a signal: the message and its index copy. */
function heldFor(teach: TeachSignal[], scope = 'eval-run-case-1') {
  return teach.flatMap((taught, index): LearningStoreItem[] => {
    const text = signalText({
      kind: taught.kind,
      occurredAt: taught.at,
      question: taught.question,
      sql: taught.sql,
      note: taught.note,
    });
    const documentId = `${scope}:teach-${index + 1}`;
    return [
      { kind: 'signal', documentId, text },
      { kind: 'index', documentId, text },
    ];
  });
}

function sqlCall(
  sql: string,
  output: unknown = { rows: [] },
  failed = false,
): EvalRawToolCall {
  return {
    name: 'run_readonly_sql',
    input: { sql, rationale: 'Why.' },
    output,
    failed,
  };
}

describe('the memory checks (agents-evals R241 to R243)', () => {
  it('have their ids, names and default criteria M1, M2, M3', () => {
    expect(
      Object.entries(MEMORY_CHECKS).map(([type, check]) => [
        type,
        check.id,
        check.criterion,
      ]),
    ).toEqual([
      ['noRowValuesRetained', 'check-no-row-values-retained', 'M1'],
      ['notRejectedSql', 'check-not-rejected-sql', 'M2'],
      ['teachNotRecalled', 'check-teach-not-recalled', 'M3'],
    ]);
    for (const check of Object.values(MEMORY_CHECKS)) {
      expect(check.description).toMatch(/^Checks that /);
    }
  });
});

describe('noRowValuesRetained (R241, M1)', () => {
  // The Gherkin: a teach signal filtering on 'Lionel Messi', a name its
  // question does not hold.
  const messi = signal({
    question: 'How many goals did the 2022 top scorer score?',
    sql: "SELECT COUNT(*) FROM world_cup.goals g JOIN world_cup.players p ON p.id = g.scorer_player_id WHERE p.full_name = 'Lionel Messi' AND g.goal_type <> 'own_goal'",
  });

  it('passes when every item the memory holds reads ? in its place', () => {
    const held = heldFor([messi]);
    expect(held[0].text).toContain("p.full_name = '?'");
    expect(noRowValuesRetained([messi], held, [])).toEqual({
      id: 'check-no-row-values-retained',
      description: 'Checks that nothing the memory holds keeps a row value',
      score: 1,
      passed: true,
    });
  });

  it('fails, naming the item and quoting the value, when an item holds the name', () => {
    const held: LearningStoreItem[] = [
      ...heldFor([messi]),
      {
        kind: 'index',
        documentId: 'eval-run-case-1:teach-1',
        text: "Approved SQL: … WHERE p.full_name = 'Lionel Messi'",
      },
    ];
    expect(noRowValuesRetained([messi], held, [])).toMatchObject({
      passed: false,
      score: 0,
      reason:
        'the memory holds the row value "Lionel Messi" in its index item eval-run-case-1:teach-1',
    });
  });

  it('passes on an empty scope, as under none, whatever the rows', () => {
    expect(
      noRowValuesRetained([messi], [], [{ name: 'Lionel Messi' }]).passed,
    ).toBe(true);
    expect(noRowValuesRetained(undefined, [], undefined).passed).toBe(true);
  });

  it('counts a text cell of the reference that is in no teach question or note', () => {
    const held: LearningStoreItem[] = [
      { kind: 'summary', text: 'The analyst cares about Lusail Stadium.' },
    ];
    expect(
      noRowValuesRetained([signal()], held, [
        { venue: 'Lusail Stadium', goals: '13' },
      ]).reason,
    ).toBe(
      'the memory holds the row value "Lusail Stadium" in its summary item',
    );
    // Asked in a teach question, it is the user's own word.
    const asked = signal({ question: 'Goals at Lusail Stadium in 2022?' });
    expect(
      noRowValuesRetained([asked], held, [{ venue: 'Lusail Stadium' }]).passed,
    ).toBe(true);
    // Written in a teach note, likewise.
    const noted = signal({
      kind: 'correction',
      note: 'Count Lusail Stadium too.',
    });
    expect(
      noRowValuesRetained([noted], held, [{ venue: 'Lusail Stadium' }]).passed,
    ).toBe(true);
  });

  it('never counts a category code, a number written as text or a non-text cell', () => {
    const held: LearningStoreItem[] = [
      {
        kind: 'signal',
        documentId: 'd',
        text: "[verified_query · 2026-11-02]\nApproved SQL: … position = 'DF' AND goal_type = 'own_goal' LIMIT 3 … 0.8659",
      },
    ];
    expect(
      noRowValuesRetained([signal()], held, [
        { position: 'DF', goal_type: 'own_goal', n: '3', share: '0.8659' },
        { n: 3, at: new Date('2022-12-18T00:00:00Z'), flag: true },
      ]).passed,
    ).toBe(true);
  });

  it('matches whole words, ignoring case and spacing', () => {
    const rows = [{ team: 'Costa Rica' }];
    const item = (text: string): LearningStoreItem[] => [
      { kind: 'signal', documentId: 'd', text },
    ];
    const verdictOn = (text: string) =>
      noRowValuesRetained([signal()], item(text), rows).passed;
    expect(verdictOn('… COSTA   RICA …')).toBe(false);
    expect(verdictOn('… costa rica.')).toBe(false);
    expect(verdictOn('… Costa Ricans …')).toBe(true);
    expect(verdictOn('… costa_rica …')).toBe(true);
  });

  it('names the first item and counts the others', () => {
    const held: LearningStoreItem[] = [
      { kind: 'signal', documentId: 'a', text: 'France and Croatia' },
      { kind: 'index', documentId: 'a', text: 'France and Croatia' },
    ];
    expect(
      noRowValuesRetained([signal()], held, [
        { team: 'France' },
        { team: 'Croatia' },
      ]).reason,
    ).toBe(
      'the memory holds the row value "France" in its signal item a (and 3 more)',
    );
  });

  it('takes as row values the literals the redaction removes, by its own rule', () => {
    // A name asked in another language is redacted; a code and a literal
    // the question holds stay (BA-81's redaction).
    const spanish = signal({
      question: '¿Cuántos goles marcó Croacia en la prórroga?',
      sql: "SELECT COUNT(*) FROM world_cup.goals g WHERE g.team = 'Croatia' AND g.goal_type <> 'own_goal' AND g.note ILIKE '%prórroga%'",
    });
    expect(redactedLiterals(spanish)).toEqual(['Croatia']);
    expect(rowValues([spanish], [])).toEqual(['Croatia']);
    expect(
      redactedLiterals(
        signal({ sql: "SELECT 1 WHERE x = '?' AND y = 'It''s'" }),
      ),
    ).toEqual(["It's"]);
  });

  it('passes on the memory of every bundled memory case, as the memory renders its signals', () => {
    // The memory's own rendering of each teach signal, its message and its
    // index copy, holds none of the case's redacted literals (R241), so a
    // memory that redacts as BA-81 says passes M1 on every case.
    const cases = loadEvalSets()
      .filter((set) => set.file === 'memory.json')
      .flatMap((set) => set.cases);
    expect(cases).toHaveLength(36);
    const failing = cases
      .map((evalCase) => [
        evalCase.id,
        noRowValuesRetained(evalCase.teach, heldFor(evalCase.teach ?? []), []),
      ])
      .filter(([, verdict]) => typeof verdict !== 'string' && !verdict.passed);
    expect(failing).toEqual([]);
    // And some do carry a literal the store must redact.
    const redacted = cases.filter((evalCase) =>
      (evalCase.teach ?? []).some((taught) => redactedLiterals(taught).length),
    );
    expect(redacted.length).toBeGreaterThanOrEqual(7);
  });
});

describe('normalizedSql (R242)', () => {
  const rejected =
    'SELECT COUNT(*) AS extra_time_goals FROM world_cup.goals g JOIN world_cup.matches m ON m.id = g.match_id WHERE m.went_to_extra_time';

  it('reads the same statement with other aliases, spacing, case and a semicolon as one', () => {
    for (const variant of [
      'select count(*) as extra_time_goals\n  from world_cup.goals AS goal\n  join world_cup.matches AS mt on mt.id = goal.match_id\n  where mt.went_to_extra_time;',
      'SELECT COUNT(*) AS extra_time_goals FROM world_cup.goals JOIN world_cup.matches ON matches.id = goals.match_id WHERE matches.went_to_extra_time',
      'SELECT COUNT(*) AS extra_time_goals -- the rejected one\nFROM "world_cup"."goals" g JOIN world_cup.matches m ON m.id = g.match_id WHERE m.went_to_extra_time ;',
    ]) {
      expect([variant, normalizedSql(variant)]).toEqual([
        variant,
        normalizedSql(rejected),
      ]);
    }
    expect(normalizedSql(rejected)).toBe(
      'select count ( * ) as extra_time_goals from world_cup.goals join world_cup.matches on world_cup.matches.id = world_cup.goals.match_id where world_cup.matches.went_to_extra_time',
    );
  });

  it('tells a different statement apart, and keeps the case of a literal', () => {
    expect(
      normalizedSql(
        rejected.replace('went_to_extra_time', 'went_to_penalties'),
      ),
    ).not.toBe(normalizedSql(rejected));
    expect(normalizedSql("SELECT 1 FROM t WHERE n = 'Croatia'")).not.toBe(
      normalizedSql("SELECT 1 FROM t WHERE n = 'croatia'"),
    );
  });

  it('leaves the FROM of EXTRACT, subqueries and functions alone', () => {
    expect(
      normalizedSql(
        'SELECT EXTRACT(YEAR FROM m.kickoff) FROM world_cup.matches m, (SELECT 1) s, generate_series(1, 2) g',
      ),
    ).toBe(
      'select extract ( year from world_cup.matches.kickoff ) from world_cup.matches , ( select 1 ) s , generate_series ( 1 , 2 ) g',
    );
  });
});

describe('notRejectedSql (R242, M2)', () => {
  const rejected = signal({
    kind: 'rejection',
    question: 'How many goals were scored in extra time?',
    sql: 'SELECT COUNT(*) AS extra_time_goals FROM world_cup.goals g JOIN world_cup.matches m ON m.id = g.match_id WHERE m.went_to_extra_time',
  });
  const teach = [signal(), rejected];
  const rejectedRows = [{ extra_time_goals: '19' }];
  const runReference = () => Promise.resolve(rejectedRows);

  it('passes a probe that took another path', async () => {
    const run = jest.fn(runReference);
    expect(
      await notRejectedSql(
        teach,
        [sqlCall('SELECT COUNT(*) FROM world_cup.goals WHERE minute > 90')],
        [{ goals: 7 }],
        run,
      ),
    ).toEqual({
      id: 'check-not-rejected-sql',
      description:
        'Checks that the probe neither ran nor answered with a rejected SQL',
      score: 1,
      passed: true,
    });
    expect(run).toHaveBeenCalledWith(rejected.sql);
  });

  it('fails a probe that runs the rejected SQL again with other aliases, spacing and case', async () => {
    const verdict = await notRejectedSql(
      teach,
      [
        sqlCall(
          'select count(*) as extra_time_goals from world_cup.goals goal join world_cup.matches mt on mt.id = goal.match_id where mt.went_to_extra_time;',
        ),
      ],
      undefined,
      runReference,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(
      /^the probe ran the rejected SQL of teach signal 2 again: "select count\(\*\) as extra_time_goals/,
    );
  });

  it('reads the SQL fixer’s rewrite as the executed SQL, and skips a failed call', async () => {
    const repaired = sqlCall('SELECT broken', {
      rows: rejectedRows,
      correctedSql: rejected.sql,
    });
    expect(
      (await notRejectedSql(teach, [repaired], undefined, runReference)).passed,
    ).toBe(false);
    const failedCall = sqlCall(rejected.sql, { error: 'boom' }, true);
    expect(
      (await notRejectedSql(teach, [failedCall], undefined, runReference))
        .passed,
    ).toBe(true);
  });

  it("fails when the last query returns the rejected SQL's rows through another query", async () => {
    const verdict = await notRejectedSql(
      teach,
      [sqlCall('SELECT 19 AS goals')],
      [{ goals: 19 }],
      runReference,
    );
    expect(verdict).toMatchObject({
      passed: false,
      reason:
        "the answer has the rejected SQL's rows: the last successful SQL returned the 1 row(s) of teach signal 2's rejected SQL",
    });
  });

  it('passes a result that holds the rejected rows and more: only the same result fails', async () => {
    expect(
      (
        await notRejectedSql(
          teach,
          [sqlCall('SELECT …')],
          [{ goals: 19 }, { goals: 7 }],
          runReference,
        )
      ).passed,
    ).toBe(true);
  });

  it('names both when both happened', async () => {
    const verdict = await notRejectedSql(
      teach,
      [sqlCall(rejected.sql)],
      rejectedRows,
      runReference,
    );
    expect(verdict.reason).toMatch(
      /^the probe ran the rejected SQL of teach signal 2 again: .+; the answer has the rejected SQL's rows: /,
    );
  });

  it('fails when the rejected SQL cannot run, and skips the rows without a complete result', async () => {
    const failing = jest.fn(() => Promise.reject(new Error('no datasource')));
    expect(
      (await notRejectedSql(teach, [], [{ goals: 7 }], failing)).reason,
    ).toBe('the rejected SQL of teach signal 2 failed to run — no datasource');
    failing.mockClear();
    expect((await notRejectedSql(teach, [], undefined, failing)).passed).toBe(
      true,
    );
    expect(failing).not.toHaveBeenCalled();
  });

  it('passes a case with no rejection signal without running anything', async () => {
    const run = jest.fn(runReference);
    expect(
      (await notRejectedSql([signal()], [sqlCall(signal().sql)], [], run))
        .passed,
    ).toBe(true);
    expect((await notRejectedSql(undefined, [], [], run)).passed).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('teachNotRecalled (R243, M3)', () => {
  const record = (
    recalled: EvalMemoryRecord['recalled'],
  ): EvalMemoryRecord => ({
    scope: 'eval-run-case-1',
    held: [],
    recalled,
    summary: 'The analyst means Croatia.',
  });

  it('passes with no record, as under none, and with nothing recalled', () => {
    expect(teachNotRecalled(undefined)).toEqual({
      id: 'check-teach-not-recalled',
      description: 'Checks that no taught signal was recalled into the probe',
      score: 1,
      passed: true,
    });
    // A summary is not a recalled signal.
    expect(teachNotRecalled(record([])).passed).toBe(true);
  });

  it('fails naming the recalled signals', () => {
    expect(
      teachNotRecalled(
        record([
          {
            documentId: 'eval-run-case-1:teach-1',
            kind: 'verified_query',
            content: '…',
          },
          {
            documentId: 'eval-run-case-1:teach-3',
            kind: 'correction',
            content: '…',
          },
        ]),
      ),
    ).toMatchObject({
      passed: false,
      score: 0,
      reason:
        'the probe recalled 2 taught signals: eval-run-case-1:teach-1, eval-run-case-1:teach-3',
    });
  });
});
