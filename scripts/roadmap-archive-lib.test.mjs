// node --test scripts/roadmap-archive-lib.test.mjs (roadmap 1.23.30, delivery.md 13)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHIVED_MARK, BACKLOG_FILE, archiveRoadmap, isArchivable, joinRoadmaps, milestoneSections } from './roadmap-archive-lib.mjs';
import { storyEntry } from './spec-index-lib.mjs';

const ROADMAP = [
  '# Roadmap',
  '',
  '## Release 1',
  '',
  '### Milestone 1.1 — Done one ([BA-9](https://x/BA-9))',
  '',
  'Intro.',
  '',
  '#### 1.1.1 — A  `✅ Done`',
  '- x',
  '',
  '#### 1.1.2 — B  `🚫 Cut`',
  '- y',
  '',
  '### Milestone 1.2 — Open one (M1-2)',
  '',
  '#### 1.2.1 — C  `✅ Done`',
  '#### 1.2.2 — D  `📋 Planned`',
  '',
  '### Milestone 1.23 — Active (M1-23)',
  '',
  '#### 1.23.1 — E  `✅ Done`',
  '',
  '## Backlog',
  'later',
].join('\n');

test('sections run to the next milestone or release heading', () => {
  const sections = milestoneSections(ROADMAP.split('\n'));
  assert.deepEqual(sections.map((s) => s.number), ['1.1', '1.2', '1.23']);
  assert.equal(sections[2].end, ROADMAP.split('\n').indexOf('## Backlog'));
});

test('only a finished milestone that is not 1.23 is archivable', () => {
  const lines = ROADMAP.split('\n');
  const [a, b, c] = milestoneSections(lines);
  assert.equal(isArchivable(a, lines.slice(a.start, a.end)), true);
  assert.equal(isArchivable(b, lines.slice(b.start, b.end)), false);
  assert.equal(isArchivable(c, lines.slice(c.start, c.end)), false);
});

test('archiving moves the lines verbatim and leaves a skeleton heading', () => {
  const { roadmap, archive, moved } = archiveRoadmap(ROADMAP);
  assert.deepEqual(moved, ['1.1']);
  assert.match(roadmap, /### Milestone 1\.1 — Done one \(\[BA-9\]\(https:\/\/x\/BA-9\)\)/);
  assert.ok(roadmap.includes(ARCHIVED_MARK));
  assert.ok(!roadmap.includes('#### 1.1.1'));
  assert.ok(archive.includes('#### 1.1.1 — A  `✅ Done`\n- x\n\n#### 1.1.2 — B  `🚫 Cut`\n- y'));
  // Nothing lost: every line of the original is in the new roadmap or the archive.
  const kept = new Set([...roadmap.split('\n'), ...archive.split('\n')]);
  for (const line of ROADMAP.split('\n')) assert.ok(kept.has(line), line);
});

test('archiving twice changes nothing and an archived story is found', () => {
  const first = archiveRoadmap(ROADMAP);
  const second = archiveRoadmap(first.roadmap, first.archive);
  assert.deepEqual(second.moved, []);
  assert.equal(second.roadmap, first.roadmap);
  assert.ok(storyEntry(joinRoadmaps(first.roadmap, first.archive), '1.1.2'));
  assert.equal(storyEntry(first.roadmap, '1.1.2'), null);
});

test('a milestone left with only backlog placeholders is archivable; a feature-less planned one is not', () => {
  const text = [
    '## Release 1',
    '',
    '### Milestone 1.5 — Moved out (M1-5)',
    '',
    '- 1.5.1 Databricks — moved to Backlog (2026-11-12).',
    '',
    '### Milestone 2.1 — Future (M2-1)',
    '',
    'Planned work, no features yet.',
    '',
    '## Backlog',
    '',
  ].join('\n');
  const r = archiveRoadmap(text);
  assert.deepEqual(r.moved, ['1.5']);
  assert.ok(r.archive.includes('- 1.5.1 Databricks — moved to Backlog'));
  assert.ok(r.roadmap.includes(`### Milestone 1.5 — Moved out (M1-5)${ARCHIVED_MARK}`));
  assert.ok(r.roadmap.includes('Planned work, no features yet.'));
});

test('a story moved to the backlog is found in the joined roadmaps, not in roadmap.md', () => {
  const roadmap = '### Milestone 1.5 — X (M1-5)\n\n- 1.5.1 Databricks — moved to Backlog (2026-11-12).\n';
  const backlog = '## Backlog\n\n### Moved from Milestone 1.5 — X (2026-11-12)\n\n#### 1.5.1 — Databricks  `📋 Planned`\n- **Intent:** connect.\n';
  assert.equal(storyEntry(roadmap, '1.5.1'), null);
  assert.ok(storyEntry(joinRoadmaps(roadmap, '', backlog), '1.5.1'));
  assert.equal(BACKLOG_FILE, 'roadmap-backlog.md');
});
