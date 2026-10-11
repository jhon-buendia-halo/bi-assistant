import {
  attachPositions,
  parseDataModelYaml,
  serializeDataModel,
} from './yaml';
import {
  validateAgainstSnapshot,
  validateDataModel,
} from '../schema/data-model.schema';
import { worldCupFixture } from './__fixtures__/world-cup.fixture';
import type { DataModel, ModelIssue } from '../entities/data-model.entity';

/**
 * `parseDataModelYaml`'s "no issues" branch is the only one with a `model`
 * key at all (the task's own signature — `{ model; issues: [] } | { issues }`
 * — leaves it off the other branch entirely, not just optional), so reading
 * `.model` needs an `in` narrowing rather than a bare `!`/optional-chain.
 */
function modelOf(
  result: ReturnType<typeof parseDataModelYaml>,
): DataModel | undefined {
  return 'model' in result ? result.model : undefined;
}

function expectModel(result: ReturnType<typeof parseDataModelYaml>): DataModel {
  const model = modelOf(result);
  if (!model) {
    throw new Error(
      `expected a parsed model, got issues: ${JSON.stringify(result.issues)}`,
    );
  }
  return model;
}

/**
 * Asserts one issue's path/message/position without building an object
 * literal around `expect.stringContaining` (typed `any`) — that trips
 * `no-unsafe-assignment` at the property position, whereas passing it as a
 * bare matcher argument to `toEqual` does not.
 */
function expectIssue(
  issue: ModelIssue,
  path: string,
  messageContains: string,
  position?: { line: number; col: number },
): void {
  expect(issue.path).toBe(path);
  expect(issue.message).toEqual(expect.stringContaining(messageContains));
  if (position) {
    expect(issue.line).toBe(position.line);
    expect(issue.col).toBe(position.col);
  }
}

describe('serializeDataModel / parseDataModelYaml — round trip', () => {
  it('round-trips the World Cup fixture exactly', () => {
    const model = worldCupFixture();
    const text = serializeDataModel(model);
    const result = parseDataModelYaml(text);
    expect(result.issues).toEqual([]);
    expect(modelOf(result)).toEqual(model);
  });

  it('produces stable, readable YAML: declared key order, flow style for short arrays', () => {
    const text = serializeDataModel(worldCupFixture());
    const lines = text.split('\n');

    // Top-level keys in DataModel's declared order.
    expect(lines[0]).toBe('model: world_cup');
    expect(lines[1]).toBe('version: 1');
    expect(lines[2]).toBe(
      'description: World Cup matches and teams, trimmed for tests.',
    );
    expect(lines[3]).toBe('entities:');

    // `key` and `samples` render as flow sequences, not one item per line.
    expect(text).toContain('key: [ team_id ]');
    expect(text).toContain('samples: [ 64000, 72000, 45000 ]');

    // No anchors/aliases anywhere in the output.
    expect(text).not.toMatch(/[&*]/);
  });

  it('omits undefined/optional fields rather than writing them as null', () => {
    const model = worldCupFixture();
    delete model.description;
    const text = serializeDataModel(model);
    expect(text).not.toMatch(/^description:/m);
    expect(text).not.toMatch(/:\s*null\s*$/m);
  });
});

describe('parseDataModelYaml — syntax errors', () => {
  it('reports a YAML syntax error with line and column', () => {
    const text = 'model: sample\n  bad: [1,2\n';
    const result = parseDataModelYaml(text);
    expect(modelOf(result)).toBeUndefined();
    expect(result.issues).not.toEqual([]);
    expect(result.issues[0]).toMatchObject({ line: 1, col: 8 });
    expect(result.issues[0].message).toMatch(/compact mapping/i);
  });
});

