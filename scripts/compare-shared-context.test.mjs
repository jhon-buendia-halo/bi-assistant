// node --test scripts/compare-shared-context.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildSummary,
  durationStats,
  labelOf,
  loadVariant,
  median,
  parseJsonl,
  passStats,
  pctChange,
  readsStats,
  renderReport,
  resolvePath,
  stripShared,
  tokenStats,
} from './compare-shared-context.mjs';

const rec = (label, input, output, extra = {}) => ({
  label,
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalInputTokens: input,
  requestChars: input * 4,
  toolUses: 0,
  ...extra,
});

const baselineRounds = [
  {
    name: 'round-1',
    meter: [rec('plan', 1000, 100), rec('analyse', 3000, 200, { toolUses: 2 }), rec('write-answer', 2000, 300), rec('other', 500, 50)],
    results: [
      { id: 'a', passed: true, durationMs: 10000, checkResults: [{ id: 'c1', passed: true }] },
      { id: 'b', passed: false, durationMs: 20000, checkResults: [{ id: 'c2', passed: false }] },
    ],
  },
  {
    name: 'round-2',
    meter: [rec('plan', 1000, 100), rec('analyse', 3000, 200)],
    results: [
      { id: 'a', passed: true, durationMs: 30000 },
      { id: 'b', passed: true, durationMs: 40000 },
    ],
  },
];

const sharedRounds = [
  {
    name: 'round-1',
    meter: [rec('plan', 500, 100, { toolUses: 1 }), rec('plan', 600, 50), rec('analyse', 1000, 200), rec('write-answer', 800, 300), rec('other', 500, 50)],
    results: [
      { id: 'shared-a', passed: true, durationMs: 12000, details: { reads: [{ chars: 100 }, { chars: 50 }] } },
      { id: 'shared-b', passed: true, durationMs: 22000, details: { reads: [{ chars: 10 }] } },
    ],
  },
];

test('stripShared and median', () => {
  assert.equal(stripShared('shared-x-1'), 'x-1');
  assert.equal(stripShared('x'), 'x');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('pctChange', () => {
  assert.equal(pctChange(100, 77), -23);
  assert.equal(pctChange(0, 5), null);
});

test('passStats pairs cases and counts per case', () => {
  const b = passStats(baselineRounds);
  assert.equal(b.passed, 3);
  assert.equal(b.total, 4);
  assert.deepEqual(b.perCase.get('b'), { passed: 1, total: 2 });
  const s = passStats(sharedRounds);
  assert.deepEqual(s.perCase.get('a'), { passed: 1, total: 1 });
});

test('durationStats mean and median', () => {
  const d = durationStats(baselineRounds);
  assert.equal(d.mean, 25000);
  assert.equal(d.median, 25000);
});

test('tokenStats per label, without other, per case', () => {
  const t = tokenStats(baselineRounds);
  assert.equal(t.cases, 4);
  assert.equal(t.byLabel.plan.calls, 2);
  assert.equal(t.byLabel.plan.totalInputTokens, 2000);
  assert.equal(t.byLabel.analyse.toolUses, 2);
  assert.equal(t.all.totalInputTokens, 2000 + 6000 + 2000 + 500);
  assert.equal(t.withoutOther.totalInputTokens, 10000);
  assert.equal(t.perCase.withoutOther.totalInputTokens, 2500);
  assert.equal(t.perCase.byLabel.other.calls, 0.25);
  assert.equal(t.perCase.withoutOther.calls, 5 / 4);
});

test('tokenStats maps unknown labels to other', () => {
  const t = tokenStats([{ name: 'round-1', meter: [rec('weird', 7, 1)], results: [{ id: 'a', passed: true, durationMs: 1 }] }]);
  assert.equal(t.byLabel.other.calls, 1);
});

test('resolvePath and readsStats', () => {
  assert.equal(resolvePath({ a: { b: 3 } }, 'a.b'), 3);
  assert.equal(resolvePath({}, 'a.b'), undefined);
  const r = readsStats(sharedRounds, null);
  assert.equal(r.reads, 3);
  assert.equal(r.chars, 160);
  assert.equal(r.readsPerCase, 1.5);
  assert.equal(readsStats(sharedRounds, 'details.reads').reads, 3);
  assert.equal(readsStats(sharedRounds, 'nope.path'), null);
  assert.equal(readsStats(baselineRounds, null), null);
});

test('buildSummary changes shared vs baseline', () => {
  const s = buildSummary(baselineRounds, sharedRounds);
  // baseline without other per case: 10000/4 = 2500; shared: (500+600+1000+800)/2 = 1450
  assert.equal(s.shared.tokens.perCase.withoutOther.totalInputTokens, 1450);
  assert.ok(Math.abs(s.changes.inputTokensPerCaseWithoutOther - -42) < 1e-9);
  assert.equal(s.shared.pass.passed, 2);
});

test('renderReport carries the key numbers', () => {
  const md = renderReport(buildSummary(baselineRounds, sharedRounds));
  assert.match(md, /Pass rate: 2\/2 \(shared\) vs 3\/4 \(baseline\)/);
  assert.match(md, /−42\.0 %/);
  assert.match(md, /\| b \| 1\/2 \| 1\/1 \|/);
  assert.match(md, /Lecturas\/caso/);
  const noReads = renderReport(buildSummary(baselineRounds, baselineRounds));
  assert.match(noReads, /No disponible/);
});

test('parseJsonl skips blank and torn lines', () => {
  assert.deepEqual(parseJsonl('{"a":1}\n\n{bad\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
});

test('loadVariant reads rounds in numeric order, tolerates a missing meter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-test-'));
  try {
    for (const n of [10, 2, 1]) {
      fs.mkdirSync(path.join(dir, `round-${n}`));
      fs.writeFileSync(path.join(dir, `round-${n}`, 'results.json'), JSON.stringify([{ id: `c${n}`, passed: true, durationMs: 1 }]));
    }
    fs.writeFileSync(path.join(dir, 'round-2', 'meter.jsonl'), JSON.stringify(rec('plan', 1, 1)) + '\n');
    const rounds = loadVariant(dir);
    assert.deepEqual(rounds.map((r) => r.name), ['round-1', 'round-2', 'round-10']);
    assert.equal(rounds[1].meter.length, 1);
    assert.equal(rounds[0].meter.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('labelOf splits the proxy other calls into judge and sql-repair', () => {
  assert.equal(labelOf({ label: 'plan' }), 'plan');
  assert.equal(labelOf({ label: 'other', systemStart: 'You are a strict, impartial grader for an automated eval suite.' }), 'judge');
  assert.equal(labelOf({ label: 'other', systemStart: 'You repair a single SQL statement that failed.' }), 'sql-repair');
  assert.equal(labelOf({ label: 'other', systemStart: 'Something else' }), 'other');
});

test('costUnits weighs cache and output at relative prices', async () => {
  const { costUnits } = await import('./compare-shared-context.mjs');
  assert.equal(costUnits({ inputTokens: 10, cacheCreationTokens: 100, cacheReadTokens: 1000, outputTokens: 2 }), 10 + 125 + 100 + 10);
});
