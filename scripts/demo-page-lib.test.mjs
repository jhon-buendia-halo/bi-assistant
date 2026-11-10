// node --test scripts/demo-page-lib.test.mjs (roadmap 0.4.5)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  UsageError,
  escapeHtml,
  extractStory,
  findMilestone,
  firstSentence,
  inlineMd,
  latestShipped,
  matchChangelog,
  mentionsStory,
  parseArgs,
  parseTestsMd,
  renderField,
  renderPage,
  shortTitle,
  statusChip,
} from './demo-page-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roadmap = fs.readFileSync(path.join(root, 'roadmap.md'), 'utf8');

const FIXTURE = `# Roadmap

## Phase 9

### Milestone 9.1 — Widgets & <Things> ([BA-999](https://example.atlassian.net/browse/BA-999))

#### 9.1.1 — Widget picker: choose "fancy" widgets (BA-1000)  \`🚧 In progress\`
- **Intent:** the user picks a widget with \`<Picker>\` & friends. A second sentence.
- **Scope:**
  - Top item with a [spec link](specs/x.md) and an [external one](https://example.com/a?b=1&c=2)
    - nested **bold** child
      1. first ordered
      2. second ordered
         continued line
  - Second top item
- **Out of scope:** the widget store.
- **Acceptance:** it opens; it closes; it says "done" & exits
- **Notes:** none.

#### 9.1.2 — Next story  \`📋 Planned\`
- **Intent:** not part of 9.1.1.

### Milestone 9.2 — Other
`;

test('parseArgs: one roadmap id, anything else is a usage error', () => {
  assert.equal(parseArgs(['1.21.6']), '1.21.6');
  assert.throws(() => parseArgs([]), UsageError);
  assert.throws(() => parseArgs(['1.21.6', 'x']), UsageError);
  assert.throws(() => parseArgs(['--fast']), UsageError);
  assert.throws(() => parseArgs(['abc']), UsageError);
});

test('extractStory: real roadmap story 0.4.5 with its nested Scope', () => {
  const s = extractStory(roadmap, '0.4.5');
  assert.ok(s);
  assert.equal(s.title, 'Deterministic QA: impacted tests, demo video, test-run evidence');
  assert.match(s.status, /In progress|Done/);
  for (const k of ['Intent', 'Scope', 'Out of scope', 'Acceptance', 'Notes']) assert.ok(s.fields[k], k);
  assert.match(s.fields.Intent.lead, /^checks, test selection/);
  const scope = s.fields.Scope.children;
  assert.match(scope[0].text, /scripts\/qa\.mjs <roadmap-id>/);
  assert.equal(scope[0].children.length, 2);
  const fast = scope.find((n) => n.text.startsWith('**`--fast`'));
  assert.ok(fast.children.some((c) => c.text.includes('demo.webm')));
  assert.ok(s.fields.Acceptance.children.length >= 4);
  // parsing stops at the next story
  assert.ok(!JSON.stringify(s.fields).includes('ship it <EPIC-ID>'));
  assert.equal(s.milestone.name, 'Harness Adjustments');
  assert.equal(s.milestone.key, 'BA-119');
  assert.equal(s.milestone.link, 'https://halo-powered.atlassian.net/browse/BA-119');
});

test('extractStory: fixture with nested, ordered and continued bullets', () => {
  const s = extractStory(FIXTURE, '9.1.1');
  assert.equal(s.title, 'Widget picker: choose "fancy" widgets (BA-1000)');
  assert.equal(s.status, '🚧 In progress');
  assert.equal(s.fields.Scope.lead, '');
  const [top, second] = s.fields.Scope.children;
  assert.equal(second.text, 'Second top item');
  assert.equal(top.children[0].text, 'nested **bold** child');
  const ordered = top.children[0].children;
  assert.deepEqual(ordered.map((n) => n.ordered), [true, true]);
  assert.equal(ordered[1].text, 'second ordered continued line');
  assert.equal(s.fields['Out of scope'].lead, 'the widget store.');
  assert.equal(s.fields.Notes.lead, 'none.');
  assert.equal(extractStory(FIXTURE, '9.1.2').fields.Intent.lead, 'not part of 9.1.1.');
  assert.equal(extractStory(FIXTURE, '9.9.9'), null);
});

test('findMilestone: milestone and epic above a story', () => {
  const s = extractStory(FIXTURE, '9.1.2');
  assert.deepEqual(s.milestone, {
    number: '9.1',
    name: 'Widgets & <Things>',
    key: 'BA-999',
    link: 'https://example.atlassian.net/browse/BA-999',
  });
  const lines = FIXTURE.split('\n');
  assert.equal(findMilestone(lines, lines.length - 1).name, 'Other');
  assert.equal(findMilestone(lines, lines.length - 1).key, null);
  assert.equal(findMilestone(['## Phase', '#### 1.1 — x'], 1), null);
});

