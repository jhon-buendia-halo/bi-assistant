#!/usr/bin/env node
// node scripts/story-pack.mjs <roadmap-id> [--out <file>]   (roadmap 1.23.29, delivery.md 13)
// Writes .context/story-packs/<id>.md: the builder's single starting brief.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack } from './story-pack-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const id = args.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
if (!id || !/^\d+(\.\d+)+[a-z]?$/.test(id) || (outIdx >= 0 && !args[outIdx + 1])) {
  console.error('Usage: node scripts/story-pack.mjs <roadmap-id> [--out <file>]');
  process.exit(2);
}
const out = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(root, '.context', 'story-packs', `${id}.md`);

const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);
const specFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`);
    else if (e.name.endsWith('.md')) specFiles.push(`${dir}/${e.name}`);
  }
};
walk('specs');
const pack = buildPack(id, {
  read,
  roadmaps: ['roadmap.md', 'roadmap-archive.md', 'roadmap-backlog.md'],
  specs: specFiles,
  plans: fs
    .readdirSync(path.join(root, 'docs', 'plans'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => `docs/plans/${e.name}`)
    .sort(),
});
if (!pack) {
  console.error(`story-pack: no story ${id} in the roadmap`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, pack.text);
console.log(`Wrote ${path.relative(root, out)} (${pack.bytes} bytes)`);
for (const w of pack.warnings) console.warn(`warning: ${w}`);
