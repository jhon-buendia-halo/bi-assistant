// node --test scripts/agent-inventory-lib.test.mjs (delivery.md, Repo scripts)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentHash,
  checkClasses,
  compareInventories,
  formatComparison,
  MATRIX_SCENARIOS,
  modelPolicy,
  registryEntries,
  scenarioHashes,
} from './agent-inventory-lib.mjs';

const tool = (name, description = `${name} tool`) => ({ name, description, input: { type: 'object' } });
const record = (key, classes, toolNames, extra = {}) => {
  const base = { key, classes, instructions: `${key} prompt`, tools: toolNames.map((name) => tool(name)), skills: [], ...extra };
  return { ...base, hash: agentHash(base) };
};
const DATA = ['list_entities', 'describe_entity', 'run_readonly_sql', 'explore_result'];

test('registryEntries reads quoted and bare keys from the agents block only', () => {
  const source = `export const mastra = new Mastra({
  agents: {
    assistant: assistantAgent,
    // a comment
    'sql-fixer': sqlFixerAgent,
  },
  workflows: {
    'agent-turn': agentTurnWorkflow,
  },
});`;
  assert.deepEqual(registryEntries(source), [
    { key: 'assistant', ident: 'assistantAgent' },
    { key: 'sql-fixer', ident: 'sqlFixerAgent' },
  ]);
});