test('shortTitle: 2–4 word name, no parenthetical or subtitle', () => {
  assert.equal(shortTitle('1.21.6', 'User personas section in the Context area'), '1.21.6 User personas');
  assert.equal(shortTitle('0.4.5', 'Deterministic QA: impacted tests, demo video'), '0.4.5 Deterministic QA');
  assert.equal(shortTitle('9.1.1', 'Widget picker: choose "fancy" widgets (BA-1000)'), '9.1.1 Widget picker');
  assert.equal(shortTitle('1.2.3', 'Login ([BA-7](https://x.y/BA-7))'), '1.2.3 Login');
  assert.equal(shortTitle('1.2.4', 'The context area on the rail'), '1.2.4 context area');
  const words = shortTitle('1.2.5', 'Data Readiness Agent drills into findings').split(' ');
  assert.ok(words.length >= 2 && words.length <= 4);
});

test('firstSentence and statusChip', () => {
  assert.equal(firstSentence('One thing. Two things.'), 'One thing.');
  assert.equal(firstSentence('No full stop'), 'No full stop');
  assert.deepEqual(statusChip('✅ Done'), { label: 'Done', tone: 'ok' });
  assert.deepEqual(statusChip('🚧 In progress'), { label: 'In progress', tone: 'warn' });
  assert.deepEqual(statusChip('📋 Planned'), { label: 'Planned', tone: 'neutral' });
});

const CHANGELOG = `# Changelog

## 2026-11-10

### Added
- **Personas** (roadmap 1.21.6, [spec](specs/p.md)).
  - Sub bullet one.
  - Evidence: [evidence/1.21.6/](evidence/1.21.6/).
- **Something else** (roadmap 1.21.60).
- **Ranges** (roadmap 1.21.7–1.21.9, ADR-0036).

### Fixed
- **A fix** (1.21.6): broke less.

## 2026-11-01

### Added
- **Older personas work** (1.21.6, x).
`;

test('mentionsStory / matchChangelog / latestShipped', () => {
  assert.ok(mentionsStory('roadmap 1.21.6 here', '1.21.6'));
  assert.ok(mentionsStory('fix (1.21.6)', '1.21.6'));
  assert.ok(mentionsStory('(1.21.6, x)', '1.21.6'));
  assert.ok(!mentionsStory('roadmap 1.21.60', '1.21.6'));
  assert.ok(!mentionsStory('roadmap 1.21.6.1', '1.21.6'));
  assert.ok(!mentionsStory('v11.21.6, x', '1.21.6'));
  assert.ok(mentionsStory('roadmap 1.21.7–1.21.9, ADR', '1.21.9'));

  const all = matchChangelog(CHANGELOG, '1.21.6');
  assert.deepEqual(all.map((e) => [e.date, e.section, e.lines.length]), [
    ['2026-11-10', 'Added', 3],
    ['2026-11-10', 'Fixed', 1],
    ['2026-11-01', 'Added', 1],
  ]);
  assert.equal(latestShipped(all).length, 2);
  assert.equal(latestShipped(all, 1)[0].section, 'Added');
  assert.deepEqual(matchChangelog(CHANGELOG, '7.7.7'), []);
  assert.deepEqual(latestShipped([]), []);
});

const TESTS_MD = `# Tests — 1.21.6

Written by \`node scripts/qa.mjs 1.21.6 --gate\` on 2026-11-10, epic base \`abc123\`. **Result: failed.**

| Step | Command | Result | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Unit (frontend) | \`npx jest --findRelatedTests a.ts\` | passed | 12 | 0 | 1 |
| Playwright | \`npx playwright test a.spec.ts \\| tee x\` | failed | 8 | 1 | 0 |
| Build | \`npm run build\` | passed | — | — | — |

## Playwright specs (step 6)

| Spec | Listed in step 6 | Ran |
|---|---|---|
| \`a.spec.ts\` | yes | yes |
`;

test('parseTestsMd: result line and step table', () => {
  const t = parseTestsMd(TESTS_MD);
  assert.equal(t.result, 'failed');
  assert.equal(t.steps.length, 3);
  assert.deepEqual(t.steps[0], {
    step: 'Unit (frontend)',
    command: 'npx jest --findRelatedTests a.ts',
    result: 'passed',
    passed: '12',
    failed: '0',
    skipped: '1',
  });
  assert.equal(t.steps[1].command, 'npx playwright test a.spec.ts | tee x');
  assert.equal(t.steps[2].passed, '—');
  assert.equal(parseTestsMd('**Result: passed.**').result, 'passed');
  assert.deepEqual(parseTestsMd('nothing'), { result: null, steps: [] });
});

