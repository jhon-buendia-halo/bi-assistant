// Pure helpers of scripts/walkthrough.mjs: no I/O, so node --test covers them.
//
// A walkthrough is a Playwright scenario recorded with DEMO=1 whose steps
// (scenarioStep) are written as subtitle cues, published as one Conductor
// artifact: the video (a data: URL), subtitles drawn over it in sync, and a
// transcript under it. Conductor artifacts are one HTML file of at most 2 MB.

export class UsageError extends Error {}

export const USAGE = `usage: node scripts/walkthrough.mjs --spec <frontend/e2e/x.spec.ts> --grep <test title>
         --title <title> --summary <summary.md> --out <.context/artifacts/<dir>>
         [--narration <narration.json>] [--lang <es|en|…>] [--keep-video]`;

/** The artifact page's limit is 2 MB; the video's share of it, before base64. */
export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export const VIDEO_BUDGET_BYTES = 1_400_000;

/** Re-encodes tried in order until the video fits the budget. */
export const ENCODES = [
  { width: 1280, bitrate: '600k' },
  { width: 960, bitrate: '350k' },
  { width: 800, bitrate: '220k' },
  { width: 640, bitrate: '140k' },
];

export function parseArgs(argv) {
  const opts = { lang: 'es', keepVideo: false };
  const names = { '--spec': 'spec', '--grep': 'grep', '--title': 'title', '--summary': 'summary', '--out': 'out', '--narration': 'narration', '--lang': 'lang' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep-video') {
      opts.keepVideo = true;
      continue;
    }
    const name = names[arg];
    if (!name) throw new UsageError(`walkthrough: unknown argument ${arg}\n${USAGE}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`walkthrough: ${arg} needs a value\n${USAGE}`);
    opts[name] = value;
  }
  for (const required of ['spec', 'grep', 'title', 'summary', 'out']) {
    if (!opts[required]) throw new UsageError(`walkthrough: --${required} is required\n${USAGE}`);
  }
  return opts;
}

/** Cues from the JSON lines scenarioStep wrote: sorted, each ending before the next starts. */
export function parseCues(jsonLines) {
  const cues = jsonLines
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
    .filter((cue) => typeof cue.text === 'string' && Number.isFinite(cue.start) && Number.isFinite(cue.end))
    .sort((a, b) => a.start - b.start);
  return cues.map((cue, i) => {
    const next = cues[i + 1];
    const end = next ? Math.min(cue.end, next.start) : cue.end;
    return { start: round(cue.start), end: round(Math.max(end, cue.start + 0.5)), text: cue.text };
  });
}

function round(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

/** `mm:ss.mmm` for WebVTT, `m:ss` for the transcript. */
export function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(rest, 3)}`;
}

export function clockTime(seconds) {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function cuesToVtt(cues) {
  const blocks = cues.map((cue, i) => `${i + 1}\n${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}`);
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** The summary's Markdown, the little of it a summary needs: headings, bullets, paragraphs, `code`, **bold**. */
export function renderSummary(markdown) {
  const inline = (text) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const html = [];
  let list = false;
  let para = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*] (.*)$/.exec(line);
    const heading = /^#{1,6} (.*)$/.exec(line);
    if (!bullet && list) {
      html.push('</ul>');
      list = false;
    }
    if (bullet) {
      flush();
      if (!list) html.push('<ul>');
      list = true;
      html.push(`<li>${inline(bullet[1])}</li>`);
    } else if (heading) {
      flush();
      html.push(`<h2>${inline(heading[1])}</h2>`);
    } else if (line === '') {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  if (list) html.push('</ul>');
  return html.join('\n');
}

/** The artifact page: title, summary, the video with synced subtitles (CC toggle), the transcript. */
export function renderPage({ title, summaryMarkdown, videoBase64, cues, lang }) {
  const cueJson = JSON.stringify(cues).replace(/</g, '\\u003c');
  const transcript = cues
    .map((cue, i) => `<li><button type="button" data-cue="${i}"><span class="t">${clockTime(cue.start)}</span> ${escapeHtml(cue.text)}</button></li>`)
    .join('\n');
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 24px; font: 14px/1.5 var(--font-sans, system-ui, sans-serif); color: var(--color-fg, #111); background: var(--color-bg, #fff); }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 15px; margin: 16px 0 4px; }
  .summary { margin-bottom: 16px; }
  .player { position: relative; background: #000; border-radius: 10px; overflow: hidden; }
  video { display: block; width: 100%; }
  .sub { position: absolute; left: 50%; bottom: 56px; transform: translateX(-50%); max-width: 86%; padding: 8px 16px; border-radius: 8px; background: rgba(0,0,0,.8); color: #fff; font-size: 20px; line-height: 1.35; text-align: center; pointer-events: none; }
  .sub:empty, .sub[hidden] { display: none; }
  .bar { display: flex; gap: 8px; align-items: center; margin: 8px 0 16px; }
  .bar button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--color-border, #ccc); background: transparent; color: inherit; cursor: pointer; }
  .bar button[aria-pressed="true"] { font-weight: 600; }
  ol { list-style: none; padding: 0; margin: 0; }
  ol button { all: unset; display: block; width: 100%; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
  ol button.now { background: var(--color-bg-subtle, #eef); font-weight: 600; }
  .t { font-variant-numeric: tabular-nums; opacity: .7; margin-right: 6px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <section class="summary">${renderSummary(summaryMarkdown)}</section>
  <div class="player">
    <video id="v" controls playsinline preload="auto" src="data:video/webm;base64,${videoBase64}"></video>
    <div class="sub" id="sub" aria-live="polite"></div>
  </div>
  <div class="bar"><button type="button" id="cc" aria-pressed="true">CC</button><span>${cues.length} subtitles</span></div>
  <h2>Transcript</h2>
  <ol id="list">
${transcript}
  </ol>
</main>
<script>
  const cues = ${cueJson};
  const video = document.getElementById('v');
  const sub = document.getElementById('sub');
  const cc = document.getElementById('cc');
  const items = [...document.querySelectorAll('#list button')];
  let shown = -1;
  function sync() {
    const t = video.currentTime;
    const i = cues.findIndex((c) => t >= c.start && t < c.end);
    if (i === shown) return;
    shown = i;
    sub.textContent = i >= 0 ? cues[i].text : '';
    items.forEach((el, n) => el.classList.toggle('now', n === i));
  }
  video.addEventListener('timeupdate', sync);
  video.addEventListener('seeked', sync);
  cc.addEventListener('click', () => {
    const on = cc.getAttribute('aria-pressed') !== 'true';
    cc.setAttribute('aria-pressed', String(on));
    sub.hidden = !on;
  });
  items.forEach((el) => el.addEventListener('click', () => {
    video.currentTime = cues[Number(el.dataset.cue)].start + 0.01;
    video.play();
  }));
</script>
</body>
</html>
`;
}
