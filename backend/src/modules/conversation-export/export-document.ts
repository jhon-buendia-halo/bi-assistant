/**
 * The conversation export's document (agents.md 3.18; ADR-0056): the
 * conversation's runs and Avery's content turned into one `ExportDocument`,
 * then into the HTML report the browser prints as the PDF and into the
 * slides of the PowerPoint. Pure: no browser, no file, no framework; the
 * dashboard rows come in already drawn (`DashboardRowCapture`). The layout,
 * copy and widget-row technique are the accepted prototype's
 * (`.context/wireframes/export/proto.cjs`).
 */
import { Marked, marked, type Tokens } from 'marked';
import type { ExportContent } from '../../mastra/workflows/export-request';
import type { DashboardRef } from '../artifacts/entities/artifact.entity';
import type { ChatMessage } from '../sessions/entities/session.entity';
import type { ExportBrand } from './conversation-export.contract';

/** The language the file is written in: the conversation's. */
export type ExportLanguage = 'es' | 'en';

/** A run of the conversation, as the export reads it. */
export interface ExportRun {
  id: string;
  question: string;
  startedAt: string;
  answer: Pick<ChatMessage, 'content' | 'data' | 'evidence' | 'dashboard'>;
  datasets: string[];
}

/** A table widget, as its card shows it. */
export interface DashboardTableCapture {
  title: string;
  header: string[];
  rows: string[][];
}

/**
 * One row of a dashboard's widgets: the PNG of its cards (CSS px, drawn at
 * twice the pixels), table widgets left out and kept as text instead.
 */
export interface DashboardRowCapture {
  image?: { png: Buffer; width: number; height: number };
  tables: DashboardTableCapture[];
}

/** A dashboard version the export shows, drawn. */
export interface ExportDashboard {
  ref: DashboardRef;
  /** The latest version the conversation made goes in full. */
  latest: boolean;
  /** An earlier version: the version that replaced it. */
  replacedBy?: number;
  summary?: string;
  /** The blueprint's filter labels, all at "All". */
  filters: string[];
  status: 'draft' | 'saved';
  /** Every widget row (the first one alone for an earlier version). */
  rows: DashboardRowCapture[];
}

/** One query of a turn, for the appendix. */
export interface ExportQuery {
  rationale: string;
  rowCount?: number;
  tables: string[];
  sql: string;
}

/** One earlier question and its answer. */
export interface ExportTurn {
  number: number;
  question: string;
  askedAt: string;
  headline: string;
  points: string[];
  /** Avery's answer, markdown. */
  answer: string;
  queries: ExportQuery[];
  dashboard?: ExportDashboard;
}

/** Everything both files are drawn from. */
export interface ExportDocument {
  language: ExportLanguage;
  brand: ExportBrand;
  title: string;
  subtitle?: string;
  summary: string[];
  /** ISO time of the conversation's first question. */
  date: string;
  datasets: string[];
  includeSql: boolean;
  turns: ExportTurn[];
}

/** A dashboard version the export needs, and how it is shown. */
export interface DashboardVersionNeed {
  runId: string;
  ref: DashboardRef;
  latest: boolean;
  replacedBy?: number;
}

/** The colours of a brand, as hex without `#` (PowerPoint takes them so). */
export interface ExportPalette {
  name: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  fg: string;
  fgStrong: string;
  muted: string;
  surface: string;
  border: string;
}

/**
 * The brand palettes: Halo's accent, and for Mercer the frame-theme tokens
 * of that brand (modules/sessions/frame-theme.ts).
 */
export const EXPORT_PALETTES: Readonly<Record<ExportBrand, ExportPalette>> = {
  halo: {
    name: 'Halo Workbench',
    accent: 'ED3E13',
    accentText: 'D4380F',
    accentSoft: 'FDECE7',
    fg: '2A2A2A',
    fgStrong: '181818',
    muted: '5F5F5C',
    surface: 'F6F6F4',
    border: 'E3E3DF',
  },
  mercer: {
    name: 'Agentic Hub',
    accent: '0B41AD',
    accentText: '0B41AD',
    accentSoft: 'E7EDF8',
    fg: '262626',
    fgStrong: '001F52',
    muted: '666666',
    surface: 'F8FAFC',
    border: 'E5E5E5',
  },
};