test('escapeHtml and inlineMd: code, bold, http links only, everything escaped', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(inlineMd('use `a<b> & "c"` now'), 'use <code>a&lt;b&gt; &amp; &quot;c&quot;</code> now');
  assert.equal(inlineMd('**bold & <b>**'), '<strong>bold &amp; &lt;b&gt;</strong>');
  assert.equal(
    inlineMd('[ext](https://e.com/?a=1&b="2")'),
    '<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">ext</a>',
  );
  assert.equal(inlineMd('[spec](specs/x.md)'), 'spec');
  assert.equal(inlineMd('[x](javascript:alert(1))'), 'x)');
  assert.equal(inlineMd('[`code` text](specs/y.md)'), '<code>code</code> text');
  assert.equal(inlineMd('**[BA-1](https://a.b/BA-1)**'), '<strong><a href="https://a.b/BA-1">BA-1</a></strong>');
  assert.equal(inlineMd('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
  assert.equal(inlineMd('lone ` tick and ** stars'), 'lone ` tick and ** stars');
  assert.equal(inlineMd('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('renderField: nested list, or a paragraph split into items', () => {
  const s = extractStory(FIXTURE, '9.1.1');
  const scope = renderField(s.fields.Scope);
  assert.match(scope, /^<ul><li>Top item with a spec link and an <a href="https:\/\/example\.com\/a\?b=1&amp;c=2">external one<\/a><ul><li>nested <strong>bold<\/strong> child<ol><li>first ordered<\/li>/);
  assert.equal(
    renderField(s.fields.Acceptance),
    '<ul><li>it opens</li><li>it closes</li><li>it says &quot;done&quot; &amp; exits</li></ul>',
  );
  assert.equal(renderField({ lead: 'One. Two.', children: [] }), '<ul><li>One.</li><li>Two.</li></ul>');
  assert.equal(renderField({ lead: 'Only one', children: [] }), '<p>Only one</p>');
  assert.equal(renderField(undefined), '');
});

const base = {
  story: extractStory(FIXTURE, '9.1.1'),
  git: { branch: 'feat/x', commit: 'abc1234' },
  generated: '2026-11-10',
};

test('renderPage: artifact contract and a video demo', () => {
  const html = renderPage({
    ...base,
    demo: { kind: 'video' },
    shipped: latestShipped(matchChangelog(CHANGELOG, '1.21.6')),
    tests: parseTestsMd(TESTS_MD),
  });
  assert.ok(html.startsWith('<title>9.1.1 Widget picker</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>'));
  assert.doesNotMatch(html, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
  assert.match(html, /<video src="demo\.webm" controls playsinline muted preload="metadata"/);
  assert.doesNotMatch(html, /<pre/);
  assert.match(html, /Recorded by <code>scripts\/qa\.mjs 9\.1\.1 --fast<\/code> with <code>DEMO=1<\/code>; captions are the scenario's Gherkin lines\./);
  assert.match(html, /<a href="https:\/\/example\.atlassian\.net\/browse\/BA-999">Widgets &amp; &lt;Things&gt;<\/a> · roadmap 9\.1\.1/);
  assert.match(html, /<h1>Widget picker: choose &quot;fancy&quot; widgets \(BA-1000\)<\/h1>/);
  assert.match(html, /<p class="intent">the user picks a widget with <code>&lt;Picker&gt;<\/code> &amp; friends\.<\/p>/);
  assert.match(html, /<span class="chip warn">In progress<\/span>/);
  assert.match(html, /What shipped/);
  assert.match(html, /<strong>Personas<\/strong>/);
  assert.match(html, /<strong>A fix<\/strong>/);
  assert.doesNotMatch(html, /Older personas work/);
  assert.match(html, /<span class="chip bad">Failed<\/span>/);
  assert.match(html, /<code>npx playwright test a\.spec\.ts \| tee x<\/code>/);
  assert.match(html, /branch <code>feat\/x<\/code> · commit <code>abc1234<\/code> · generated 2026-11-10/);
  assert.match(html, /Generated by scripts\/demo-page\.mjs from roadmap\.md, changelog\.md and evidence\/9\.1\.1\//);
  // order: demo before What shipped before Scope before Acceptance before Gate results
  const at = (s) => html.indexOf(s);
  assert.ok(at('<video') < at('What shipped'));
  assert.ok(at('What shipped') < at('id="h-scope"'));
  assert.ok(at('id="h-scope"') < at('id="h-acceptance"'));
  assert.ok(at('id="h-acceptance"') < at('id="h-gate"'));
  // tokens: dark mode twice, body background, side gutter
  assert.match(html, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{[^}]*color-scheme: dark;/);
  assert.match(html, /:root\[data-theme="dark"\] \{[^}]*color-scheme: dark;/);
  assert.match(html, /body \{[^}]*background: var\(--bg\);[^}]*color: var\(--fg\);/);
  assert.match(html, /padding-left: max\(16px, env\(safe-area-inset-left, 0px\)\);/);
  // no literal colors outside the token blocks
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rules = css.replace(/:root[^{]*\{[^}]*\}/g, '');
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  assert.doesNotMatch(html, /<script|<link|@import|https:\/\/fonts/);
});

test('renderPage: text demo in a <pre> and gate not run yet', () => {
  const html = renderPage({ ...base, demo: { kind: 'text', text: 'Demo — 9.1.1\n$ run <x> & "y"\n' } });
  assert.match(html, /<pre[^>]*>Demo — 9\.1\.1\n\$ run &lt;x&gt; &amp; &quot;y&quot;<\/pre>/);
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /Gate results: not run yet/);
  assert.doesNotMatch(html, /What shipped/);
});
