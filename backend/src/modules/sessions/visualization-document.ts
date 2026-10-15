import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { ReasoningStep, ToolDataRecord } from './entities/session.entity';
import {
  SPEC_BODY_HTML,
  SPEC_BOOTSTRAP_SCRIPT,
  SPEC_SCRIPT_ID,
  type VisualSpec,
} from './visual-spec';
import { VISUAL_RUNTIME_SCRIPT } from './visual-runtime';

export interface InteractiveVisualBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
  /**
   * Set when the visual is spec-rendered: the fixed runtime draws the chart
   * from this document, and `html` / `css` / `javascript` are the synthetic
   * root div, empty sheet and mount bootstrap that keep every older reader
   * (download, body.html, legacy loaders) working unchanged.
   */
  spec?: VisualSpec;
}

/**
 * The analysis the visual came from. Rendered by a fixed frame around the
 * agent-generated visual so the reader always gets question → visual →
 * takeaway → full answer → data provenance → source, regardless of what the
 * designer model produced.
 */
export interface VisualContext {
  question?: string;
  /** Assistant answer in markdown. */
  answer?: string;
  data?: ToolDataRecord[];
  /** Pre-derived source entities; falls back to scanning `data` when absent. */
  entities?: string[];
  /**
   * The assistant's plain-language route from question to answer, one step
   * per data-gathering call that carried a rationale. Model-authored prose;
   * the ordering and outcomes are deterministic, assembled at persist time
   * (or derived here from `data` for older transcripts) so the trail can
   * never claim a query that never ran.
   */
  reasoning?: ReasoningStep[];
  sessionName?: string;
  version?: number;
  generatedAt?: string;
  /**
   * Rows the designer actually saw versus the rows the analysis ran on, when
   * the prompt caps clipped them. Stated in the provenance section so the
   * reader knows the chart is a sample — deterministic, never model output.
   */
  chartRows?: { shown: number; truncatedFrom: number };
  /**
   * The exact (bounded) query results the designer saw, injected into the
   * document at runtime as `window.qti.data` so the visual's script renders
   * from real rows instead of literals baked in at generation time. Same
   * bounding as the designer prompt's `<data>` block.
   */
  chartData?: ChartDataRecord[];
}

/** One result set as handed to the runtime bridge — same shape as the `<data>` block. */
export interface ChartDataRecord {
  tool: string;
  input?: string;
  columns?: string[];
  rowCount?: number;
  rows: Record<string, unknown>[];
}

const PROVENANCE_ROWS = 10;
const CELL_CHARS = 48;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bodyFragment(value: string): string {
  return value
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .trim();
}

function safeStyle(value: string): string {
  return value
    .replace(/@import[^;]+;/gi, '')
    .replace(/<\/style/gi, '<\\/style');
}

/**
 * The designer writes CSS for a standalone page, so its bare `section`,
 * `table` or `body` rules land on the readable frame too — a
 * `section { max-width: 480px }` rule squeezed every frame section and pushed
 * wide tables out of their card. Confine the whole sheet to the visual's own
 * subtree, rewriting page-level selectors to the scope root first so custom
 * properties declared on `:root` still reach the visual.
 */
export function scopedStyle(value: string): string {
  const cleaned = safeStyle(value).trim();
  if (!cleaned) return '';
  const rescoped = cleaned.replace(
    /(^|[{}])([^{}@]*)(?=\{)/g,
    (_match, boundary: string, selector: string) =>
      `${boundary}${selector.replace(/(^|[\s,>+~(])(?::root|html|body)\b/gi, '$1:scope')}`,
  );
  return `@scope (.qti-visual-body) {\n${rescoped}\n}`;
}

function safeScript(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script');
}

/**
 * The visual's data, embedded as a JSON `<script>` block ahead of every other
 * script. `type="application/json"` makes it inert (parsed as data, not
 * executed), so it is unaffected by either document's CSP `script-src`. Read
 * at runtime by the frame bridge into `window.qti.data`.
 */
function dataScriptTag(chartData: VisualContext['chartData']): string {
  const json = JSON.stringify(chartData ?? []).replace(
    /<\/script/gi,
    '<\\/script',
  );
  return `<script type="application/json" id="qti-data">${json}</script>`;
}

/**
 * The visual's spec, embedded the same inert way as its data and read by the
 * fixed runtime on `mount()`. Both documents carry it; only the way the
 * runtime itself is delivered (inline vs. file) differs.
 */
function specScriptTag(spec: VisualSpec): string {
  const json = JSON.stringify(spec).replace(/<\/script/gi, '<\\/script');
  return `<script type="application/json" id="${SPEC_SCRIPT_ID}">${json}</script>`;
}

/** Markdown → sanitized HTML (headings, lists, tables, emphasis, code only). */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: true,
  });
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'code',
      'pre',
      'blockquote',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'span',
    ],
    allowedAttributes: { a: ['href'], th: ['align'], td: ['align'] },
    allowedSchemes: ['https', 'http'],
  });
}

