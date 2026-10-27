#!/usr/bin/env node
// Lists the files of a folder that name a held-out eval case: its id (also
// with a set's prefix, such as rest-<id>) or its question, word for word.
// start-fixer.sh deletes them from the fixer's tree, beyond the fixed list
// of held-out paths. No dependencies (Node 22 or later).
//
// Usage: node .claude/tools/eval-loop/held-out-scan.mjs <sets dir> <folder>
// Prints one path per line, relative to <folder>; exit 2 on a bad argument.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [setsDir, folder] = process.argv.slice(2);
if (!setsDir || !folder) {
  console.error('usage: held-out-scan.mjs <sets dir> <folder>');
  process.exit(2);
}

const ids = [];
const questions = [];
for (const file of readdirSync(setsDir).filter((f) => f.endsWith('.json'))) {
  const { cases = [] } = JSON.parse(readFileSync(join(setsDir, file), 'utf8'));
  for (const c of cases) {
    if (c.split !== 'held-out') continue;
    if (typeof c.id === 'string' && c.id) ids.push(c.id);
    if (typeof c.question === 'string' && c.question.trim()) {
      questions.push(c.question.trim());
    }
  }
}
if (ids.length === 0) {
  console.error(`found no held-out case in ${setsDir}`);
  process.exit(2);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An id as a whole: after a prefix's hyphen is fine (rest-<id>), but not
// as the start of a longer id (<id>-reworded is another case).
const idPattern = new RegExp(
  `(?<![a-z0-9])(?:${ids.map(escape).join('|')})(?![a-z0-9-])`,
);

const SKIP = new Set(['.git', 'node_modules']);
const found = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) continue;
    const text = readFileSync(path, 'utf8');
    if (idPattern.test(text) || questions.some((q) => text.includes(q))) {
      found.push(relative(folder, path));
    }
  }
};
walk(folder);
for (const path of found.sort()) console.log(path);
