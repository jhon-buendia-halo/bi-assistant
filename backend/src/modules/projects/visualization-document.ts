import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { ToolDataRecord } from './entities/project.entity';

export interface InteractiveVisualBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
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
  projectName?: string;
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

/** Markdown → sanitized HTML (headings, lists, tables, emphasis, code only). */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre', 'blockquote', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span',
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
  const text =
    value === null || value === undefined
      ? '—'
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return escapeHtml(text.length > CELL_CHARS ? `${text.slice(0, CELL_CHARS)}…` : text);
}

function renderProvenance(
  data: ToolDataRecord[],
  chartRows?: VisualContext['chartRows'],
): string {
  const items = data
    .map((record, index) => {
      const rows = record.rows ?? [];
      const columns = record.columns?.length ? record.columns : Object.keys(rows[0] ?? {});
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

/** Which document is being assembled: the full readable frame, or a dense dashboard tile. */
export type DocumentMode = 'full' | 'tile';

/** Fixed, readable frame around the agent's visual. */
function renderFrame(
  bundle: InteractiveVisualBundle,
  context: VisualContext,
  mode: DocumentMode = 'full',
): string {
  if (mode === 'tile') {
    return `<main class="qti-frame qti-frame--tile">
  <header class="qti-header qti-header--tile">
    <h1 class="qti-title qti-title--tile">${escapeHtml(bundle.title)}</h1>
  </header>

  <section class="qti-visual" aria-label="Interactive visual">
${bodyFragment(bundle.html)}
  </section>
</main>`;
  }

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
    context.projectName ? `Project: ${escapeHtml(context.projectName)}` : '',
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
${bodyFragment(bundle.html)}
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

  ${context.data?.length ? `<section class="qti-section">${renderProvenance(context.data, context.chartRows)}</section>` : ''}

  ${footer ? `<footer class="qti-footer">${footer}</footer>` : ''}
</main>`;
}

/** Frame styles are namespaced (`qti-`) so the agent's CSS cannot break readability. */
const FRAME_CSS = `
:root {
  color-scheme: dark;
  /* Categorical series palette — accessible on the #171717 dark background. */
  --qti-cat-1: #38bdf8; /* sky-400 */
  --qti-cat-2: #fbbf24; /* amber-400 */
  --qti-cat-3: #34d399; /* emerald-400 */
  --qti-cat-4: #a78bfa; /* violet-400 */
  --qti-cat-5: #fb7185; /* rose-400 */
  --qti-cat-6: #22d3ee; /* cyan-400 */
  --qti-cat-7: #a3e635; /* lime-400 */
  --qti-cat-8: #fb923c; /* orange-400 */
  /* Semantic tokens. */
  --qti-pos: #34d399;
  --qti-neg: #f87171;
  --qti-grid: rgba(255,255,255,.07);
  --qti-axis: #71717a;
  --qti-tooltip-bg: #26262b;
}
html, body { margin: 0; background: #171717; }
.qti-frame {
  max-width: 920px; margin: 0 auto; padding: 24px 24px 40px; box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px; line-height: 1.65; color: #d4d4d8;
}
.qti-header { margin-bottom: 18px; }
.qti-title { margin: 0 0 8px; font-size: 22px; line-height: 1.3; font-weight: 600; color: #fafafa; }
.qti-question { margin: 0; font-size: 14px; color: #a1a1aa; }
.qti-label { display: inline-block; margin-right: 8px; padding: 1px 7px; border-radius: 999px;
  background: rgba(255,255,255,.08); font-size: 11px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: #a1a1aa; vertical-align: middle; }
.qti-entities { margin: 12px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.qti-chip { display: inline-block; padding: 2px 9px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: #d4d4d8; }
.qti-visual { margin: 0 0 22px; padding: 16px; border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px; background: rgba(255,255,255,.02); }
.qti-section { margin: 0 0 22px; }
.qti-h2 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em;
  text-transform: uppercase; color: #71717a; }
.qti-takeaway { margin: 0; font-size: 15px; line-height: 1.6; color: #e4e4e7; }
.qti-prose p { margin: 0 0 .75em; } .qti-prose p:last-child { margin-bottom: 0; }
.qti-prose strong { color: #f4f4f5; } .qti-prose a { color: #7dd3fc; }
.qti-prose h1, .qti-prose h2, .qti-prose h3, .qti-prose h4 { margin: 1em 0 .4em; color: #f4f4f5; font-size: 15px; }
.qti-prose ul, .qti-prose ol { margin: .25em 0 .75em; padding-left: 1.4em; }
.qti-prose li { margin: .15em 0; }
.qti-prose code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
  background: rgba(255,255,255,.08); border-radius: 4px; padding: .1em .35em; }
.qti-prose pre { padding: .75em .9em; background: rgba(255,255,255,.05); border-radius: 8px; overflow-x: auto; }
.qti-prose table, .qti-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.qti-prose th, .qti-prose td, .qti-table th, .qti-table td { padding: .4em .7em; text-align: left;
  border: 1px solid rgba(255,255,255,.08); white-space: nowrap; }
.qti-prose th, .qti-table th { background: rgba(255,255,255,.06); color: #e4e4e7; font-weight: 600; }
.qti-table-wrap { overflow-x: auto; margin-top: 8px; }
.qti-provenance { border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.02); }
.qti-provenance summary { cursor: pointer; padding: 10px 14px; font-size: 13px; color: #a1a1aa; }
.qti-provenance summary:hover { color: #e4e4e7; }
.qti-provenance ol { margin: 0; padding: 0 14px 14px 14px; list-style: none; }
.qti-provenance > .qti-muted { margin: 0 0 4px; padding: 0 14px; }
.qti-provenance li { margin-top: 12px; }
.qti-query-label { margin: 0 0 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #a1a1aa; }
.qti-sql { margin: 0; padding: 10px 12px; border-radius: 8px; background: rgba(0,0,0,.35);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5;
  white-space: pre-wrap; color: #a1a1aa; }
.qti-error { margin: 6px 0 0; color: #f87171; font-size: 12.5px; }
.qti-muted { margin: 6px 0 0; font-size: 12px; color: #71717a; }
/* Clickable data marks: defaults the designer's own CSS can still override. */
[data-qti-value] { cursor: pointer; }
[data-qti-value]:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
.qti-footer { padding-top: 14px; border-top: 1px solid rgba(255,255,255,.08); font-size: 12px; color: #71717a; }
/* Ready-made KPI tile row for composed answers. */
.qti-kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; }
.qti-kpi { flex: 1 1 140px; padding: 12px 14px; border: 1px solid rgba(255,255,255,.08);
  border-radius: 12px; background: rgba(255,255,255,.03); }
.qti-kpi-value { display: block; font-size: 26px; line-height: 1.2; font-weight: 600;
  color: #fafafa; font-variant-numeric: tabular-nums; }
.qti-kpi-label { display: block; margin-top: 4px; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; text-transform: uppercase; color: #a1a1aa; }
.qti-kpi-delta { display: inline-block; margin-top: 4px; font-size: 12px; font-weight: 600; }
.qti-kpi-delta.qti-up { color: var(--qti-pos); }
.qti-kpi-delta.qti-down { color: var(--qti-neg); }
.qti-kpi-spark { display: block; height: 40px; margin-top: 6px; }
/* Hover/focus readout box for chart marks. */
.qti-tooltip { position: absolute; padding: 6px 9px; border-radius: 6px;
  background: var(--qti-tooltip-bg); border: 1px solid rgba(255,255,255,.12);
  font-size: 12px; line-height: 1.4; color: #e4e4e7; pointer-events: none; z-index: 10; }
@media (max-width: 640px) { .qti-frame { padding: 16px 14px 32px; } .qti-title { font-size: 19px; } }
@media (prefers-reduced-motion: reduce) { .qti-frame * { animation: none !important; transition: none !important; } }
/* Dense dashboard tile: compact header, visual only — no question/entities/takeaway/analysis/provenance/footer. */
.qti-frame--tile { max-width: none; padding: 12px 14px 14px; }
.qti-header--tile { margin-bottom: 10px; }
.qti-title--tile { font-size: 13px; font-weight: 500; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qti-frame--tile .qti-visual { margin-bottom: 0; padding: 10px; }
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

/** Filename the stored document loads the frame bridge from (CSP: script-src 'self'). */
export const FRAME_SCRIPT_FILENAME = 'qti-frame.js';

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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src data: blob:; font-src data:; connect-src 'none'">
  <title>${escapeHtml(bundle.title)}</title>
  <style>${FRAME_CSS}</style>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${renderFrame(bundle, context)}
  ${dataScriptTag(context.chartData)}
  <script src="${FRAME_SCRIPT_FILENAME}"></script>
  <script src="script.js"></script>
</body>
</html>`;
}

/** Self-contained document rendered in an origin-isolated iframe. */
export function sandboxedVisualizationDocument(
  bundle: InteractiveVisualBundle,
  context: VisualContext = {},
  options?: { mode?: DocumentMode },
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'">
  <title>${escapeHtml(bundle.title)}</title>
  <style>${FRAME_CSS}</style>
  <style>${safeStyle(bundle.css)}</style>
</head>
<body>
${renderFrame(bundle, context, options?.mode)}
  ${dataScriptTag(context.chartData)}
  <script>${RUNTIME_ERROR_HOOK}</script>
  <script>${FRAME_SELECT_SCRIPT}</script>
  <script>"use strict";\n${safeScript(bundle.javascript)}</script>
</body>
</html>`;
}
