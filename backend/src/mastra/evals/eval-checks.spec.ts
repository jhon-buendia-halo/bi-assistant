import {
  checkIds,
  describeCheck,
  describeChecks,
  evaluateChecks,
  isTextCheckId,
  type EvalCheckTurn,
} from './eval-checks';
import type { EvalCheckSpec } from './suite-loader';

function turn(over: Partial<EvalCheckTurn> = {}): EvalCheckTurn {
  return {
    text: 'Argentina won the 2022 final against France on penalties (3–3, 4–2).',
    calledTools: ['describe_entity', 'run_readonly_sql'],
    toolErrors: [],
    finalSqlOk: true,
    ...over,
  };
}

function one(spec: EvalCheckSpec, over: Partial<EvalCheckTurn> = {}) {
  return evaluateChecks([spec], turn(over))[0];
}

describe('check ids', () => {
  // These must stay byte-identical to the @mastra/evals/checks scorer ids:
  // stored runs, the regression diff and the Evals tab all key on them.
  it('uses the Mastra scorer id for every type', () => {
    const specs: EvalCheckSpec[] = [
      { type: 'includes', value: 'x' },
      { type: 'excludes', value: 'x' },
      { type: 'equals', value: 'x' },
      { type: 'matches', pattern: 'x' },
      { type: 'calledTool', tool: 't' },
      { type: 'didNotCall', tool: 't' },
      { type: 'toolOrder', tools: ['t'] },
      { type: 'noToolErrors' },
      { type: 'usedNoTools' },
      { type: 'maxToolCalls', max: 1 },
      { type: 'finalSqlSucceeded' },
    ];
    expect(checkIds(specs)).toEqual([
      'check-includes',
      'check-excludes',
      'check-equals',
      'check-matches',
      'check-called-tool',
      'check-did-not-call',
      'check-tool-order',
      'check-no-tool-errors',
      'check-used-no-tools',
      'check-max-tool-calls',
      'check-final-sql-succeeded',
    ]);
  });

  it('suffixes only a repeated type, so two scores never merge', () => {
    expect(
      checkIds([
        { type: 'matches', pattern: 'a' },
        { type: 'includes', value: 'b' },
        { type: 'matches', pattern: 'c' },
        { type: 'matches', pattern: 'd' },
      ]),
    ).toEqual([
      'check-matches',
      'check-includes',
      'check-matches-2',
      'check-matches-3',
    ]);
  });

  it('tells text checks from tool checks, suffixes included', () => {
    expect(isTextCheckId('check-matches-2')).toBe(true);
    expect(isTextCheckId('check-includes')).toBe(true);
    expect(isTextCheckId('check-called-tool')).toBe(false);
    expect(isTextCheckId('result-set-match')).toBe(false);
  });
});

describe('text checks', () => {
  it('includes / excludes / equals ignore case, like the Mastra scorers', () => {
    expect(one({ type: 'includes', value: 'ARGENTINA' }).passed).toBe(true);
    expect(one({ type: 'excludes', value: 'pelé' }).passed).toBe(true);
    expect(
      one({ type: 'equals', value: 'yes' }, { text: 'Yes\n' }).passed,
    ).toBe(true);
  });

  it('explains a failed includes with the expected value and the answer', () => {
    const result = one({ type: 'includes', value: 'Croatia' });
    expect(result).toMatchObject({
      id: 'check-includes',
      passed: false,
      score: 0,
    });
    expect(result.reason).toBe(
      'expected "Croatia" in the answer — answer was "Argentina won the 2022 final against France on penalties (3–3, 4–2)."',
    );
    expect(one({ type: 'excludes', value: 'France' }).reason).toMatch(
      /^expected "France" NOT to appear — answer was/,
    );
  });

  it('says so when there was no answer at all', () => {
    expect(
      one({ type: 'includes', value: 'x' }, { text: '  ' }).reason,
    ).toMatch(/the agent produced no answer text$/);
  });

  it('matches case-insensitively unless the spec gives flags', () => {
    expect(one({ type: 'matches', pattern: 'argentina' }).passed).toBe(true);
    expect(
      one({ type: 'matches', pattern: 'argentina', flags: '' }).passed,
    ).toBe(false);
    expect(
      one({ type: 'matches', pattern: 'Argentina', flags: '' }).passed,
    ).toBe(true);
  });

  it('names the effective regex in the reason', () => {
    expect(one({ type: 'matches', pattern: 'croatia' }).reason).toMatch(
      /^expected the answer to match \/croatia\/i — answer was/,
    );
  });

  it('supports an AND of two patterns written as lookaheads', () => {
    const spec: EvalCheckSpec = {
      type: 'matches',
      pattern: '^(?=[\\s\\S]*claim[ _]denials)(?=[\\s\\S]*denial[ _]reasons)',
    };
    expect(
      one(spec, { text: 'Tables: denial_reasons,\nclaim_denials' }).passed,
    ).toBe(true);
    expect(one(spec, { text: 'Only claim_denials' }).passed).toBe(false);
  });
});