test('registryEntries fails loudly when the registry cannot be read', () => {
  assert.throws(() => registryEntries('const x = 1;'), /No `agents/);
});

test('modelPolicy names how the source picks its model', () => {
  assert.equal(modelPolicy('resolveAgentModel(modelOverrideFrom(requestContext))'), 'user-override');
  assert.equal(modelPolicy('resolveAgentModel(stepModelFrom(requestContext)?.model)'), 'step-model');
  assert.equal(modelPolicy('await resolveVisualizationModel(stepModelFrom(requestContext)?.model)'), 'designer');
  assert.equal(modelPolicy('model: async () => resolveAgentModel()'), 'saved');
});

test("modelPolicy reads a factory spec's policy name", () => {
  assert.equal(modelPolicy("  model: 'override-or-step-model',\n"), 'override-or-step-model');
  assert.equal(modelPolicy("  model: 'step-model',\n"), 'step-model');
});

test('the hash ignores tool order and changes with a tool description', () => {
  const a = { instructions: 'p', tools: [tool('a'), tool('b')], skills: [] };
  assert.equal(agentHash(a), agentHash({ ...a, tools: [tool('b'), tool('a')] }));
  assert.notEqual(agentHash(a), agentHash({ ...a, tools: [tool('a', 'other'), tool('b')] }));
});

test('the class check flags each missing kit tool, tools on a single step, and registry drift', () => {
  const records = [
    record('analyst', ['person', 'data'], ['list_entities', 'run_readonly_sql']),
    record('fixer', ['single-step'], ['run_readonly_sql']),
    record('lead', ['person', 'data'], [...DATA, 'ask_clarification']),
    record('newcomer', [], []),
  ];
  const classes = { analyst: [], fixer: [], lead: [], gone: [] };
  const check = checkClasses(records, classes);
  assert.deepEqual(check.unclassified, ['newcomer']);
  assert.deepEqual(check.stale, ['gone']);
  assert.deepEqual(check.gaps, [
    { key: 'analyst', gap: 'talks to a person but has no ask_clarification' },
    { key: 'analyst', gap: 'answers from data but misses describe_entity, explore_result' },
    { key: 'fixer', gap: 'is single-step but has tools: run_readonly_sql' },
  ]);
});

test('the comparison names what changed and which agents need their evals', () => {
  const base = [record('same', ['single-step'], []), record('grows', ['data'], DATA), record('gone', ['single-step'], [])];
  const branch = [
    record('same', ['single-step'], []),
    record('grows', ['data'], [...DATA, 'ask_clarification'], { instructions: 'grows prompt, longer' }),
    record('new', ['single-step'], []),
  ];
  const diff = compareInventories(base, branch);
  assert.deepEqual(diff.added, ['new']);
  assert.deepEqual(diff.removed, ['gone']);
  assert.deepEqual(diff.changed, [{ key: 'grows', what: ['instructions 12 → 20 chars', 'tools + ask_clarification'] }]);
  assert.match(formatComparison(diff), /Evals to run \(base against branch\): new, grows$/);
});

test('a change only under a request context still names the agent', () => {
  const base = [{ ...record('lead', ['data'], DATA), matrixHash: 'aaa' }];
  const branch = [{ ...record('lead', ['data'], DATA), matrixHash: 'bbb' }];
  const diff = compareInventories(base, branch);
  assert.deepEqual(diff.changed, [{ key: 'lead', what: ['what it receives under a request context (matrix)'] }]);
  assert.match(formatComparison(diff), /Evals to run \(base against branch\): lead$/);
});

test('a base without matrix hashes compares on the plain hash only', () => {
  const base = [record('lead', ['data'], DATA)];
  const branch = [{ ...record('lead', ['data'], DATA), matrixHash: 'bbb' }];
  assert.deepEqual(compareInventories(base, branch).changed, []);
});

test('equal inventories need no evals', () => {
  const records = [record('same', ['single-step'], [])];
  assert.match(formatComparison(compareInventories(records, records)), /the evals need not run/);
});

const named = (names) => MATRIX_SCENARIOS.filter((scenario) => names.includes(scenario.name)).map((scenario) => scenario.name);

test('the user-agent scenarios are tagged: every tool selection, the override and the user-agent ones', () => {
  const tagged = MATRIX_SCENARIOS.filter((scenario) => scenario.userAgent).map((scenario) => scenario.name);
  assert.deepEqual(tagged, [
    'tools:none',
    'tools:sample_rows',
    'tools:legacy-visuals+clarify',
    'user-override',
    'user-agent:skills',
    'user-agent:override+step-model',
    'user-agent:no-clarify+gates:closed',
  ]);
  assert.deepEqual(named(['gates:closed', 'step-model', 'overrides']), ['gates:closed', 'step-model', 'overrides']);
  assert.ok(MATRIX_SCENARIOS.filter((scenario) => !scenario.userAgent).every((scenario) => !JSON.stringify(scenario.context).includes('agent-')));
});

test('scenarioHashes gives one hash per scenario, equal for equal outputs', () => {
  const outputs = [
    { scenario: 'empty', read: { instructions: 'a' }, model: 'm' },
    { scenario: 'tools:none', read: { instructions: 'a' }, model: 'm' },
    { scenario: 'gates:closed', read: { instructions: 'b' }, model: 'm' },
  ];
  const hashes = scenarioHashes(outputs);
  assert.deepEqual(Object.keys(hashes), ['empty', 'tools:none', 'gates:closed']);
  assert.equal(hashes.empty, hashes['tools:none']);
  assert.notEqual(hashes.empty, hashes['gates:closed']);
});

const withScenarios = (rec, scenarios) => ({ ...rec, matrixHash: JSON.stringify(scenarios), scenarioHashes: scenarios });

test('a change under user-agent scenarios only names them and says so', () => {
  const base = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'gates:closed': 'g', 'tools:none': 't', 'user-agent:skills': 's' })];
  const branch = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'gates:closed': 'g', 'tools:none': 'T', 'user-agent:skills': 'S' })];
  const diff = compareInventories(base, branch);
  assert.deepEqual(diff.changed, [
    {
      key: 'lead',
      what: ['under 2 scenarios: tools:none, user-agent:skills (only user-agent scenarios)'],
      scenarios: ['tools:none', 'user-agent:skills'],
    },
  ]);
  assert.match(formatComparison(diff), /- changed lead: under 2 scenarios: tools:none, user-agent:skills \(only user-agent scenarios\)/);
});

test('a change under an untagged scenario is named without the user-agent note', () => {
  const base = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'gates:closed': 'g', 'tools:none': 't' })];
  const branch = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'gates:closed': 'G', 'tools:none': 'T' })];
  assert.deepEqual(compareInventories(base, branch).changed, [
    { key: 'lead', what: ['under 2 scenarios: gates:closed, tools:none'], scenarios: ['gates:closed', 'tools:none'] },
  ]);
});

test('scenario hashes win over the matrix hash: a scenario only one side has changes nothing', () => {
  const base = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'tools:visuals+clarify': 'v' })];
  const branch = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'tools:legacy-visuals+clarify': 'w' })];
  assert.deepEqual(compareInventories(base, branch).changed, []);
});

test('a plain-hash change also names the scenarios that differ', () => {
  const base = [withScenarios(record('lead', ['data'], DATA), { empty: 'e', 'user-override': 'u' })];
  const branch = [withScenarios(record('lead', ['data'], DATA, { instructions: 'lead prompt, longer' }), { empty: 'E', 'user-override': 'U' })];
  assert.deepEqual(compareInventories(base, branch).changed, [
    {
      key: 'lead',
      what: ['instructions 11 → 19 chars', 'under 2 scenarios: empty, user-override'],
      scenarios: ['empty', 'user-override'],
    },
  ]);
});
