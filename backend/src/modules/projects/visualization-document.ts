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

/** Fixed, readable frame around the agent's visual. */
function renderFrame(bundle: InteractiveVisualBundle, context: VisualContext): string {
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
:root { color-scheme: dark; }
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
.qti-footer { padding-top: 14px; border-top: 1px solid rgba(255,255,255,.08); font-size: 12px; color: #71717a; }
@media (max-width: 640px) { .qti-frame { padding: 16px 14px 32px; } .qti-title { font-size: 19px; } }
@media (prefers-reduced-motion: reduce) { .qti-frame * { animation: none !important; transition: none !important; } }
`;

const RUNTIME_ERROR_HOOK = `
  // Report runtime failures to the host panel; the sandboxed frame has no
  // other way to say "the visual is broken".
  (function () {
    var post = function (message) {
      try { window.parent.postMessage({ type: 'visual-error', message: String(message) }, '*'); } catch (e) {}
    };
    window.addEventListener('error', function (event) {
      post((event.message || 'Script error') + (event.lineno ? ' (line ' + event.lineno + ')' : ''));
    });
    window.addEventListener('unhandledrejection', function (event) {
      post(event.reason && event.reason.message ? event.reason.message : String(event.reason));
    });
  })();`;

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
  <script src="script.js"></script>
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
  <style>${safeStyle(bundle.css)}</style>
</head>
<body>
${renderFrame(bundle, context)}
  <script>${RUNTIME_ERROR_HOOK}</script>
  <script>"use strict";\n${safeScript(bundle.javascript)}</script>
</body>
</html>`;
}
