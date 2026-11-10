#!/usr/bin/env node
// node scripts/demo-page.mjs <roadmap-id>   (roadmap 0.4.5)
//
// Writes evidence/<roadmap-id>/demo-page.html: a shareable page with the
// story's demo (demo.webm, or the demo.txt transcript) and what was done, read
// from roadmap.md, changelog.md and evidence/<roadmap-id>/tests.md. A Claude
// session publishes it with its Artifact tool: the HTML as the page and
// demo.webm as a supporting file next to it. Deterministic: no LLM, no network.
//
// Exit codes: 0 written, 1 no demo (or story not in the roadmap), 2 bad usage.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UsageError,
  extractStory,
  latestShipped,
  matchChangelog,
  parseArgs,
  parseTestsMd,
  renderPage,
} from './demo-page-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

let id;
try {
  id = parseArgs(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

const story = extractStory(read(path.join(root, 'roadmap.md')) ?? '', id);
if (!story) {
  console.error(`demo-page: roadmap.md has no story ${id}`);
  process.exit(1);
}

const evidenceDir = path.join(root, 'evidence', id);
const video = path.join(evidenceDir, 'demo.webm');
const transcript = read(path.join(evidenceDir, 'demo.txt'));
let demo;
if (fs.existsSync(video)) demo = { kind: 'video' };
else if (transcript !== null) demo = { kind: 'text', text: transcript };
else {
  console.error(`demo-page: ${rel(evidenceDir)}/ has no demo.webm or demo.txt; run node scripts/qa.mjs ${id} --fast first`);
  process.exit(1);
}

const changelog = read(path.join(root, 'changelog.md'));
const testsMd = read(path.join(evidenceDir, 'tests.md'));
const html = renderPage({
  story,
  demo,
  shipped: changelog ? latestShipped(matchChangelog(changelog, id)) : [],
  tests: testsMd ? parseTestsMd(testsMd) : null,
  git: { branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), commit: git(['rev-parse', '--short', 'HEAD']) },
  generated: new Date().toISOString().slice(0, 10),
});

const out = path.join(evidenceDir, 'demo-page.html');
fs.writeFileSync(out, html);
console.log(rel(out));
console.log(`page: ${rel(out)}`);
console.log(`files: ${demo.kind === 'video' ? `demo.webm -> ${rel(video)}` : 'none'}`);
