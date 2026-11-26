// node --test scripts/agent-inventory-lib.test.mjs (delivery.md, Repo scripts)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentHash,
  checkClasses,
  compareInventories,
  formatComparison,
  modelPolicy,
  registryEntries,
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

test('equal inventories need no evals', () => {
  const records = [record('same', ['single-step'], [])];
  assert.match(formatComparison(compareInventories(records, records)), /the evals need not run/);
});