describe('tool checks', () => {
  it('calledTool counts calls against times', () => {
    expect(one({ type: 'calledTool', tool: 'run_readonly_sql' }).passed).toBe(
      true,
    );
    const twice = one({
      type: 'calledTool',
      tool: 'run_readonly_sql',
      times: 2,
    });
    expect(twice.passed).toBe(false);
    expect(twice.reason).toBe(
      'expected "run_readonly_sql" to be called 2×, it was called 1×',
    );
  });

  it('didNotCall fails on any call and says how many', () => {
    const result = one({ type: 'didNotCall', tool: 'run_readonly_sql' });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(
      'expected "run_readonly_sql" NOT to be called, it was (1×)',
    );
  });

  it('toolOrder is a relaxed subsequence', () => {
    const calledTools = [
      'list_entities',
      'run_readonly_sql',
      'describe_entity',
      'create_visual',
    ];
    expect(
      one(
        { type: 'toolOrder', tools: ['run_readonly_sql', 'create_visual'] },
        { calledTools },
      ).passed,
    ).toBe(true);
    const wrong = one(
      { type: 'toolOrder', tools: ['create_visual', 'run_readonly_sql'] },
      { calledTools },
    );
    expect(wrong.passed).toBe(false);
    expect(wrong.reason).toBe(
      'expected the tool order create_visual → run_readonly_sql, got list_entities → run_readonly_sql → describe_entity → create_visual',
    );
    expect(
      one({ type: 'toolOrder', tools: ['a'] }, { calledTools: [] }).reason,
    ).toBe('expected the tool order a, got nothing');
  });

  it('maxToolCalls and usedNoTools count every call, ask_clarification included', () => {
    expect(one({ type: 'maxToolCalls', max: 2 }).passed).toBe(true);
    expect(one({ type: 'maxToolCalls', max: 1 }).reason).toBe(
      'expected at most 1 tool calls, the agent made 2',
    );
    expect(
      one({ type: 'usedNoTools' }, { calledTools: ['ask_clarification'] })
        .passed,
    ).toBe(false);
    expect(one({ type: 'usedNoTools' }, { calledTools: [] }).passed).toBe(true);
  });

  it('noToolErrors fails on any tool error, even one the turn recovered from', () => {
    expect(one({ type: 'noToolErrors' }).passed).toBe(true);
    const result = one(
      { type: 'noToolErrors' },
      { toolErrors: ['column "x" does not exist'] },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('a tool call failed: column "x" does not exist');
  });

  it('finalSqlSucceeded only asks whether the last query ran', () => {
    // Recovered from an error: noToolErrors says no, finalSqlSucceeded says yes.
    expect(
      one(
        { type: 'finalSqlSucceeded' },
        { toolErrors: ['boom'], finalSqlOk: true },
      ).passed,
    ).toBe(true);
    expect(
      one({ type: 'finalSqlSucceeded' }, { finalSqlOk: false }).reason,
    ).toBe("the answer's final SQL query failed");
    expect(
      one(
        { type: 'finalSqlSucceeded' },
        { finalSqlOk: false, calledTools: ['list_entities'] },
      ).reason,
    ).toBe('the agent never ran a SQL query');
  });
});

describe('evaluateChecks', () => {
  it('returns one result per spec, in order, with scores 0/1 and no reason on a pass', () => {
    const results = evaluateChecks(
      [
        { type: 'includes', value: 'Argentina' },
        { type: 'calledTool', tool: 'ask_clarification' },
      ],
      turn(),
    );
    expect(results).toEqual([
      {
        id: 'check-includes',
        description: 'Checks if output includes "Argentina"',
        score: 1,
        passed: true,
      },
      expect.objectContaining({
        id: 'check-called-tool',
        score: 0,
        passed: false,
      }),
    ]);
  });

  it('throws on an unknown type rather than scoring the case on fewer checks', () => {
    expect(() =>
      evaluateChecks(
        [{ type: 'includesish' } as unknown as EvalCheckSpec],
        turn(),
      ),
    ).toThrow(/Unsupported eval check type "includesish"/);
  });
});

describe('describeCheck', () => {
  it('reads exactly as the Mastra scorer did in the Evals tab', () => {
    expect(describeCheck({ type: 'includes', value: 'Argentina' })).toEqual({
      id: 'check-includes',
      name: 'Includes Check',
      description: 'Checks if output includes "Argentina"',
    });
    expect(
      describeCheck({ type: 'calledTool', tool: 'run_readonly_sql' })
        .description,
    ).toBe('Checks that "run_readonly_sql" was called');
    expect(
      describeCheck({ type: 'calledTool', tool: 't', times: 2 }).description,
    ).toBe('Checks that "t" was called at least 2 times');
    expect(
      describeCheck({ type: 'toolOrder', tools: ['a', 'b'] }).description,
    ).toBe('Checks tool call order: [a → b]');
    expect(describeCheck({ type: 'noToolErrors' })).toEqual({
      id: 'check-no-tool-errors',
      name: 'No Tool Errors Check',
      description: 'Checks that no tool calls resulted in errors',
    });
    expect(describeCheck({ type: 'finalSqlSucceeded' }).name).toBe(
      'Final SQL Succeeded Check',
    );
  });

  it('shows the regex that will actually run, default flag included', () => {
    expect(
      describeCheck({ type: 'matches', pattern: '4\\s*-\\s*2' }).description,
    ).toBe('Checks if output matches pattern /4\\s*-\\s*2/i');
    expect(
      describeCheck({ type: 'matches', pattern: 'PAID', flags: '' })
        .description,
    ).toBe('Checks if output matches pattern /PAID/');
  });

  it('describeChecks aligns ids with evaluateChecks', () => {
    const specs: EvalCheckSpec[] = [
      { type: 'matches', pattern: 'a' },
      { type: 'matches', pattern: 'b' },
    ];
    expect(describeChecks(specs).map((check) => check.id)).toEqual(
      evaluateChecks(specs, turn()).map((result) => result.id),
    );
  });
});
