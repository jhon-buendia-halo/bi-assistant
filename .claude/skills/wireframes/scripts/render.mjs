#!/usr/bin/env node
// Renders wireframe pages to 1440 x 960 PNGs with Playwright (the frontend's install).
// Usage: node .claude/skills/wireframes/scripts/render.mjs [--out DIR] [--theme dark] [--no-notes] [page.html ...]
// With no pages it renders every page under design/wireframes/ except index.html.
// Default output: design/wireframes/_renders/ (git-ignored). Prints any missing-icon or console error.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const wf = path.join(repo, 'design/wireframes');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (k) => { const i = args.indexOf(k); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const out = path.resolve(opt('--out') || path.join(wf, '_renders'));
const theme = opt('--theme');
const noNotes = flag('--no-notes');

let pages = args.map((a) => path.resolve(a));
if (!pages.length) {
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('_')) walk(p);
      else if (e.name.endsWith('.html') && p !== path.join(wf, 'index.html')) pages.push(p);
    }
  })(wf);
}

const fromFrontend = createRequire(path.join(repo, 'frontend/package.json'));
let chromium;
try { ({ chromium } = fromFrontend('playwright')); } catch {
  console.error('Playwright not found: run "npm ci" in frontend/.');
  process.exit(1);
}
const exe = process.env.WF_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
fs.mkdirSync(out, { recursive: true });
let problems = 0;
for (const file of pages.sort()) {
  const errors = [];
  page.removeAllListeners('console');
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const q = new URLSearchParams();
  if (theme) q.set('theme', theme);
  if (noNotes) q.set('notes', '0');
  await page.goto(pathToFileURL(file).href + (q.size ? `?${q}` : ''));
  await page.waitForSelector('.wf-screen');
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.$$eval('span[title^="missing icon"]', (els) => els.map((e) => e.title));
  const rel = path.relative(wf, file).replace(/\.html$/, '').replace(/[\\/]/g, '__');
  const png = path.join(out, `${rel}${theme ? `.${theme}` : ''}.png`);
  await page.locator('.wf-screen').screenshot({ path: png });
  const bad = [...missing, ...errors];
  if (bad.length) problems++;
  console.log(`${bad.length ? 'WARN' : 'ok  '} ${path.relative(repo, png)}${bad.length ? `  ${bad.join('; ')}` : ''}`);
}
await browser.close();
process.exitCode = problems ? 1 : 0;