describe('parseDataModelYaml — issue positioning', () => {
  // Line numbers below are asserted against this exact fixture text, 1-indexed.
  const lines = [
    /* 1  */ 'model: sample',
    /* 2  */ 'version: 1',
    /* 3  */ 'entities:',
    /* 4  */ '  - name: matches',
    /* 5  */ '    bindings:',
    /* 6  */ '      - kind: sql',
    /* 7  */ '        datasource: ds',
    /* 8  */ '        table: bad_table',
    /* 9  */ '    attributes:',
    /* 10 */ '      - name: id',
    /* 11 */ '        type: integer',
    /* 12 */ 'relationships: []',
    /* 13 */ 'metrics: []',
    '',
  ];
  const text = lines.join('\n');

  it('points a structural issue at the exact offending node', () => {
    const result = parseDataModelYaml(text);
    expect(modelOf(result)).toBeUndefined();
    expect(result.issues).toHaveLength(1);
    expectIssue(
      result.issues[0],
      'entities[0].bindings[0].table',
      'bad_table',
      {
        line: 8,
        col: 16,
      },
    );
  });

  it('falls back to the nearest ancestor node for an issue about a missing key', () => {
    const ratioLines = [
      'model: sample',
      'version: 1',
      'entities:',
      '  - name: matches',
      '    bindings:',
      '      - kind: sql',
      '        datasource: ds',
      '        table: main.public.matches',
      '    attributes:',
      '      - name: id',
      '        type: integer',
      'relationships: []',
      'metrics:',
      '  - name: bad_metric',
      '    label: Bad',
      '    entity: matches',
      '    agg: ratio',
      '',
    ];
    const result = parseDataModelYaml(ratioLines.join('\n'));
    expect(modelOf(result)).toBeUndefined();
    // Both "numerator" and "denominator" are absent keys — there is no node
    // at metrics[0].numerator to point at, so both fall back to the metric
    // mapping itself, which starts on line 14.
    expect(result.issues).toHaveLength(2);
    expectIssue(result.issues[0], 'metrics[0].numerator', 'numerator', {
      line: 14,
      col: 5,
    });
    expectIssue(result.issues[1], 'metrics[0].denominator', 'denominator', {
      line: 14,
      col: 5,
    });
  });
});

describe('attachPositions', () => {
  it('positions issues produced after parsing, e.g. snapshot drift', () => {
    const model = worldCupFixture();
    const text = serializeDataModel(model);
    const parsed = parseDataModelYaml(text);
    expect(modelOf(parsed)).toBeDefined();

    const snapshot = [
      {
        table: 'main.public.teams',
        columns: ['common_name', 'fifa_code'], // "id" missing -> team_id drifts
      },
      {
        table: 'main.public.matches',
        columns: [
          'id',
          'home_team_id',
          'away_team_id',
          'winner_team_id',
          'stage',
          'attendance',
        ],
      },
    ];
    const driftIssues = validateAgainstSnapshot(expectModel(parsed), snapshot);
    expect(driftIssues).toHaveLength(1);
    expectIssue(
      driftIssues[0],
      'entities[0].bindings[0].columns.team_id',
      'team_id',
    );

    const positioned = attachPositions(text, driftIssues);
    expect(positioned[0].line).toEqual(expect.any(Number));
    expect(positioned[0].col).toEqual(expect.any(Number));
    // The drift is on the "columns" mapping inside teams' binding, which the
    // serializer always places before the "attributes" block.
    const columnsLine =
      text.split('\n').findIndex((l) => l.trim() === 'team_id: id') + 1;
    expect(positioned[0].line).toBe(columnsLine);
  });

  it('leaves issues untouched when the text does not parse', () => {
    const issues = [{ path: 'model', message: 'whatever' }];
    expect(attachPositions('  bad: [1,2', issues)).toEqual(issues);
  });
});

describe('validateDataModel + parseDataModelYaml consistency', () => {
  it('agrees with validateDataModel on a model with no YAML involved', () => {
    const model = worldCupFixture();
    const direct = validateDataModel(model);
    const viaYaml = parseDataModelYaml(serializeDataModel(model));
    expect(viaYaml.issues).toEqual(direct.issues);
  });
});
