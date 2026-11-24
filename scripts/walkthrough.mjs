#!/usr/bin/env node
// node scripts/walkthrough.mjs --spec <frontend/e2e/x.spec.ts> --grep <test title>
//   --title <title> --summary <summary.md> --out <.context/artifacts/<dir>>
//   [--narration <narration.json>] [--lang es] [--keep-video]
//
// Records one Playwright scenario as a walkthrough video (skill
// walkthrough-video): runs it on the web target with DEMO=1 (slowMo, 1280×720
// video), writes each scenarioStep as a subtitle cue (its text from the
// narration file when it names the step, else the step's Gherkin line),
// re-encodes the video with Playwright's own ffmpeg until it fits a Conductor
// artifact, and writes <out>/index.html: the summary, the video with synced
// subtitles and a transcript. The session then publishes <out> with
// PublishArtifact. The video and a .vtt are kept under .qa-reports/walkthrough/.
//
// Needs a current build (`npm --prefix frontend run test:e2e:prepare`).
// Exit codes: 0 written, 1 failed (test, no cues, too large), 2 bad usage.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_MAX_BYTES,
  ENCODES,
  UsageError,
  VIDEO_BUDGET_BYTES,
  cuesToVtt,
  parseArgs,
  parseCues,
  renderPage,
} from './walkthrough-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');

function fail(message) {
  console.error(`walkthrough: ${message}`);
  process.exit(1);
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

const abs = (p) => path.resolve(root, p);
const summaryPath = abs(opts.summary);
if (!fs.existsSync(summaryPath)) fail(`no summary at ${opts.summary}`);
const narrationPath = opts.narration ? abs(opts.narration) : undefined;
if (narrationPath) JSON.parse(fs.readFileSync(narrationPath, 'utf8')); // fail early on bad JSON
if (!fs.existsSync(path.join(root, 'backend', 'dist', 'cli.js'))) {
  fail('no backend build: run `npm --prefix frontend run test:e2e:prepare` first');
}

const brandFile = path.join(root, '.context', 'brand');
const brand = process.env.BRAND || (fs.existsSync(brandFile) ? fs.readFileSync(brandFile, 'utf8').trim() : 'halo');
const work = path.join(root, '.qa-reports', 'walkthrough', path.basename(abs(opts.out)));
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'video'), { recursive: true });
const cuesFile = path.join(work, 'cues.jsonl');

/** The World Cup Postgres already listens: the suite must not start it again (lessons.md). */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => (socket.destroy(), resolve(false)));
  });
}

const env = {
  ...process.env,
  BRAND: brand,
  DEMO: '1',
  DEMO_VIDEO_DIR: path.join(work, 'video'),
  WALKTHROUGH_CUES: cuesFile,
  ...(narrationPath ? { WALKTHROUGH_NARRATION: narrationPath } : {}),
  ...((await portOpen(55432)) ? { E2E_SKIP_DOCKER: '1' } : {}),
};
const spec = path.relative(frontend, abs(opts.spec));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
console.log(`walkthrough: recording "${opts.grep}" in ${spec} (BRAND=${brand})`);
const run = spawnSync(
  npx,
  ['playwright', 'test', '--project=web', '--workers=1', '--retries=0', spec, '-g', opts.grep],
  { cwd: frontend, env, encoding: 'utf8', shell: process.platform === 'win32' },
);
fs.writeFileSync(path.join(work, 'playwright.log'), `${run.stdout ?? ''}\n${run.stderr ?? ''}`);
if (run.status !== 0) fail(`the scenario failed (exit ${run.status}); see ${path.relative(root, work)}/playwright.log`);

const videos = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.webm')) videos.push({ p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size });
  }
})(path.join(work, 'video'));
if (videos.length === 0) fail('the scenario recorded no video (does it use the `page` or `launchApp` fixture?)');
// The scenario's own page is the longest recording (another app's page may be open too).
const source = videos.sort((a, b) => b.size - a.size)[0].p;

if (!fs.existsSync(cuesFile)) fail('no subtitles: the scenario calls no scenarioStep (frontend/e2e/support/demo-captions.ts)');
const cues = parseCues(fs.readFileSync(cuesFile, 'utf8'));
if (cues.length === 0) fail('no subtitles: the scenario calls no scenarioStep');

/** Playwright's own ffmpeg (it records the videos), so nothing extra is installed. */
function findFfmpeg() {
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
  ].filter(Boolean);
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base).filter((d) => d.startsWith('ffmpeg')).sort().reverse()) {
      for (const name of ['ffmpeg-mac', 'ffmpeg-linux', 'ffmpeg-win64.exe', 'ffmpeg']) {
        const p = path.join(base, dir, name);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' }).split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

let video = source;
if (fs.statSync(source).size > VIDEO_BUDGET_BYTES) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) fail('the video is too large and no ffmpeg was found (npx playwright install ffmpeg)');
  video = null;
  for (const { width, bitrate } of ENCODES) {
    const out = path.join(work, `walkthrough-${width}.webm`);
    const enc = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', source, '-vf', `scale=${width}:-2`, '-c:v', 'libvpx', '-b:v', bitrate, '-crf', '32', '-an', out], { encoding: 'utf8' });
    if (enc.status !== 0) fail(`ffmpeg failed: ${enc.stderr}`);
    const size = fs.statSync(out).size;
    console.log(`walkthrough: ${width}px at ${bitrate}: ${(size / 1e6).toFixed(2)} MB`);
    if (size <= VIDEO_BUDGET_BYTES) {
      video = out;
      break;
    }
  }
  if (!video) fail('the video does not fit a Conductor artifact even at 640 px: shorten the scenario');
}
fs.copyFileSync(video, path.join(work, 'walkthrough.webm'));
fs.writeFileSync(path.join(work, 'walkthrough.vtt'), cuesToVtt(cues));

const html = renderPage({
  title: opts.title,
  summaryMarkdown: fs.readFileSync(summaryPath, 'utf8'),
  videoBase64: fs.readFileSync(video).toString('base64'),
  cues,
  lang: opts.lang,
});
if (Buffer.byteLength(html) > ARTIFACT_MAX_BYTES) fail(`the page is ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB, over the artifact's 2 MB`);
const outDir = abs(opts.out);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
if (!opts.keepVideo) fs.rmSync(path.join(work, 'video'), { recursive: true, force: true });
const last = cues[cues.length - 1];
console.log(`walkthrough: wrote ${path.relative(root, outDir)}/index.html (${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB, ${cues.length} subtitles, ${Math.round(last.end)} s)`);
console.log(`walkthrough: video and subtitles kept in ${path.relative(root, work)}/walkthrough.{webm,vtt}`);
