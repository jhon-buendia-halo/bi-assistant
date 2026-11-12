// node --test scripts/setup-local.test.mjs (roadmap 0.5.5)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureBody, llmSettings, parseEnv } from './setup-local.mjs';

const pg = { host: '127.0.0.1', port: 55432, user: 'world_cup', password: 'world_cup_dev', ssl: false };

test('a seedable fixture loads with its own defaults', () => {
  const f = { id: 'world-cup', seedable: true, defaults: { ...pg, database: 'world_cup' } };
  assert.deepEqual(fixtureBody(f), f.defaults);
});

test('the Intellify sample loads with its own defaults', () => {
  const f = { id: 'intellify', seedable: true, defaults: { ...pg, database: 'intellify' } };
  assert.deepEqual(fixtureBody(f), f.defaults);
});

test('a fixture that cannot be seeded loads with an empty body', () => {
  assert.deepEqual(fixtureBody({ id: 'rest-sample', seedable: false }), {});
});

test('LLM settings need a base URL and a model', () => {
  assert.equal(llmSettings({ LLM_MODEL: 'm' }), undefined);
  assert.deepEqual(llmSettings(parseEnv('LLM_BASE_URL=https://x\nLLM_MODEL="m"\n')), {
    provider: 'custom',
    apiStyle: 'anthropic',
    baseUrl: 'https://x',
    model: 'm',
  });
});