/** Source entities referenced in the SQL (`catalog.schema.table`). */
export function sourceEntities(data: ToolDataRecord[] | undefined): string[] {
  const found = new Set<string>();
  for (const record of data ?? []) {
    for (const match of (record.input ?? '').matchAll(
      /\b([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)\b/g,
    )) {
      found.add(match[1]);
    }
  }
  return Array.from(found);
}

function formatCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '—';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else {
    // Only primitives (or a function) are left.
    const scalar = value as string | number | boolean | bigint | symbol;
    text = String(scalar);
  }
  return escapeHtml(
    text.length > CELL_CHARS ? `${text.slice(0, CELL_CHARS)}…` : text,
  );
}

function renderProvenance(
  data: ToolDataRecord[],
  chartRows?: VisualContext['chartRows'],
): string {
  const items = data
    .map((record, index) => {
      const rows = record.rows ?? [];
      const columns = record.columns?.length
        ? record.columns
        : Object.keys(rows[0] ?? {});
      const count = record.rowCount ?? rows.length;
      const label = record.error
        ? `Query ${index + 1} — failed`
        : `Query ${index + 1} — ${count} row${count === 1 ? '' : 's'}${record.truncated ? ' (truncated)' : ''}`;
      const table =
        !record.error && rows.length && columns.length
          ? `<div class="qti-table-wrap"><table class="qti-table"><thead><tr>${columns
              .map((c) => `<th>${escapeHtml(c)}</th>`)
              .join('')}</tr></thead><tbody>${rows
              .slice(0, PROVENANCE_ROWS)
              .map(
                (row) =>
                  `<tr>${columns.map((c) => `<td>${formatCell(row[c])}</td>`).join('')}</tr>`,
              )
              .join('')}</tbody></table>${
              count > PROVENANCE_ROWS
                ? `<p class="qti-muted">Showing ${PROVENANCE_ROWS} of ${count} rows.</p>`
                : ''
            }</div>`
          : '';
      return `<li>
  <p class="qti-query-label">${escapeHtml(label)}</p>
  ${record.rationale ? `<p class="qti-muted qti-why">${escapeHtml(record.rationale)}</p>` : ''}
  ${record.input ? `<pre class="qti-sql">${escapeHtml(record.input)}</pre>` : ''}
  ${record.error ? `<p class="qti-error">${escapeHtml(record.error)}</p>` : ''}
  ${table}
</li>`;
    })
    .join('\n');
  const sampled = chartRows
    ? `<p class="qti-muted">Chart built from the first ${chartRows.shown} of ${chartRows.truncatedFrom} rows.</p>`
    : '';
  return `<details class="qti-provenance">
  <summary>Data used (${data.length} ${data.length === 1 ? 'query' : 'queries'})</summary>
  ${sampled}
  <ol>${items}</ol>
</details>`;
}

/** Muted "outcome" line under a reasoning step: row count, or the failure. */
function reasoningOutcome(step: ReasoningStep): string {
  if (step.error) return `failed — ${step.error}`;
  if (step.rowCount !== undefined) {
    return `${step.rowCount.toLocaleString('en-US')} row${step.rowCount === 1 ? '' : 's'}`;
  }
  return '';
}

/**
 * "How this was worked out": the model's plain-language reasoning trail,
 * rendered as inert text (never through the markdown pipeline) so a step's
 * rationale can never inject markup or links.
 */
