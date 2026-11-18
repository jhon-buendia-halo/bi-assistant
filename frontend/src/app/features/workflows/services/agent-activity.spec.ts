import { activitySteps, toolPhrase } from './agent-activity';

describe('agent activity (ui.md 4.4b, Agents at work)', () => {
  it('says a tool call in plain words, naming the table or skill it is about', () => {
    expect(toolPhrase('describe_entity', 'world_cup.public.goals')).toEqual({
      base: 'read the columns of goals',
      done: 'Read the columns of goals',
      doing: 'Reading the columns of goals',
    });
    expect(toolPhrase('describe_entity').doing).toBe('Reading the columns');
    expect(toolPhrase('skill', 'ranking-analysis').done).toBe(
      'Read the ranking analysis skill',
    );
    expect(toolPhrase('skill').doing).toBe('Reading a skill');
    expect(toolPhrase('skill', 'sql-analysis').done).toBe(
      'Read the SQL analysis skill',
    );
    expect(toolPhrase('mcp.tools.list_entities').done).toBe(
      'Looked at the tables',
    );
    expect(toolPhrase('get_weather').done).toBe('Used get weather');
  });

  it("prefers the agent's own reason, and counts rows with the right plural", () => {
    const steps = activitySteps(
      [
        { tool: 'describe_entity', input: 'goals', finished: true },
        {
          tool: 'run_readonly_sql',
          rationale: 'Goals per team, all tournaments.',
          rowCount: 66,
          durationMs: 400,
          finished: true,
        },
        { tool: 'run_readonly_sql', rowCount: 1, finished: true },
      ],
      true,
    );
    expect(steps.map((s) => [s.label, s.state, s.rows, s.query])).toEqual([
      ['Read the columns of goals', 'done', null, false],
      ['Goals per team, all tournaments.', 'done', '66 rows', true],
      ['Ran a query', 'done', '1 row', true],
    ]);
    expect(steps[1].detail).toBe('run_readonly_sql · 66 rows · 400 ms');
    // The agent's first person drops, so done and under way read alike.
    expect(
      activitySteps(
        [{ tool: 'run_readonly_sql', rationale: "I'm checking the stages." }],
        false,
      )[0].label,
    ).toBe('Checking the stages.');
  });

  it('spins only on the latest unfinished call; earlier unfinished ones read as done', () => {
    const steps = activitySteps(
      [
        { tool: 'describe_entity', input: 'matches', finished: false },
        { tool: 'skill', input: 'ranking', finished: false },
        {
          tool: 'run_readonly_sql',
          rationale: 'Teams tied at the top',
          finished: false,
        },
      ],
      true,
    );
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current']);
    expect(steps[2].label).toBe('Teams tied at the top');
    // A phrase reads as under way.
    expect(
      activitySteps([{ tool: 'list_entities', finished: false }], true)[0]
        .label,
    ).toBe('Looking at the tables…');
    // A stored step's calls never spin.
    expect(
      activitySteps([{ tool: 'list_entities' }], false).map((s) => s.state),
    ).toEqual(['done']);
  });

  it('says what could not be done, keeping the raw error for the tooltip', () => {
    const [query, lookup] = activitySteps(
      [
        {
          tool: 'run_readonly_sql',
          rationale: 'Goals by minute',
          error: 'column "goal_minute" does not exist',
          finished: true,
        },
        { tool: 'describe_entity', input: 'goals', error: 'x', finished: true },
      ],
      true,
    );
    expect(query.state).toBe('failed');
    expect(query.label).toBe("Couldn't run this query: goals by minute");
    expect(query.rows).toBeNull();
    expect(query.detail).toContain('column "goal_minute" does not exist');
    expect(lookup.label).toBe("Couldn't read the columns of goals");
  });
});