/** The words of both files, per language. */
export const EXPORT_COPY = {
  es: {
    locale: 'es-ES',
    question: 'Pregunta',
    who: 'Avery · Chief of Staff',
    summary: 'Resumen',
    questions: 'Preguntas de la conversación',
    date: 'Fecha',
    data: 'Datos',
    questionsCount: 'Preguntas',
    dashboards: 'Dashboards',
    preparedBy: 'Preparado por',
    preparedByValue: 'Avery, Chief of Staff, con su equipo',
    preparedShort: 'preparado por Avery',
    version: 'versión',
    versions: (list: string) => `versiones ${list}`,
    and: 'y',
    widgets: 'widgets',
    rows: 'filas',
    filters: 'filtros',
    allFilters: 'todos en «Todos»',
    allShort: 'todos',
    draft: 'Borrador',
    saved: 'Guardado en Artifacts',
    savedShort: 'Guardado',
    replaced: (n: number, m: number) =>
      `Versión ${n}, reemplazada por la versión ${m}`,
    appendix: 'Apéndice · Cómo se obtuvieron los datos',
    appendixIntro:
      'Cada consulta que el equipo ejecutó sobre los datos, con lo que buscaba y cuántas filas devolvió.',
    appendixNoSql: 'El SQL completo se incluye si lo pides al exportar.',
    queriesTitle: 'Cómo se obtuvieron los datos',
    query: 'consulta',
    queryColumn: 'Consulta',
    purpose: 'Qué busca',
    tables: 'Tablas',
    rowsColumn: 'Filas',
    noQueries: 'Esta conversación no ejecutó consultas sobre los datos.',
    tableCut: (rows: number, of: number, cols: number, ofCols: number) =>
      `Primeras ${rows} de ${of} filas y ${cols} de ${ofCols} columnas; la tabla completa está en las notas.`,
    tableRowsCut: (rows: number, of: number) =>
      `Primeras ${rows} de ${of} filas; la tabla completa está en las notas.`,
    widgetCut: (rows: number, of: number) => `Primeras ${rows} de ${of} filas`,
    questionsShort: 'preguntas',
  },
  en: {
    locale: 'en-US',
    question: 'Question',
    who: 'Avery · Chief of Staff',
    summary: 'Summary',
    questions: "The conversation's questions",
    date: 'Date',
    data: 'Data',
    questionsCount: 'Questions',
    dashboards: 'Dashboards',
    preparedBy: 'Prepared by',
    preparedByValue: 'Avery, Chief of Staff, with her team',
    preparedShort: 'prepared by Avery',
    version: 'version',
    versions: (list: string) => `versions ${list}`,
    and: 'and',
    widgets: 'widgets',
    rows: 'rows',
    filters: 'filters',
    allFilters: 'all at "All"',
    allShort: 'all',
    draft: 'Draft',
    saved: 'Saved to Artifacts',
    savedShort: 'Saved',
    replaced: (n: number, m: number) =>
      `Version ${n}, replaced by version ${m}`,
    appendix: 'Appendix · How the data was obtained',
    appendixIntro:
      'Each query the team ran on the data, with what it looked for and how many rows it returned.',
    appendixNoSql: 'The full SQL is included if you ask for it when exporting.',
    queriesTitle: 'How the data was obtained',
    query: 'query',
    queryColumn: 'Query',
    purpose: 'What it looks for',
    tables: 'Tables',
    rowsColumn: 'Rows',
    noQueries: 'This conversation ran no queries on the data.',
    tableCut: (rows: number, of: number, cols: number, ofCols: number) =>
      `First ${rows} of ${of} rows and ${cols} of ${ofCols} columns; the full table is in the notes.`,
    tableRowsCut: (rows: number, of: number) =>
      `First ${rows} of ${of} rows; the full table is in the notes.`,
    widgetCut: (rows: number, of: number) => `First ${rows} of ${of} rows`,
    questionsShort: 'questions',
  },
} as const;

type Copy = (typeof EXPORT_COPY)[ExportLanguage];

const SPANISH_WORDS =
  /\b(?:que|qué|los|las|del|por|para|una|con|el|la|de|es|en|y|cómo|cuál|cuántos|ahora|crea|haz|muestra)\b/g;
const ENGLISH_WORDS =
  /\b(?:the|of|and|by|for|with|is|are|what|which|how|show|create|now|to|in|a)\b/g;

