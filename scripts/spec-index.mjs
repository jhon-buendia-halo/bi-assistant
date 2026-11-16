#!/usr/bin/env node
// node scripts/spec-index.mjs [--check]   (roadmap 1.23.29, delivery.md 13)
// Writes specs/INDEX.md: every heading (levels 2-4) and rule id of every
// specs/**/*.md, roadmap.md and roadmap-archive.md with its line range.
// --check writes nothing and exits 1 when the committed index is stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_PATH, indexIsStale, renderIndex } from './spec-index-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

export function collectFiles() {
  const rels = walk(path.join(root, 'specs')).map((p) => path.relative(root, p).split(path.sep).join('/'));
  for (const extra of ['roadmap.md', 'roadmap-archive.md', 'roadmap-backlog.md']) if (fs.existsSync(path.join(root, extra))) rels.push(extra);
  return rels
    .filter((r) => r !== INDEX_PATH)
    .map((r) => ({ path: r, text: fs.readFileSync(path.join(root, r), 'utf8') }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fresh = renderIndex(collectFiles());
  const target = path.join(root, INDEX_PATH);
  if (process.argv.includes('--check')) {
    const committed = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (indexIsStale(committed, fresh)) {
      console.error(`${INDEX_PATH} is stale: run node scripts/spec-index.mjs`);
      process.exit(1);
    }
    console.log(`${INDEX_PATH} is up to date`);
  } else {
    fs.writeFileSync(target, fresh);
    console.log(`Wrote ${INDEX_PATH} (${fresh.split('\n').length} lines, ${Buffer.byteLength(fresh)} bytes)`);
  }
}