function renderReasoning(steps: ReasoningStep[]): string {
  const items = steps
    .map((step) => {
      const outcome = reasoningOutcome(step);
      return `<li>
  <p class="qti-reasoning-rationale">${escapeHtml(step.rationale)}</p>
  ${outcome ? `<p class="qti-muted">${escapeHtml(outcome)}</p>` : ''}
</li>`;
    })
    .join('\n');
  return `<section class="qti-section">
    <h2 class="qti-h2">How this was worked out</h2>
    <ol class="qti-reasoning">${items}</ol>
  </section>`;
}

/** Fixed, readable frame around the agent's visual. */
function renderFrame(
  bundle: InteractiveVisualBundle,
  context: VisualContext,
): string {
  // A spec visual's body is always the runtime's mount point; a freeform one
  // is the designer's own fragment, stripped of document-level markup.
  const visualBody = bundle.spec ? SPEC_BODY_HTML : bodyFragment(bundle.html);
  const entities = context.entities?.length
    ? context.entities
    : sourceEntities(context.data);
  const entityChips = entities.length
    ? `<div class="qti-entities" aria-label="Data entities">
    <span class="qti-label">Data entities</span>
    ${entities.map((e) => `<span class="qti-chip">${escapeHtml(e)}</span>`).join('')}
  </div>`
    : '';
  const generated = context.generatedAt
    ? new Date(context.generatedAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : undefined;
  const footer = [
    entities.length ? `Source: ${entities.map(escapeHtml).join(', ')}` : '',
    context.sessionName ? `Session: ${escapeHtml(context.sessionName)}` : '',
    context.version ? `Version ${context.version}` : '',
    generated ? `Generated ${escapeHtml(generated)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<main class="qti-frame">
  <header class="qti-header">
    <h1 class="qti-title">${escapeHtml(bundle.title)}</h1>
    ${context.question ? `<p class="qti-question"><span class="qti-label">Question</span>${escapeHtml(context.question)}</p>` : ''}
    ${entityChips}
  </header>

  <section class="qti-visual" aria-label="Interactive visual">
    <div class="qti-visual-body">
${visualBody}
    </div>
  </section>

  <section class="qti-section">
    <h2 class="qti-h2">Takeaway</h2>
    <p class="qti-takeaway">${escapeHtml(bundle.description)}</p>
  </section>

  ${
    context.answer
      ? `<section class="qti-section">
    <h2 class="qti-h2">Analysis</h2>
    <div class="qti-prose">${renderMarkdown(context.answer)}</div>
  </section>`
      : ''
  }

  ${context.reasoning?.length ? renderReasoning(context.reasoning) : ''}

  ${context.data?.length ? `<section class="qti-section">${renderProvenance(context.data, context.chartRows)}</section>` : ''}

  ${footer ? `<footer class="qti-footer">${footer}</footer>` : ''}
</main>`;
}

/**
 * The frame's colour tokens, Light and Dark. They mirror the app's own theme
 * tokens (ui.md 6.0) so a visual reads as part of the panel around it, and the
 * series palette keeps 3:1 against each theme's page colour.
 */
const LIGHT_TOKENS = `
  color-scheme: light;
  --qti-bg: #ffffff;
  --qti-fg: rgb(0 0 0 / 0.85);
  --qti-fg-strong: #001f52;
  --qti-fg-muted: rgb(0 0 0 / 0.6);
  --qti-surface: #f8fafc;
  --qti-border: rgb(0 0 0 / 0.1);
  --qti-link: #0b41ad;
  --qti-focus: #0b41ad;
  /* Categorical series palette — accessible on the white page. */
  --qti-cat-1: #0284c7; /* sky-600 */
  --qti-cat-2: #d97706; /* amber-600 */
  --qti-cat-3: #059669; /* emerald-600 */
  --qti-cat-4: #7c3aed; /* violet-600 */
  --qti-cat-5: #e11d48; /* rose-600 */
  --qti-cat-6: #0891b2; /* cyan-600 */
  --qti-cat-7: #65a30d; /* lime-600 */
  --qti-cat-8: #ea580c; /* orange-600 */
  --qti-pos: #059669;
  --qti-neg: #dc2626;
  --qti-grid: rgb(0 0 0 / 0.08);
  --qti-axis: rgb(0 0 0 / 0.6);
  --qti-tooltip-bg: #ffffff;
  /* Text on a filled series colour (pie slices, dense heatmap cells). */
  --qti-on-cat: #ffffff;`;

const DARK_TOKENS = `
  color-scheme: dark;
  --qti-bg: #12233a;
  --qti-fg: #d5dfec;
  --qti-fg-strong: #eef4fc;
  --qti-fg-muted: #93a6bf;
  --qti-surface: #16294a;
  --qti-border: #24384f;
  --qti-link: #5b95ff;
  --qti-focus: #7fb0ff;
  /* Categorical series palette — accessible on the dark page. */
  --qti-cat-1: #38bdf8; /* sky-400 */
  --qti-cat-2: #fbbf24; /* amber-400 */
  --qti-cat-3: #34d399; /* emerald-400 */
  --qti-cat-4: #a78bfa; /* violet-400 */
  --qti-cat-5: #fb7185; /* rose-400 */
  --qti-cat-6: #22d3ee; /* cyan-400 */
  --qti-cat-7: #a3e635; /* lime-400 */
  --qti-cat-8: #fb923c; /* orange-400 */
  --qti-pos: #34d399;
  --qti-neg: #f87171;
  --qti-grid: rgb(255 255 255 / 0.08);
  --qti-axis: #93a6bf;
  --qti-tooltip-bg: #1a3357;
  --qti-on-cat: #0b1626;`;

/**
 * Frame styles are namespaced (`qti-`) so the agent's CSS cannot break
 * readability. The host panel sets `data-theme` on the root to the app's
 * resolved theme; a document without it (a downloaded `index.html`) follows
 * the operating system.
 */
const FRAME_CSS = `
:root {${LIGHT_TOKENS}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_TOKENS}
  }
}
:root[data-theme="dark"] {${DARK_TOKENS}
}
html, body { margin: 0; background: var(--qti-bg); }
.qti-frame {
  max-width: 920px; margin: 0 auto; padding: 24px 24px 40px; box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px; line-height: 1.65; color: var(--qti-fg);
}
.qti-header { margin-bottom: 18px; }
.qti-title { margin: 0 0 8px; font-size: 22px; line-height: 1.3; font-weight: 600; color: var(--qti-fg-strong); }
.qti-question { margin: 0; font-size: 14px; color: var(--qti-fg-muted); }
.qti-label { display: inline-block; margin-right: 8px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--qti-border); background: var(--qti-surface); font-size: 11px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--qti-fg-muted); vertical-align: middle; }
.qti-entities { margin: 12px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.qti-chip { display: inline-block; padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--qti-border); background: var(--qti-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--qti-fg); }
.qti-visual { margin: 0 0 22px; padding: 16px; border: 1px solid var(--qti-border);
  border-radius: 12px; background: var(--qti-bg); color: var(--qti-fg);
  /* The boundary wide designer content scrolls in instead of spilling out. */
  position: relative; overflow-x: auto; }
/* Scope root for the designer's stylesheet — a plain div, so its element
   selectors (section, table, …) cannot reach the frame around it. */
.qti-visual-body { position: relative; }
.qti-section { margin: 0 0 22px; }
.qti-h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: var(--qti-fg-muted); }
.qti-takeaway { margin: 0; font-size: 15px; line-height: 1.6; color: var(--qti-fg); }
.qti-prose p { margin: 0 0 .75em; } .qti-prose p:last-child { margin-bottom: 0; }
.qti-prose strong { color: var(--qti-fg-strong); } .qti-prose a { color: var(--qti-link); }
.qti-prose h1, .qti-prose h2, .qti-prose h3, .qti-prose h4 { margin: 1em 0 .4em; color: var(--qti-fg-strong); font-size: 15px; }
.qti-prose ul, .qti-prose ol { margin: .25em 0 .75em; padding-left: 1.4em; }
.qti-prose li { margin: .15em 0; }
.qti-prose code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
  background: var(--qti-surface); border-radius: 4px; padding: .1em .35em; }
.qti-prose pre { padding: .75em .9em; background: var(--qti-surface); border: 1px solid var(--qti-border); border-radius: 8px; overflow-x: auto; }
.qti-prose table, .qti-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.qti-prose th, .qti-prose td, .qti-table th, .qti-table td { padding: .4em .7em; text-align: left;
  border: 1px solid var(--qti-border); white-space: nowrap; }
.qti-prose th, .qti-table th { background: var(--qti-surface); color: var(--qti-fg-strong); font-weight: 600; }
.qti-table-wrap { overflow-x: auto; margin-top: 8px; }
.qti-reasoning { margin: 0; padding: 0; list-style: none; counter-reset: qti-step; }
.qti-reasoning li { counter-increment: qti-step; margin: 0 0 14px; padding-left: 28px; position: relative; }
.qti-reasoning li:last-child { margin-bottom: 0; }
.qti-reasoning li::before { content: counter(qti-step); position: absolute; left: 0; top: 0;
  width: 18px; height: 18px; border-radius: 999px; background: var(--qti-surface); border: 1px solid var(--qti-border);
  box-sizing: border-box; color: var(--qti-fg-muted); font-size: 11px; font-weight: 600; line-height: 16px; text-align: center; }
.qti-reasoning-rationale { margin: 0; font-size: 14px; line-height: 1.6; color: var(--qti-fg); }
.qti-why { margin-top: 2px; }
.qti-provenance { border: 1px solid var(--qti-border); border-radius: 10px; background: var(--qti-bg); }
.qti-provenance summary { cursor: pointer; padding: 10px 14px; font-size: 13px; color: var(--qti-fg-muted); }
.qti-provenance summary:hover { color: var(--qti-fg-strong); }
.qti-provenance ol { margin: 0; padding: 0 14px 14px 14px; list-style: none; }
.qti-provenance > .qti-muted { margin: 0 0 4px; padding: 0 14px; }
.qti-provenance li { margin-top: 12px; }
.qti-query-label { margin: 0 0 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--qti-fg-muted); }
.qti-sql { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--qti-surface); border: 1px solid var(--qti-border);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5;
  white-space: pre-wrap; color: var(--qti-fg); }
.qti-error { margin: 6px 0 0; color: var(--qti-neg); font-size: 12.5px; }
.qti-muted { margin: 6px 0 0; font-size: 12px; color: var(--qti-fg-muted); }
/* Clickable data marks: defaults the designer's own CSS can still override. */
[data-qti-value] { cursor: pointer; }
[data-qti-value]:focus-visible { outline: 2px solid var(--qti-focus); outline-offset: 2px; }
.qti-footer { padding-top: 14px; border-top: 1px solid var(--qti-border); font-size: 12px; color: var(--qti-fg-muted); }
/* Ready-made KPI tile row for composed answers. */
.qti-kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; }
.qti-kpi { flex: 1 1 140px; padding: 12px 14px; border: 1px solid var(--qti-border);
  border-radius: 12px; background: var(--qti-surface); }
.qti-kpi-value { display: block; font-size: 26px; line-height: 1.2; font-weight: 600;
  color: var(--qti-fg-strong); font-variant-numeric: tabular-nums; }
.qti-kpi-label { display: block; margin-top: 4px; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: var(--qti-fg-muted); }
.qti-kpi-delta { display: inline-block; margin-top: 4px; font-size: 12px; font-weight: 600; }
.qti-kpi-delta.qti-up { color: var(--qti-pos); }
.qti-kpi-delta.qti-down { color: var(--qti-neg); }
.qti-kpi-spark { display: block; height: 40px; margin-top: 6px; }
/* Hover/focus readout box for chart marks. */
.qti-tooltip { position: absolute; padding: 6px 9px; border-radius: 6px;
  background: var(--qti-tooltip-bg); border: 1px solid var(--qti-border);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  font-size: 12px; line-height: 1.4; color: var(--qti-fg); pointer-events: none; z-index: 10; }
@media (max-width: 640px) { .qti-frame { padding: 16px 14px 32px; } .qti-title { font-size: 19px; } }
@media (prefers-reduced-motion: reduce) { .qti-frame * { animation: none !important; transition: none !important; } }
`;

/** Message the blank-render watchdog reports; the host repairs on this too. */
export const BLANK_RENDER_MESSAGE = 'visual rendered blank';
/** How long after `load` the watchdog waits before calling the visual blank. */
const BLANK_CHECK_DELAY_MS = 1500;
/** A child shorter than this is a stray wrapper, not a rendered visual. */
const BLANK_MIN_HEIGHT = 24;

const RUNTIME_ERROR_HOOK = `
  // Report runtime failures to the host panel; the sandboxed frame has no
  // other way to say "the visual is broken".
  (function () {
    var reported = false;
    var post = function (message) {
      reported = true;
      try { window.parent.postMessage({ type: 'visual-error', message: String(message) }, '*'); } catch (e) {}
    };
    window.addEventListener('error', function (event) {
      post((event.message || 'Script error') + (event.lineno ? ' (line ' + event.lineno + ')' : ''));
    });
    window.addEventListener('unhandledrejection', function (event) {
      post(event.reason && event.reason.message ? event.reason.message : String(event.reason));
    });
    // A visual can also fail silently: the script runs, throws nothing, and
    // paints nothing. Treat an empty visual section as a runtime failure so
    // the host can repair it.
    var checkBlank = function () {
      if (reported) return;
      var section = document.querySelector('.qti-visual');
      if (!section) return;
      if (section.querySelector('svg, canvas, table, img')) return;
      var children = section.children;
      for (var i = 0; i < children.length; i++) {
        if (children[i].offsetHeight >= ${BLANK_MIN_HEIGHT}) return;
      }
      post(${JSON.stringify(BLANK_RENDER_MESSAGE)});
    };
    window.addEventListener('load', function () {
      setTimeout(checkBlank, ${BLANK_CHECK_DELAY_MS});
    });
  })();`;

/**
 * Click-to-follow-up bridge. Any element the designer marks with
 * `data-qti-value` (optionally `data-qti-label`, `data-qti-column`) posts the
 * selection to the host, which turns it into a follow-up question (single
 * view) or a dashboard cross-filter toggle (dashboard view, when a column is
 * present). Standalone (downloaded) copies have no host, so the postMessage
 * is a harmless no-op there.
 *
 * Also carries the dashboard filter bridge: the host broadcasts
 * `{type:'qti-filter', filters:[{column, values}]}` to every tile, which is
 * applied on top of a pristine (unfiltered) copy of the data kept alongside
 * `window.qti.data` — so a later `qti-data` refresh and a currently-active
 * filter compose instead of one clobbering the other.
 */
export const FRAME_SELECT_SCRIPT = `(function () {
  var select = function (value, label, column) {
    if (value === null || value === undefined) return;
    try {
      window.parent.postMessage({
        type: 'visual-select',
        value: String(value),
        label: label === null || label === undefined ? undefined : String(label),
        column: column === null || column === undefined ? undefined : String(column)
      }, '*');
    } catch (e) {}
  };
  window.qti = window.qti || {};
  window.qti.select = select;

  // The query results the visual was built from, injected as a JSON block
  // ahead of this script. Scripts must read data from window.qti.data —
  // never hardcode values, labels, or aggregates.
  var dataEl = document.getElementById('qti-data');
  var initialData = [];
  if (dataEl) {
    try {
      var parsedData = JSON.parse(dataEl.textContent || '[]');
      if (Array.isArray(parsedData)) initialData = parsedData;
    } catch (e) {}
  }
  // The pristine (unfiltered) rows survive both data refreshes and dashboard
  // filter changes, so a filter is always recomputed from the full set
  // instead of compounding on an already-filtered one.
  var pristineData = initialData;
  var activeFilters = [];
  window.qti.data = initialData;
  var refreshCallbacks = [];
  window.qti.onRefresh = function (cb) {
    if (typeof cb === 'function') refreshCallbacks.push(cb);
  };

  var recordHasColumn = function (record, column) {
    if (record && record.columns && record.columns.length) {
      return record.columns.indexOf(column) !== -1;
    }
    var firstRow = record && record.rows && record.rows[0];
    return !!firstRow && Object.prototype.hasOwnProperty.call(firstRow, column);
  };
  // Dashboard filters AND together; a filter on a column a record lacks does
  // not affect that record.
  var applyFilters = function () {
    if (!activeFilters.length) return pristineData;
    return pristineData.map(function (record) {
      var applicable = activeFilters.filter(function (f) {
        return f && f.column && recordHasColumn(record, f.column);
      });
      if (!applicable.length) return record;
      var rows = (record.rows || []).filter(function (row) {
        return applicable.every(function (f) {
          return (f.values || []).indexOf(String(row[f.column])) !== -1;
        });
      });
      var filtered = {};
      for (var key in record) {
        if (Object.prototype.hasOwnProperty.call(record, key)) filtered[key] = record[key];
      }
      filtered.rows = rows;
      filtered.rowCount = rows.length;
      return filtered;
    });
  };
  var setData = function (data) {
    window.qti.data = data;
    refreshCallbacks.forEach(function (cb) {
      try { cb(data); } catch (e) {}
    });
  };
  // The host (or, for tiles, a future refresh bus) can swap in fresh rows
  // without redesigning the visual — re-run the stored SQL, then post the
  // new rows here. A refresh replaces the pristine copy and re-applies
  // whatever dashboard filters are currently active.
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || !message.type) return;
    if (message.type === 'qti-data' && Array.isArray(message.data)) {
      pristineData = message.data;
      setData(applyFilters());
      return;
    }
    // Dashboard-wide filters, broadcast from the host to every tile. An
    // empty filters array restores the pristine, unfiltered data.
    if (message.type === 'qti-filter' && Array.isArray(message.filters)) {
      activeFilters = message.filters;
      setData(applyFilters());
      return;
    }
    // The app's theme changed while the visual is open: switch the frame's
    // tokens in place, so the visual keeps its state instead of reloading.
    if (message.type === 'qti-theme' && (message.theme === 'light' || message.theme === 'dark')) {
      document.documentElement.setAttribute('data-theme', message.theme);
    }
  });

  var markFor = function (target) {
    var node = target;
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('data-qti-value') !== null) return node;
      node = node.parentNode;
    }
    return null;
  };
  var fire = function (event) {
    var mark = markFor(event.target);
    if (!mark) return;
    select(
      mark.getAttribute('data-qti-value'),
      mark.getAttribute('data-qti-label'),
      mark.getAttribute('data-qti-column')
    );
  };
  document.addEventListener('click', fire);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    if (!markFor(event.target)) return;
    event.preventDefault();
    fire(event);
  });
})();`;

/** Filename the frame bridge ships as beside index.html, for hand edits. */
export const FRAME_SCRIPT_FILENAME = 'qti-frame.js';

/**
 * Every script of a visual, inlined: the inert data (and spec) blocks, the
 * frame bridge, then either the fixed runtime plus its mount bootstrap (spec
 * visuals) or the designer's own script.
 *
 * Both documents inline rather than link, for the same reason from opposite
 * ends. The panel iframe has no file access at all; the stored document is
 * opened from `file://`, where the origin is opaque and `script-src 'self'`
 * matches no sibling file — linking `script.js` there rendered the frame with
 * an empty chart. The sibling files still ship in the download for editing.
 */
function inlineScripts(
  bundle: InteractiveVisualBundle,
  context: VisualContext,
  options: { errorHook: boolean },
): string {
  return [
    dataScriptTag(context.chartData),
    ...(bundle.spec ? [specScriptTag(bundle.spec)] : []),
    ...(options.errorHook ? [`<script>${RUNTIME_ERROR_HOOK}</script>`] : []),
    `<script>${FRAME_SELECT_SCRIPT}</script>`,
    ...(bundle.spec
      ? [
          `<script>${safeScript(VISUAL_RUNTIME_SCRIPT)}</script>`,
          `<script>"use strict";\n${SPEC_BOOTSTRAP_SCRIPT}</script>`,
        ]
      : [`<script>"use strict";\n${safeScript(bundle.javascript)}</script>`]),
  ].join('\n  ');
}

/** Standalone file persisted in the workspace alongside CSS and JavaScript. */
export function storedVisualizationDocument(
  bundle: InteractiveVisualBundle,
  context: VisualContext = {},
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'">
  <title>${escapeHtml(bundle.title)}</title>
  <style>${FRAME_CSS}</style>
  <!-- Inlined rather than linked so the designer's sheet arrives scoped. -->
  <style>${scopedStyle(bundle.css)}</style>
</head>
<body>
${renderFrame(bundle, context)}
  ${inlineScripts(bundle, context, { errorHook: false })}
</body>
</html>`;
}

/** Self-contained document rendered in an origin-isolated iframe. */
export function sandboxedVisualizationDocument(
  bundle: InteractiveVisualBundle,
  context: VisualContext = {},
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'">
  <title>${escapeHtml(bundle.title)}</title>
  <style>${FRAME_CSS}</style>
  <style>${scopedStyle(bundle.css)}</style>
</head>
<body>
${renderFrame(bundle, context)}
  ${inlineScripts(bundle, context, { errorHook: true })}
</body>
</html>`;
}