/** The conversation's language: Spanish when its words are mostly Spanish. */
export function conversationLanguage(texts: readonly string[]): ExportLanguage {
  const text = texts.join(' ').toLowerCase();
  const spanish = text.match(SPANISH_WORDS)?.length ?? 0;
  const english = text.match(ENGLISH_WORDS)?.length ?? 0;
  return spanish > english ? 'es' : 'en';
}

/**
 * The dashboard versions the export shows: each run's dashboard, the latest
 * version of each artifact in full, every earlier one as its first row with
 * the version that replaced it.
 */
export function dashboardVersionsNeeded(
  runs: readonly ExportRun[],
): DashboardVersionNeed[] {
  const made = runs.flatMap((run) =>
    run.answer.dashboard ? [{ runId: run.id, ref: run.answer.dashboard }] : [],
  );
  return made.map(({ runId, ref }) => {
    const later = made
      .map((other) => other.ref)
      .filter(
        (other) =>
          other.artifactId === ref.artifactId && other.version > ref.version,
      )
      .map((other) => other.version)
      .sort((a, b) => a - b);
    return later.length
      ? { runId, ref, latest: false, replacedBy: later[0] }
      : { runId, ref, latest: true };
  });
}

/** The tables a statement reads: `from` and `join` targets, unqualified. */
export function tablesOfSql(sql: string): string[] {
  return [
    ...new Set(
      [...String(sql).matchAll(/\b(?:from|join)\s+([a-z0-9_."]+)/gi)].map(
        (match) => match[1].replace(/"/g, '').split('.').pop() ?? match[1],
      ),
    ),
  ].filter((table) => table && !/^\d/.test(table));
}

/** A turn's queries: its `run_readonly_sql` records, with their tables. */
function queriesOf(answer: ExportRun['answer']): ExportQuery[] {
  return (answer.data ?? []).flatMap((record, index) => {
    if (record.tool !== 'run_readonly_sql' || !record.input) return [];
    const measured = answer.evidence
      ?.find((entry) => entry.index === index)
      ?.tables?.map((table) => table.entity.split('.').pop() ?? table.entity);
    return [
      {
        rationale: record.rationale?.trim() ?? '',
        ...(record.rowCount !== undefined ? { rowCount: record.rowCount } : {}),
        tables: measured?.length ? measured : tablesOfSql(record.input),
        sql: record.input,
      },
    ];
  });
}

/**
 * The export's document: one turn per run (oldest first), each with Avery's
 * headline and points for its number (the question itself when she wrote
 * none), its queries and its dashboard as drawn.
 */
export function exportDocument(input: {
  runs: readonly ExportRun[];
  content: ExportContent;
  brand: ExportBrand;
  /** The drawn dashboards, by run id. */
  dashboards: ReadonlyMap<string, ExportDashboard>;
}): ExportDocument {
  const { runs, content } = input;
  const turns = runs.map((run, index): ExportTurn => {
    const number = index + 1;
    const written = content.turns.find((turn) => turn.number === number);
    const dashboard = input.dashboards.get(run.id);
    return {
      number,
      question: run.question,
      askedAt: run.startedAt,
      headline: written?.headline.trim() || run.question,
      points: written?.points ?? [],
      answer: run.answer.content,
      queries: queriesOf(run.answer),
      ...(dashboard ? { dashboard } : {}),
    };
  });
  return {
    language: conversationLanguage(
      runs.flatMap((run) => [run.question, run.answer.content]),
    ),
    brand: input.brand,
    title: content.title,
    ...(content.subtitle?.trim() ? { subtitle: content.subtitle.trim() } : {}),
    summary: content.summary,
    date: runs[0]?.startedAt ?? new Date().toISOString(),
    datasets: [...new Set(runs.flatMap((run) => run.datasets))],
    includeSql: content.includeSql,
    turns,
  };
}

/** HTML-escaped text. */
export function esc(text: unknown): string {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
}

/** Markdown as HTML, with any raw HTML in it shown as text. */
const answerMarkdown = new Marked({
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => esc(text),
  },
});

/** A date in the file's language ("23 de noviembre de 2026"). */
function day(iso: string, copy: Copy): string {
  return new Date(iso).toLocaleDateString(copy.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** A time of day in the file's language. */
function time(iso: string, copy: Copy): string {
  return new Date(iso).toLocaleTimeString(copy.locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A list in words: "1 y 2", "1, 2 y 3". */
function listed(items: readonly (string | number)[], copy: Copy): string {
  const all = items.map(String);
  return all.length < 2
    ? (all[0] ?? '')
    : `${all.slice(0, -1).join(', ')} ${copy.and} ${all.at(-1)}`;
}

/** The cover's dashboards line: how many, with their versions. */
function dashboardsLine(doc: ExportDocument, copy: Copy): string {
  const byArtifact = new Map<string, number[]>();
  for (const turn of doc.turns) {
    if (!turn.dashboard) continue;
    const { artifactId, version } = turn.dashboard.ref;
    byArtifact.set(artifactId, [
      ...(byArtifact.get(artifactId) ?? []),
      version,
    ]);
  }
  if (!byArtifact.size) return '0';
  const versions = [...byArtifact.values()].map((list) =>
    list.length > 1
      ? copy.versions(listed(list, copy))
      : `${copy.version} ${list[0]}`,
  );
  return `${byArtifact.size} (${versions.join('; ')})`;
}

/** A dashboard's line of facts under its title. */
function dashboardMeta(
  dash: ExportDashboard,
  copy: Copy,
  short = false,
): string {
  const filters = dash.filters.length
    ? dash.filters.join(', ')
    : String(dash.ref.filterCount);
  return [
    ...(short
      ? [
          `${copy.version[0].toUpperCase()}${copy.version.slice(1)} ${dash.ref.version}`,
        ]
      : []),
    `${dash.ref.widgetCount} ${copy.widgets}`,
    ...(short ? [] : [`${dash.ref.rowCount} ${copy.rows}`]),
    short
      ? `${copy.filters}: ${filters} (${copy.allShort})`
      : `${copy.filters}: ${filters}, ${copy.allFilters}`,
    ...(short ? [`${dash.ref.rowCount} ${copy.rows}`] : []),
    dash.status === 'draft' ? copy.draft : short ? copy.savedShort : copy.saved,
  ].join(' · ');
}

/** A table as HTML: every row. */
function tableHtml(table: DashboardTableCapture): string {
  return `<figure class="wtable"><figcaption>${esc(table.title)}</figcaption><table><thead><tr>${table.header
    .map((cell) => `<th>${esc(cell)}</th>`)
    .join('')}</tr></thead><tbody>${table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></figure>`;
}

/** A PNG as a data URI. */
function dataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** A turn's dashboard section in the report. */
function dashboardHtml(dash: ExportDashboard, copy: Copy): string {
  const rows = dash.rows
    .map((row) =>
      [
        ...(row.image
          ? [`<img class="band" alt="" src="${dataUri(row.image.png)}">`]
          : []),
        ...row.tables.map(tableHtml),
      ].join(''),
    )
    .join('');
  const replaced =
    dash.replacedBy !== undefined
      ? `<p class="replaced">${esc(copy.replaced(dash.ref.version, dash.replacedBy))}</p>`
      : '';
  return `<section class="dash"><div class="dh"><span class="badge">Dashboard · ${esc(copy.version)} ${dash.ref.version}</span><h3>${esc(dash.ref.title)}</h3>${
    dash.summary ? `<p>${esc(dash.summary)}</p>` : ''
  }<p class="meta2">${esc(dashboardMeta(dash, copy))}</p>${replaced}</div>${rows}</section>`;
}

/** The report's CSS, in the brand's colours. */
function reportCss(p: ExportPalette): string {
  return `
    @page { size: Letter; margin: 18mm 16mm 20mm; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#${p.fg}; font-size:10.5pt; line-height:1.45; margin:0 }
    .cover { height: 230mm; display:flex; flex-direction:column; justify-content:space-between; page-break-after: always; }
    .brand { display:flex; align-items:center; gap:8px; font-weight:600; color:#${p.fgStrong} } .dot { width:14px; height:14px; border-radius:4px; background:#${p.accent} }
    .cover h1 { font-size:30pt; line-height:1.15; margin:0 0 10px; color:#${p.fgStrong}; letter-spacing:-0.01em } .cover .sub { font-size:14pt; color:#${p.muted}; margin:0 }
    .meta { border-top:3px solid #${p.accent}; padding-top:12px; color:#${p.muted}; font-size:10pt; display:grid; grid-template-columns: 120px 1fr; gap:4px 12px }
    h2.sec { font-size:16pt; color:#${p.fgStrong}; margin:0 0 10px; border-bottom:1px solid #${p.border}; padding-bottom:6px }
    .summary { page-break-after: always } .summary li { margin:0 0 8px }
    .turn { page-break-before: always } .turn:first-of-type { page-break-before: auto }
    .q { background:#${p.surface}; border-left:4px solid #${p.accent}; border-radius:6px; padding:10px 14px; margin:0 0 14px }
    .q .qn { font-size:8.5pt; text-transform:uppercase; letter-spacing:.06em; color:#${p.muted} } .q p { margin:4px 0 0; font-size:13pt; font-weight:600; color:#${p.fgStrong} }
    .headline { font-size:12.5pt; font-weight:600; color:#${p.fgStrong}; margin:0 0 4px } .points { margin:0 0 12px; padding-left:18px } .points li { margin:0 0 3px }
    .who { font-size:8.5pt; text-transform:uppercase; letter-spacing:.06em; color:#${p.accentText}; margin-bottom:4px }
    .a h2 { font-size:12.5pt; margin:16px 0 6px; color:#${p.fgStrong} } .a p { margin:0 0 8px }
    table { border-collapse:collapse; width:100%; font-size:8pt; margin:6px 0 12px; page-break-inside:auto } tr { page-break-inside: avoid }
    th { background:#${p.surface}; text-align:left; font-weight:600 } th, td { border-bottom:1px solid #${p.border}; padding:3px 5px; vertical-align:top }
    .dash { margin:16px 0 0; border-top:1px solid #${p.border}; padding-top:12px } .dash .dh { page-break-after: avoid } .dash h3 { margin:4px 0; font-size:13pt; color:#${p.fgStrong} } .dash p { margin:0 0 4px; font-size:9.5pt } .meta2 { color:#${p.muted}; font-size:8.5pt } .replaced { color:#${p.accentText}; font-weight:600 }
    .badge { display:inline-block; font-size:8pt; font-weight:600; color:#${p.accentText}; background:#${p.accentSoft}; border-radius:999px; padding:2px 8px }
    .band { display:block; width:100%; margin:6px 0 0; page-break-inside: avoid; break-inside: avoid }
    .wtable { margin:10px 0 0 } figcaption { font-size:9pt; font-weight:600; color:#${p.fgStrong}; margin:0 0 2px }
    .appx { page-break-before: always } .qry { margin:0 0 10px; page-break-inside: avoid } .qh { font-weight:600; font-size:9pt } .qry p { margin:2px 0; font-size:9pt; color:#${p.muted} } .qry .tb { font-family: ui-monospace, Menlo, monospace; font-size:8pt }
    pre { font-size:7pt; background:#${p.surface}; padding:6px 8px; border-radius:4px; white-space:pre-wrap; margin:0 }`;
}

/**
 * The HTML report the browser prints as the PDF: the cover, the summary
 * with the conversation's questions, one section per turn (the question,
 * Avery's headline and points, her full answer and its dashboard) and the
 * appendix of queries.
 */
export function exportHtml(doc: ExportDocument): string {
  const copy = EXPORT_COPY[doc.language];
  const palette = EXPORT_PALETTES[doc.brand];
  const turns = doc.turns
    .map(
      (turn) => `<section class="turn">
      <div class="q"><span class="qn">${esc(copy.question)} ${turn.number} · ${esc(time(turn.askedAt, copy))}</span><p>${esc(turn.question)}</p></div>
      <p class="headline">${esc(turn.headline)}</p>${
        turn.points.length
          ? `<ul class="points">${turn.points.map((point) => `<li>${esc(point)}</li>`).join('')}</ul>`
          : ''
      }
      <div class="a"><div class="who">${esc(copy.who)}</div>${answerMarkdown.parse(turn.answer, { async: false })}</div>
      ${turn.dashboard ? dashboardHtml(turn.dashboard, copy) : ''}
    </section>`,
    )
    .join('\n');
  const queries = doc.turns.flatMap((turn) =>
    turn.queries.map((query, index) => ({ turn: turn.number, index, query })),
  );
  const appendix = queries.length
    ? queries
        .map(
          ({ turn, index, query }) =>
            `<div class="qry"><div class="qh">${esc(copy.question[0])}${turn} · ${esc(copy.query)} ${index + 1}${
              query.rowCount !== undefined
                ? ` · ${query.rowCount} ${esc(copy.rows)}`
                : ''
            }</div><p>${esc(query.rationale)}</p><p class="tb">${esc(copy.tables)}: ${esc(query.tables.join(', '))}</p>${
              doc.includeSql ? `<pre>${esc(query.sql)}</pre>` : ''
            }</div>`,
        )
        .join('')
    : `<p>${esc(copy.noQueries)}</p>`;
  return `<!doctype html><html lang="${doc.language}"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${reportCss(palette)}
  </style></head><body>
    <section class="cover">
      <div class="brand"><span class="dot"></span>${esc(palette.name)}</div>
      <div><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}</div>
      <div class="meta"><span>${esc(copy.date)}</span><span>${esc(day(doc.date, copy))}</span><span>${esc(copy.data)}</span><span>${esc(doc.datasets.join(', ') || '—')}</span><span>${esc(copy.questionsCount)}</span><span>${doc.turns.length}</span><span>${esc(copy.dashboards)}</span><span>${esc(dashboardsLine(doc, copy))}</span><span>${esc(copy.preparedBy)}</span><span>${esc(copy.preparedByValue)}</span></div>
    </section>
    <section class="summary"><h2 class="sec">${esc(copy.summary)}</h2><ul>${doc.summary.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <h2 class="sec" style="margin-top:22px">${esc(copy.questions)}</h2><ol>${doc.turns.map((turn) => `<li>${esc(turn.question)}</li>`).join('')}</ol></section>
    ${turns}
    <section class="appx"><h2 class="sec">${esc(copy.appendix)}</h2><p style="color:#${palette.muted};font-size:9pt;margin:0 0 12px">${esc(copy.appendixIntro)}${
      doc.includeSql ? '' : ` ${esc(copy.appendixNoSql)}`
    }</p>${appendix}</section>
  </body></html>`;
}

/** The PDF's footer: the title, then the page of the total. */
export function exportFooterHtml(doc: ExportDocument): string {
  const palette = EXPORT_PALETTES[doc.brand];
  return `<div style="font-size:7pt;color:#${palette.muted};width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Helvetica"><span>${esc(doc.title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

/** A cell of a native table: text, bold on a shaded header. */
export interface SlideCell {
  text: string;
  header?: boolean;
}

/** One thing drawn on a slide (inches, on the 13.33 × 7.5 wide layout). */
export type SlideItem =
  | {
      kind: 'text';
      text: string | string[];
      x: number;
      y: number;
      w: number;
      h: number;
      size: number;
      color: string;
      bold?: boolean;
      bullets?: boolean;
      align?: 'left' | 'right';
    }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'image'; png: Buffer; x: number; y: number; w: number; h: number }
  | {
      kind: 'table';
      rows: SlideCell[][];
      x: number;
      y: number;
      w: number;
      size: number;
      colW?: number[];
    };

/** A slide: what it draws, and its speaker notes. */
export interface SlideSpec {
  items: SlideItem[];
  notes?: string;
}

/** The slide layout (LAYOUT_WIDE, inches). */
const SLIDE = { width: 13.33, contentW: 12.1, contentH: 5.1, top: 1.6 };
/** The most rows and columns of an answer's table on a slide. */
const ANSWER_TABLE_ROWS = 11;
const ANSWER_TABLE_COLS = 6;
/** The most rows and columns of a table widget on a slide. */
const WIDGET_TABLE_ROWS = 12;
const WIDGET_TABLE_COLS = 10;
/** The most queries on one queries slide. */
const QUERIES_PER_SLIDE = 12;

/** The first table of a markdown answer, as text. */
export function firstMarkdownTable(
  markdown: string,
): { header: string[]; rows: string[][] } | undefined {
  const token = marked
    .lexer(markdown ?? '')
    .find((t): t is Tokens.Table => t.type === 'table');
  if (!token) return undefined;
  const plain = (text: string) => text.replace(/\*\*/g, '').trim();
  return {
    header: token.header.map((cell) => plain(cell.text)),
    rows: token.rows.map((row) => row.map((cell) => plain(cell.text))),
  };
}

/** A native table's rows: the header shaded, then the body. */
function tableRows(header: string[], rows: string[][]): SlideCell[][] {
  return [
    header.map((text) => ({ text, header: true })),
    ...rows.map((row) => row.map((text) => ({ text }))),
  ];
}

/**
 * The PowerPoint's slides (agents.md 3.18): a cover; a summary; per turn
 * its headline with points and the answer's first table (≤ 6 columns, ≤ 11
 * rows, a note when cut) and the full answer as speaker notes; a
 * dashboard's widget rows packed onto slides (≤ 5.1 in high each) with its
 * table widgets as native tables; an earlier dashboard version as its first
 * row with the version that replaced it; and the queries.
 */
export function exportSlides(doc: ExportDocument): SlideSpec[] {
  const copy = EXPORT_COPY[doc.language];
  const p = EXPORT_PALETTES[doc.brand];
  const slides: SlideSpec[] = [];
  const text = (
    value: string | string[],
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
    color: string,
    extra: Partial<Extract<SlideItem, { kind: 'text' }>> = {},
  ): SlideItem => ({
    kind: 'text',
    text: value,
    x,
    y,
    w,
    h,
    size,
    color,
    ...extra,
  });
  const head = (turn: ExportTurn, headline: string): SlideItem[] => [
    text(
      `${copy.question} ${turn.number} · ${turn.question}`
        .toUpperCase()
        .slice(0, 140),
      0.6,
      0.3,
      12,
      0.4,
      11,
      p.accent,
      { bold: true },
    ),
    text(headline, 0.6, 0.7, 12, 0.8, 26, p.fgStrong, { bold: true }),
  ];

  slides.push({
    items: [
      { kind: 'rect', x: 0, y: 0, w: 0.25, h: 7.5, color: p.accent },
      text(p.name, 0.8, 0.6, 6, 0.4, 14, p.fgStrong, { bold: true }),
      text(doc.title, 0.8, 2.3, 11.5, 1.6, 40, p.fgStrong, { bold: true }),
      ...(doc.subtitle
        ? [text(doc.subtitle, 0.8, 3.9, 11, 0.9, 18, p.muted)]
        : []),
      text(
        [
          day(doc.date, copy),
          ...(doc.datasets.length ? [doc.datasets.join(', ')] : []),
          `${doc.turns.length} ${copy.questionsShort}`,
          copy.preparedShort,
        ].join(' · '),
        0.8,
        6.3,
        11,
        0.4,
        12,
        p.muted,
      ),
    ],
  });
  slides.push({
    items: [
      text(copy.summary, 0.6, 0.4, 12, 0.7, 28, p.fgStrong, { bold: true }),
      text(doc.summary, 0.6, 1.4, 12, 5.2, 18, p.fgStrong, { bullets: true }),
    ],
  });

  for (const turn of doc.turns) {
    const dash = turn.dashboard;
    const table = firstMarkdownTable(turn.answer);
    // The headline slide: every turn but a dashboard's with nothing more to say.
    const headlineSlide = !dash || turn.points.length > 0 || !!table;
    if (headlineSlide) {
      const items: SlideItem[] = [...head(turn, turn.headline)];
      if (turn.points.length) {
        items.push(
          text(turn.points, 0.6, SLIDE.top, table ? 4.6 : 12, 5, 15, p.fg, {
            bullets: true,
          }),
        );
      }
      if (table) {
        const cols = Math.min(table.header.length, ANSWER_TABLE_COLS);
        const rows = table.rows.slice(0, ANSWER_TABLE_ROWS);
        const x = turn.points.length ? 5.5 : 0.6;
        const w = turn.points.length ? 7.2 : 12.1;
        items.push({
          kind: 'table',
          rows: tableRows(
            table.header.slice(0, cols),
            rows.map((row) => row.slice(0, cols)),
          ),
          x,
          y: SLIDE.top,
          w,
          size: 9,
        });
        if (table.rows.length > rows.length || table.header.length > cols) {
          items.push(
            text(
              table.header.length > cols
                ? copy.tableCut(
                    rows.length,
                    table.rows.length,
                    cols,
                    table.header.length,
                  )
                : copy.tableRowsCut(rows.length, table.rows.length),
              x,
              6.75,
              w,
              0.25,
              9,
              p.muted,
            ),
          );
        }
      }
      slides.push({ items, notes: turn.answer });
    }
    if (!dash) continue;
    const meta =
      dash.replacedBy !== undefined
        ? copy.replaced(dash.ref.version, dash.replacedBy)
        : dashboardMeta(dash, copy, true);
    // Pack the widget rows: 12.1 in wide at most, 5.1 in high per slide.
    const pages: { images: { png: Buffer; w: number; h: number }[] }[] = [];
    let used = 0;
    const tables: DashboardTableCapture[] = [];
    for (const row of dash.rows) {
      tables.push(...row.tables);
      if (!row.image) continue;
      let w = SLIDE.contentW;
      let h = (row.image.height * SLIDE.contentW) / row.image.width;
      if (h > SLIDE.contentH) {
        h = SLIDE.contentH;
        w = (SLIDE.contentH * row.image.width) / row.image.height;
      }
      if (!pages.length || (used > 0 && used + h > SLIDE.contentH)) {
        pages.push({ images: [] });
        used = 0;
      }
      pages[pages.length - 1].images.push({ png: row.image.png, w, h });
      used += h + 0.05;
    }
    const total = pages.length + tables.length;
    let k = 0;
    const title = (index: number) =>
      index === 0 && !headlineSlide
        ? turn.headline
        : `${dash.ref.title} (${index + 1}/${total})`;
    for (const page of pages) {
      const items = head(turn, title(k));
      let y = SLIDE.top;
      for (const image of page.images) {
        items.push({
          kind: 'image',
          png: image.png,
          x: (SLIDE.width - image.w) / 2,
          y,
          w: image.w,
          h: image.h,
        });
        y += image.h + 0.05;
      }
      items.push(text(meta, 0.6, 6.8, 12, 0.25, 9, p.muted));
      slides.push({
        items,
        ...(k === 0 && !headlineSlide ? { notes: turn.answer } : {}),
      });
      k += 1;
    }
    for (const widget of tables) {
      const cols = Math.min(widget.header.length, WIDGET_TABLE_COLS);
      const rows = widget.rows.slice(0, WIDGET_TABLE_ROWS);
      const items = head(turn, title(k));
      items.push(
        text(widget.title, 0.6, 1.5, 12, 0.35, 14, p.fgStrong, { bold: true }),
      );
      items.push({
        kind: 'table',
        rows: tableRows(
          widget.header.slice(0, cols),
          rows.map((row) => row.slice(0, cols)),
        ),
        x: 0.6,
        y: 1.9,
        w: SLIDE.contentW,
        size: 8,
      });
      if (widget.rows.length > rows.length) {
        items.push(
          text(
            copy.widgetCut(rows.length, widget.rows.length),
            0.6,
            6.5,
            12,
            0.25,
            9,
            p.muted,
          ),
        );
      }
      items.push(text(meta, 0.6, 6.8, 12, 0.25, 9, p.muted));
      slides.push({
        items,
        ...(k === 0 && !headlineSlide ? { notes: turn.answer } : {}),
      });
      k += 1;
    }
  }

  const queries = doc.turns.flatMap((turn) =>
    turn.queries.map((query, index) => [
      `${copy.question[0]}${turn.number}.${index + 1}`,
      query.rationale.slice(0, 140),
      query.tables.join(', '),
      query.rowCount !== undefined ? String(query.rowCount) : '',
    ]),
  );
  const chunks: string[][][] = [];
  for (let at = 0; at < queries.length; at += QUERIES_PER_SLIDE) {
    chunks.push(queries.slice(at, at + QUERIES_PER_SLIDE));
  }
  if (!chunks.length) chunks.push([]);
  for (const chunk of chunks) {
    const items: SlideItem[] = [
      text(copy.queriesTitle, 0.6, 0.4, 12, 0.7, 28, p.fgStrong, {
        bold: true,
      }),
    ];
    items.push(
      chunk.length
        ? {
            kind: 'table',
            rows: tableRows(
              [copy.queryColumn, copy.purpose, copy.tables, copy.rowsColumn],
              chunk,
            ),
            x: 0.6,
            y: 1.3,
            w: SLIDE.contentW,
            size: 8.5,
            colW: [0.9, 7.6, 2.8, 0.8],
          }
        : text(copy.noQueries, 0.6, 1.4, 12, 0.5, 16, p.muted),
    );
    slides.push({ items });
  }
  return slides;
}
