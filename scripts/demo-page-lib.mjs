// Pure logic for scripts/demo-page.mjs (roadmap 0.4.5): reads a story's
// roadmap entry, changelog bullets and tests.md, and renders the shareable
// demo page (a Claude artifact page: the demo video plus what was done).
// No file or process access here, so `node --test` covers all of it.

export class UsageError extends Error {}

export const USAGE = 'Usage: node scripts/demo-page.mjs <roadmap-id>';

/** `<roadmap-id>` → id. Throws UsageError on anything else. */
export function parseArgs(argv) {
  if (argv.length !== 1 || argv[0].startsWith('-') || !/^\d+(\.\d+)+$/.test(argv[0])) {
    throw new UsageError(USAGE);
  }
  return argv[0];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML-escape text (safe in element content and double- or single-quoted attributes). */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/y;
const CODE = /(`+)([\s\S]*?[^`])\1(?!`)/y;
const BOLD = /\*\*(.+?)\*\*/y;

/**
 * Inline Markdown → HTML: `code` → <code>, **bold** → <strong>, [text](url) →
 * <a> for http(s) URLs only (any other link keeps just its text). Everything
 * else is escaped.
 */
export function inlineMd(text) {
  const s = String(text);
  let out = '';
  let plain = '';
  const flush = () => {
    out += escapeHtml(plain);
    plain = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    let m;
    if (ch === '[') {
      LINK.lastIndex = i;
      if ((m = LINK.exec(s))) {
        flush();
        const inner = inlineMd(m[1]);
        out += /^https?:\/\//i.test(m[2])
          ? `<a href="${escapeHtml(m[2])}">${inner}</a>`
          : inner;
        i = LINK.lastIndex;
        continue;
      }
    } else if (ch === '`') {
      CODE.lastIndex = i;
      if ((m = CODE.exec(s))) {
        flush();
        out += `<code>${escapeHtml(m[2].trim() || m[2])}</code>`;
        i = CODE.lastIndex;
        continue;
      }
    } else if (ch === '*' && s[i + 1] === '*') {
      BOLD.lastIndex = i;
      if ((m = BOLD.exec(s))) {
        flush();
        out += `<strong>${inlineMd(m[1])}</strong>`;
        i = BOLD.lastIndex;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

/** Inline Markdown → plain text (for the <title> and similar). */
export function plainMd(text) {
  return String(text)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
}

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Indented Markdown list lines → a tree [{ text, ordered, children }].
 * Non-bullet lines continue the previous item's text.
 */
export function parseList(lines) {
  const root = { indent: -1, children: [] };
  const stack = [root];
  let last = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = BULLET.exec(raw);
    if (!m) {
      if (last) last.text += ` ${raw.trim()}`;
      continue;
    }
    const indent = m[1].replace(/\t/g, '    ').length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const node = {
      indent,
      text: m[2].trim(),
      ordered: /^\s*\d/.test(raw),
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
    last = node;
  }
  const strip = (nodes) =>
    nodes.map(({ text, ordered, children }) => ({ text, ordered, children: strip(children) }));
  return strip(root.children);
}

const STORY_HEADING = /^####\s+(\S+)\s+—\s+(.*?)\s*(?:`([^`]+)`)?\s*$/;
const MILESTONE_HEADING = /^###\s+Milestone\s+(\S+)\s+—\s+(.*?)\s*(?:\(\[([^\]]+)\]\(([^)\s]+)\)\))?\s*$/;

/** The `### Milestone X — Name ([KEY](link))` heading at or above line `index`. */
export function findMilestone(lines, index) {
  for (let i = index; i >= 0; i--) {
    if (/^##\s/.test(lines[i])) break;
    if (!/^###\s/.test(lines[i])) continue;
    const m = MILESTONE_HEADING.exec(lines[i]);
    if (m) return { number: m[1], name: m[2], key: m[3] ?? null, link: m[4] ?? null };
    return { number: null, name: lines[i].replace(/^###\s+/, '').trim(), key: null, link: null };
  }
  return null;
}

/**
 * A roadmap story: { id, title, status, milestone, fields } where `fields`
 * maps each `- **Key:** …` bullet (Intent, Scope, Out of scope, Acceptance,
 * Notes, …) to { lead, children } (lead = the text on the bullet's own line,
 * children = its nested list). Null when the story is not in the roadmap.
 */
export function extractStory(roadmap, id) {
  const lines = roadmap.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = STORY_HEADING.exec(l);
    return m && m[1] === id;
  });
  if (start < 0) return null;
  const h = STORY_HEADING.exec(lines[start]);
  let end = start + 1;
  while (end < lines.length && !/^(####?\s|---\s*$|##\s|#\s)/.test(lines[end])) end++;
  const body = lines.slice(start + 1, end);

  const fields = {};
  const order = [];
  let current = null;
  for (const line of body) {
    const top = /^[-*]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(line);
    if (top) {
      const key = top[1].replace(/:$/, '').trim();
      current = { lead: top[2].trim(), lines: [] };
      fields[key] = current;
      order.push(key);
      continue;
    }
    if (!current) continue;
    if (/^\s+\S/.test(line) && !BULLET.test(line) && current.lines.length === 0) {
      current.lead += ` ${line.trim()}`;
    } else {
      current.lines.push(line);
    }
  }
  for (const key of order) {
    fields[key] = { lead: fields[key].lead, children: parseList(fields[key].lines) };
  }
  return {
    id,
    title: h[2].trim(),
    status: h[3]?.trim() ?? '',
    milestone: findMilestone(lines, start),
    fields,
  };
}

const STOP_WORDS = new Set(['in', 'on', 'for', 'with', 'from', 'to', 'of', 'into', 'at', 'by', 'via', 'and', 'or', 'the', 'a', 'an']);
const GENERIC_TAIL = new Set(['section', 'page', 'screen', 'feature', 'story']);

/** `<id> <short name>`, 2–4 words: no parentheticals, nothing after a colon or dash. */
export function shortTitle(id, title) {
  let t = plainMd(title)
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s*[:—–]\s*|\s+-\s+/)[0]
    .trim();
  const words = t.split(/\s+/).filter(Boolean);
  while (words.length > 1 && ['a', 'an', 'the'].includes(words[0].toLowerCase())) words.shift();
  const cut = words.findIndex((w, i) => i > 0 && STOP_WORDS.has(w.toLowerCase()));
  let name = (cut > 0 ? words.slice(0, cut) : words).slice(0, 3);
  while (name.length > 1 && STOP_WORDS.has(name[name.length - 1].toLowerCase())) name.pop();
  if (name.length > 2 && GENERIC_TAIL.has(name[name.length - 1].toLowerCase())) name.pop();
  name = name.map((w) => w.replace(/[,.;]+$/, ''));
  return `${id} ${name.join(' ')}`.trim();
}

/** First sentence of a text. */
export function firstSentence(text) {
  const m = /^([\s\S]+?[.!?])(?=\s+[A-Z`*[]|\s*$)/.exec(String(text).trim());
  return (m ? m[1] : String(text)).trim();
}

/** Whether a changelog text mentions the story: `roadmap <id>`, `(<id>)` or `<id>,`. */
export function mentionsStory(text, id) {
  const e = escapeRe(id);
  const end = '(?![\\d]|\\.\\d)';
  return new RegExp(`roadmap\\s+${e}${end}|\\(${e}\\)|(?<![\\d.])${e},`).test(text);
}

/**
 * Changelog top-level bullets (each with its sub-bullet lines) that mention
 * the story, newest first: [{ date, section, lines }].
 */
export function matchChangelog(changelog, id) {
  const lines = changelog.split(/\r?\n/);
  const out = [];
  let date = null;
  let section = null;
  let cur = null;
  const close = () => {
    if (cur && mentionsStory(cur.lines.join('\n'), id)) out.push(cur);
    cur = null;
  };
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      close();
      date = line.replace(/^##\s+/, '').trim();
      section = null;
    } else if (/^###\s/.test(line)) {
      close();
      section = line.replace(/^###\s+/, '').trim();
    } else if (/^[-*]\s/.test(line)) {
      close();
      if (date) cur = { date, section, lines: [line] };
    } else if (cur && /^\s+\S/.test(line)) {
      cur.lines.push(line);
    } else if (cur && line.trim() === '') {
      // a blank line ends nothing by itself; the next heading or bullet does
    } else {
      close();
    }
  }
  close();
  return out;
}

/** The most recent matching bullets: those of the newest date that has any, at most `max`. */
export function latestShipped(entries, max = 3) {
  if (!entries.length) return [];
  return entries.filter((e) => e.date === entries[0].date).slice(0, max);
}

const splitRow = (row) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

/**
 * evidence/<id>/tests.md → { result: 'passed' | 'failed' | null, steps:
 * [{ step, command, result, passed, failed, skipped }] }.
 */
export function parseTestsMd(text) {
  const result = /\*\*Result:\s*(passed|failed)\.?\*\*/i.exec(text)?.[1]?.toLowerCase() ?? null;
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => /^\|\s*Step\s*\|\s*Command\s*\|/i.test(l));
  const steps = [];
  if (head >= 0) {
    for (let i = head + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const [step, command, res, passed, failed, skipped] = splitRow(lines[i]);
      steps.push({
        step,
        command: (command ?? '').replace(/^`+|`+$/g, ''),
        result: res ?? '',
        passed: passed ?? '—',
        failed: failed ?? '—',
        skipped: skipped ?? '—',
      });
    }
  }
  return { result, steps };
}

/** Status text → { label, tone: 'ok' | 'warn' | 'bad' | 'neutral' }. */
export function statusChip(status) {
  const label = String(status).replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Unknown';
  const l = label.toLowerCase();
  const tone = /done|shipped|passed/.test(l)
    ? 'ok'
    : /progress|review/.test(l)
      ? 'warn'
      : /block|fail|cancel|drop/.test(l)
        ? 'bad'
        : 'neutral';
  return { label, tone };
}

function renderNodes(nodes) {
  if (!nodes.length) return '';
  const tag = nodes[0].ordered ? 'ol' : 'ul';
  return `<${tag}>${nodes
    .map((n) => `<li>${inlineMd(n.text)}${renderNodes(n.children)}</li>`)
    .join('')}</${tag}>`;
}

/**
 * A roadmap field as a list. With nested bullets: the lead as a paragraph and
 * the bullets as a list. With only a paragraph: split into items on `; `, or
 * else on sentences.
 */
export function renderField(field) {
  if (!field) return '';
  if (field.children.length) {
    return `${field.lead ? `<p>${inlineMd(field.lead)}</p>` : ''}${renderNodes(field.children)}`;
  }
  if (!field.lead) return '';
  let parts = field.lead.split(/;\s+/);
  if (parts.length < 2) parts = field.lead.split(/(?<=[.!?])\s+(?=[A-Z`*])/);
  parts = parts.map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return `<p>${inlineMd(field.lead)}</p>`;
  return `<ul>${parts.map((p) => `<li>${inlineMd(p)}</li>`).join('')}</ul>`;
}

/** A changelog bullet (its lines) → HTML list item content. */
function renderChangelogEntry(entry) {
  const [first, ...rest] = entry.lines;
  const lead = first.replace(/^[-*]\s+/, '');
  return `${inlineMd(lead)}${renderNodes(parseList(rest))}`;
}

const CSS = `:root {
  --bg: #f7f7f5;
  --surface: #ffffff;
  --fg: #1d1f23;
  --muted: #5b616b;
  --border: #dcdde0;
  --accent: #2f5bd3;
  --code-bg: #eef0f3;
  --focus: #2f5bd3;
  --ok-bg: #e3f4e8;
  --ok-fg: #17663a;
  --warn-bg: #fdf0d8;
  --warn-fg: #7a4d00;
  --bad-bg: #fbe4e2;
  --bad-fg: #a3261b;
  --neutral-bg: #eceef1;
  --neutral-fg: #444a53;
  --video-bg: #e9eaed;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141518;
    --surface: #1c1e22;
    --fg: #e7e8ea;
    --muted: #a0a6b0;
    --border: #33363d;
    --accent: #8aa8ff;
    --code-bg: #262930;
    --focus: #8aa8ff;
    --ok-bg: #173523;
    --ok-fg: #8fdcaa;
    --warn-bg: #3a2c10;
    --warn-fg: #f2c46b;
    --bad-bg: #42201d;
    --bad-fg: #ff9d92;
    --neutral-bg: #2a2d33;
    --neutral-fg: #c3c7ce;
    --video-bg: #0e0f11;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #141518;
  --surface: #1c1e22;
  --fg: #e7e8ea;
  --muted: #a0a6b0;
  --border: #33363d;
  --accent: #8aa8ff;
  --code-bg: #262930;
  --focus: #8aa8ff;
  --ok-bg: #173523;
  --ok-fg: #8fdcaa;
  --warn-bg: #3a2c10;
  --warn-fg: #f2c46b;
  --bad-bg: #42201d;
  --bad-fg: #ff9d92;
  --neutral-bg: #2a2d33;
  --neutral-fg: #c3c7ce;
  --video-bg: #0e0f11;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  overflow-wrap: anywhere;
}
main {
  max-width: 880px;
  margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 32px 48px;
}
header { margin-bottom: 20px; }
.eyebrow { margin: 0 0 6px; color: var(--muted); font-size: 0.8125rem; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }
h1 { margin: 0 0 8px; font-size: clamp(1.5rem, 1.2rem + 1.4vw, 2rem); line-height: 1.2; letter-spacing: -0.01em; }
h2 { margin: 36px 0 10px; font-size: 1.125rem; line-height: 1.3; }
p, li { max-width: 65ch; }
p { margin: 0 0 10px; }
.intent { color: var(--muted); font-size: 1.0625rem; margin-bottom: 12px; }
ul, ol { margin: 0 0 10px; padding-left: 1.4em; }
li { margin: 3px 0; }
li > ul, li > ol { margin: 4px 0 0; }
a { color: var(--accent); text-underline-offset: 2px; }
a:focus-visible, video:focus-visible, .scroll:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
code, pre { font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, Menlo, monospace; font-size: 0.875em; }
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; }
.chip { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.8125rem; font-weight: 600; line-height: 1.6; }
.chip.ok { background: var(--ok-bg); color: var(--ok-fg); }
.chip.warn { background: var(--warn-bg); color: var(--warn-fg); }
.chip.bad { background: var(--bad-bg); color: var(--bad-fg); }
.chip.neutral { background: var(--neutral-bg); color: var(--neutral-fg); }
.demo { margin: 0; }
.demo video { display: block; width: 100%; max-width: 100%; aspect-ratio: 16 / 9; height: auto; background: var(--video-bg); border: 1px solid var(--border); border-radius: 8px; }
.demo pre { margin: 0; padding: 14px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; white-space: pre; line-height: 1.45; }
.demo figcaption { margin-top: 8px; color: var(--muted); font-size: 0.8125rem; max-width: 65ch; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; }
.card > :last-child { margin-bottom: 0; }
.shipped { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.shipped > li { max-width: none; margin: 0; }
.date { color: var(--muted); font-size: 0.8125rem; margin: 0 0 4px; }
.aside { color: var(--muted); font-size: 0.9375rem; }
.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td code { font-size: 0.8125em; color: var(--muted); }
td:first-child { min-width: 16ch; }
.result-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8125rem; }
footer p { margin: 0 0 4px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }`;

/**
 * The demo page (Artifact page contract: no doctype/html/head/body; <title>,
 * the viewport meta, then <style>). `demo`: { kind: 'video' } or
 * { kind: 'text', text }. `tests`: parseTestsMd output or null. `shipped`:
 * latestShipped output. `git`: { branch, commit }. `generated`: YYYY-MM-DD.
 */
export function renderPage({ story, demo, shipped = [], tests = null, git = {}, generated }) {
  const id = story.id;
  const ms = story.milestone;
  const epicName = ms?.name ?? 'Roadmap';
  const epicHtml = ms?.link && /^https?:\/\//i.test(ms.link)
    ? `<a href="${escapeHtml(ms.link)}">${escapeHtml(epicName)}</a>`
    : escapeHtml(epicName);
  const chip = statusChip(story.status);
  const intent = story.fields.Intent?.lead ? firstSentence(story.fields.Intent.lead) : '';

  const demoHtml = demo.kind === 'video'
    ? `<figure class="demo">
<video src="demo.webm" controls playsinline muted preload="metadata" aria-label="${escapeHtml(`Demo of ${id} ${plainMd(story.title)}`)}"></video>
<figcaption>Recorded by <code>scripts/qa.mjs ${escapeHtml(id)} --fast</code> with <code>DEMO=1</code>; captions are the scenario's Gherkin lines.</figcaption>
</figure>`
    : `<figure class="demo">
<pre class="scroll" tabindex="0">${escapeHtml(demo.text.replace(/\s+$/, ''))}</pre>
<figcaption>Text demo written by <code>scripts/qa.mjs ${escapeHtml(id)} --fast</code>: the story has no UI scenario, so this is the transcript of its checks.</figcaption>
</figure>`;

  const parts = [
    `<title>${escapeHtml(shortTitle(id, story.title))}</title>`,
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<style>\n${CSS}\n</style>`,
    '<main>',
    '<header>',
    `<p class="eyebrow">${epicHtml} · roadmap ${escapeHtml(id)}</p>`,
    `<h1>${inlineMd(story.title)}</h1>`,
    intent ? `<p class="intent">${inlineMd(intent)}</p>` : '',
    `<span class="chip ${chip.tone}">${escapeHtml(chip.label)}</span>`,
    '</header>',
    '<section aria-label="Demo">',
    demoHtml,
    '</section>',
  ];

  if (shipped.length) {
    parts.push(
      '<section aria-labelledby="h-shipped">',
      '<h2 id="h-shipped">What shipped</h2>',
      '<ul class="shipped">',
      ...shipped.map(
        (e) =>
          `<li class="card"><p class="date">${escapeHtml(e.date)}${e.section ? ` · ${escapeHtml(e.section)}` : ''}</p>${renderChangelogEntry(e)}</li>`,
      ),
      '</ul>',
      '</section>',
    );
  }

  const scope = renderField(story.fields.Scope);
  const out = story.fields['Out of scope']?.lead;
  if (scope || out) {
    parts.push(
      '<section aria-labelledby="h-scope">',
      '<h2 id="h-scope">Scope</h2>',
      scope,
      out ? `<p class="aside"><strong>Out of scope:</strong> ${inlineMd(out)}</p>` : '',
      '</section>',
    );
  }

  const acceptance = renderField(story.fields.Acceptance);
  if (acceptance) {
    parts.push(
      '<section aria-labelledby="h-acceptance">',
      '<h2 id="h-acceptance">Acceptance</h2>',
      acceptance,
      '</section>',
    );
  }

  parts.push('<section aria-labelledby="h-gate">', '<h2 id="h-gate">Gate results</h2>');
  if (tests && (tests.result || tests.steps.length)) {
    const r = tests.result;
    parts.push(
      `<div class="result-line"><span class="chip ${r === 'passed' ? 'ok' : r === 'failed' ? 'bad' : 'neutral'}">${r ? (r === 'passed' ? 'Passed' : 'Failed') : 'No result'}</span><span class="aside">From <code>evidence/${escapeHtml(id)}/tests.md</code>, written by <code>scripts/qa.mjs ${escapeHtml(id)} --gate</code>.</span></div>`,
    );
    if (tests.steps.length) {
      parts.push(
        '<div class="scroll" tabindex="0" role="region" aria-label="Gate steps">',
        '<table>',
        '<thead><tr><th scope="col">Step</th><th scope="col">Result</th><th scope="col" class="num">Passed</th><th scope="col" class="num">Failed</th><th scope="col" class="num">Skipped</th></tr></thead>',
        '<tbody>',
        ...tests.steps.map((s) => {
          const tone = /^pass/i.test(s.result) ? 'ok' : /^fail/i.test(s.result) ? 'bad' : 'neutral';
          return `<tr><td>${inlineMd(s.step)}${s.command ? `<br><code>${escapeHtml(s.command)}</code>` : ''}</td><td><span class="chip ${tone}">${escapeHtml(s.result || '—')}</span></td><td class="num">${escapeHtml(s.passed)}</td><td class="num">${escapeHtml(s.failed)}</td><td class="num">${escapeHtml(s.skipped)}</td></tr>`;
        }),
        '</tbody>',
        '</table>',
        '</div>',
      );
    }
  } else {
    parts.push(
      `<p class="result-line"><span class="chip neutral">Not run yet</span><span class="aside">Gate results: not run yet (<code>scripts/qa.mjs ${escapeHtml(id)} --gate</code> writes <code>evidence/${escapeHtml(id)}/tests.md</code>).</span></p>`,
    );
  }
  parts.push('</section>');

  const prov = [
    ms?.key ? `epic ${escapeHtml(ms.key)}` : null,
    git.branch ? `branch <code>${escapeHtml(git.branch)}</code>` : null,
    git.commit ? `commit <code>${escapeHtml(git.commit)}</code>` : null,
    generated ? `generated ${escapeHtml(generated)}` : null,
  ].filter(Boolean);
  parts.push(
    '<footer>',
    prov.length ? `<p>${prov.join(' · ')}</p>` : '',
    `<p>Generated by scripts/demo-page.mjs from roadmap.md, changelog.md and evidence/${escapeHtml(id)}/</p>`,
    '</footer>',
    '</main>',
  );
  return `${parts.filter((p) => p !== '').join('\n')}\n`;
}
