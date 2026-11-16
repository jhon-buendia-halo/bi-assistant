// node --test scripts/spec-index-lib.test.mjs (roadmap 1.23.29, delivery.md 13)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capLines,
  indexEntries,
  indexIsStale,
  indexLines,
  namedSpecs,
  planReferences,
  planSections,
  renderIndex,
  slug,
  storyEntry,
} from './spec-index-lib.mjs';
import { buildPack } from './story-pack-lib.mjs';

const DOC = ['# Title', '', '## Rules', '', '- R1. First rule', '  continued', '- R2. Second rule', '', '### Sub', 'text', '', '## Next', '```', '## not a heading', '```', 'end'].join('\n');

test('index entries carry heading and rule line ranges', () => {
  assert.deepEqual(
    indexLines('specs/a.md', DOC),
    [
      'specs/a.md:3-10  ## Rules',
      'specs/a.md:5-6  R1 First rule',
      'specs/a.md:7-7  R2 Second rule',
      'specs/a.md:9-10  ### Sub',
      'specs/a.md:12-16  ## Next',
    ],
  );
});

test('headings inside code fences are ignored and level 1 is not indexed', () => {
  const labels = indexEntries(DOC).map((e) => e.label);
  assert.ok(!labels.includes('## not a heading'));
  assert.ok(!labels.includes('# Title'));
});

test('renderIndex sorts by path and skips files without entries', () => {
  const out = renderIndex([
    { path: 'specs/b.md', text: '## B\n' },
    { path: 'specs/a.md', text: '## A\n' },
    { path: 'specs/c.md', text: 'no headings' },
  ]);
  assert.ok(out.indexOf('specs/a.md') < out.indexOf('specs/b.md'));
  assert.ok(!out.includes('specs/c.md'));
  assert.ok(out.endsWith('\n'));
});

test('staleness: equal text is fresh, any change or CRLF difference handled', () => {
  const fresh = renderIndex([{ path: 'specs/a.md', text: DOC }]);
  assert.equal(indexIsStale(fresh, fresh), false);
  assert.equal(indexIsStale(fresh.replace(/\n/g, '\r\n'), fresh), false);
  assert.equal(indexIsStale(fresh, renderIndex([{ path: 'specs/a.md', text: `${DOC}\n## More\n` }])), true);
});

test('plan references: links, bare paths, plan section numbers', () => {
  const r = planReferences('Per [plan](docs/plans/x.md#a) and plan section 3, plan 1.24.6, plan 1.24.6.');
  assert.deepEqual(r.files, ['docs/plans/x.md']);
  assert.deepEqual(r.sections, ['3', '1.24.6']);
});

test('plan sections resolve by heading number', () => {
  const plan = '## 1.24.5 — a\nx\n#### 1.24.6 — b\ny\n\n#### 1.24.7 — c\nz\n## 3. Foo\nbar';
  const [s] = planSections(plan, ['1.24.6']);
  assert.equal(s.text, '#### 1.24.6 — b\ny');
  assert.equal(planSections(plan, ['3'])[0].text, '## 3. Foo\nbar');
  assert.deepEqual(planSections(plan, ['9']), []);
});

test('capLines cuts and says so', () => {
  const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
  assert.equal(capLines(text, 20), text);
  const cut = capLines(text, 3);
  assert.equal(cut.split('\n').length, 4);
  assert.match(cut, /cut at 3 lines, 7 more/);
});

test('slug matches GitHub anchors', () => {
  assert.equal(slug('## Edge cases and errors'), 'edge-cases-and-errors');
  assert.equal(slug('### 3.1 `x` (y)'), '31-x-y');
});

test('named specs read rules from a Specs line', () => {
  const paths = ['specs/capabilities/data-readiness/spec.md', 'specs/system/data-model.md', 'specs/capabilities/agents/spec.md'];
  const out = namedSpecs('- Specs: data-readiness R2, R5, R24 (`runId`); data-model 3.15.\nagents are great', paths);
  assert.deepEqual(out, [
    { path: 'specs/capabilities/data-readiness/spec.md', rules: ['R2', 'R5', 'R24'] },
    { path: 'specs/system/data-model.md', rules: [] },
  ]);
});

test('storyEntry returns the entry up to the next heading', () => {
  const rm = '#### 1.2.3 — T  `✅ Done`\n- a\n\n#### 1.2.4 — U\n- b';
  assert.equal(storyEntry(rm, '1.2.3').text, '#### 1.2.3 — T  `✅ Done`\n- a');
  assert.equal(storyEntry(rm, '9.9.9'), null);
});

test('buildPack assembles the sections, finds archived stories and warns above the cap', () => {
  const files = {
    'roadmap.md': '#### 1.0.1 — Live\n- Per plan 1.9.1 and `backend/src/a.ts`.\n',
    'roadmap-archive.md': '#### 0.1.1 — Old\n- done\n',
    'docs/plans/p.md': '#### 1.9.1 — Plan\nplan body\n',
    'backend/src/a.ts': 'export class A {}\n',
    'lessons.md': '- backend jest rule\n- unrelated\n',
  };
  const read = (p) => files[p] ?? null;
  const pack = buildPack('1.0.1', { read, roadmaps: ['roadmap.md', 'roadmap-archive.md'], plans: ['docs/plans/p.md'] });
  assert.match(pack.text, /plan body/);
  assert.match(pack.text, /1: export class A/);
  assert.match(pack.text, /backend jest rule/);
  assert.doesNotMatch(pack.text, /unrelated/);
  assert.match(pack.text, /BRANCH: unit/);
  assert.deepEqual(pack.warnings, []);
  assert.ok(buildPack('0.1.1', { read, roadmaps: ['roadmap.md', 'roadmap-archive.md'] }));
  assert.equal(buildPack('7.7.7', { read, roadmaps: ['roadmap.md'] }), null);
  files['lessons.md'] = `- backend ${'x'.repeat(70000)}\n`;
  assert.equal(buildPack('1.0.1', { read, roadmaps: ['roadmap.md'], plans: ['docs/plans/p.md'] }).warnings.length, 1);
});
