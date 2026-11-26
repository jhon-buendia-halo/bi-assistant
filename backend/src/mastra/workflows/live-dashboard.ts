/**
 * A live dashboard: an artifact version drawn by the fixed runtime
 * (./dashboard-blueprint.runtime.ts) on the row snapshot of the user's data
 * that version keeps, in the app and as a download of plain HTML, JS and
 * CSS. A version without rows is drawn on the mock rows.
 *
 * Plain strings, no framework import. No model output is markup or code
 * here: the titles and values reach the page as text or as escaped JSON.
 */
import type { ZipEntry } from '../../common/zip-archive';
import { standaloneFrameCss } from '../../modules/sessions/frame-theme';
import {
  DASHBOARD_MOCK_CSS,
  DASHBOARD_MOCK_ROOT_ID,
  DASHBOARD_MOCK_RUNTIME,
} from './dashboard-blueprint.runtime';
import type { DashboardBlueprint } from './dashboard-blueprint.schemas';

/** A drawn dashboard: an interactive visual's freeform bundle. */
export interface MockBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
}

/** One row of a dashboard's data: numbers already numbers, dates ISO. */
export type DashboardRow = Record<string, string | number | boolean | null>;

/** The query a live version's rows came from. */
export interface DashboardQuery {
  sql: string;
  datasourceId: string;
  rationale?: string;
}

/** The longest file-name slug of a download, in characters. */
const SLUG_MAX_LENGTH = 64;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** JSON that is safe inside a `<script>`: no `<`, no line separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `1 row`, `1,234 rows`. */
function rowsText(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`;
}

/** `22 Nov 2026`, in UTC; the raw value when it is not a date. */
function dayOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** A name as a file-name slug: lower case `a-z`, `0-9` and `-`, at most 64. */
export function dashboardSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * A dashboard drawn on its rows (api.md 145): the fixed runtime and style
 * sheet with the blueprint and the rows embedded as data. Null rows draw
 * the mock on invented values (a dashboard saved without rows).
 */
export function renderLiveDashboardBundle(
  blueprint: DashboardBlueprint,
  rows: DashboardRow[] | null,
): MockBundle {
  return {
    title: blueprint.title,
    description: rows
      ? [
          blueprint.summary,
          `Drawn from ${rowsText(rows.length)} of your data. The filters recompute the widgets they filter.`,
        ]
          .filter(Boolean)
          .join(' ')
      : `${blueprint.summary || 'An interactive mock of the dashboard, on invented data.'} Every value shown is invented. The filters recompute the widgets they filter.`,
    html: `<div id="${DASHBOARD_MOCK_ROOT_ID}" class="dmk"></div>`,
    css: DASHBOARD_MOCK_CSS,
    javascript: [
      DASHBOARD_MOCK_RUNTIME,
      `window.dashMock.mount(document.getElementById(${JSON.stringify(DASHBOARD_MOCK_ROOT_ID)}), ${scriptJson(rows ? { blueprint, mapping: null, rows, live: true } : { blueprint, mapping: null })});`,
    ].join('\n'),
  };
}

/** The page around the dashboard in a download: type, spacing, the footer. */
const PAGE_CSS = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--qti-fg);
}
.ldb-page { max-width: 1280px; margin: 0 auto; padding: 24px 24px 40px; box-sizing: border-box; }
.ldb-summary { margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: var(--qti-fg-muted); }
.ldb-footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--qti-border);
  font-size: 12px; color: var(--qti-fg-muted); }
@media (max-width: 640px) { .ldb-page { padding: 16px 14px 32px; } }
`;

export interface DashboardArchiveInput {
  /** The artifact's id: names the zip when the name gives no slug. */
  id?: string;
  name: string;
  version: number;
  blueprint: DashboardBlueprint;
  /** The version's rows; null for a version drawn on invented values. */
  rows: DashboardRow[] | null;
  query?: DashboardQuery;
  /** When the version was made (ISO). */
  createdAt: string;
}

/**
 * A dashboard version as a zip of plain files (api.md 165) that opens from
 * the file system: no server, no CDN, no inline script. `data.js` holds the
 * blueprint and the rows as escaped JSON; `app.js` is the fixed runtime.
 */
export function dashboardArchive(input: DashboardArchiveInput): {
  filename: string;
  entries: ZipEntry[];
} {
  const live = input.rows !== null;
  const slug =
    dashboardSlug(input.name) ||
    (input.id ? `dashboard-${input.id.slice(0, 8)}` : 'dashboard');
  const day = dayOf(input.createdAt);
  const extent = live ? rowsText(input.rows?.length ?? 0) : 'invented data';
  const footer = `Version ${input.version} · ${day} · ${extent}`;
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.name)}</title>`,
    '<link rel="stylesheet" href="styles.css">',
    '</head>',
    '<body>',
    '<main class="ldb-page">',
    ...(input.blueprint.summary
      ? [`<p class="ldb-summary">${escapeHtml(input.blueprint.summary)}</p>`]
      : []),
    `<div id="${DASHBOARD_MOCK_ROOT_ID}" class="dmk"></div>`,
    `<footer class="ldb-footer">${escapeHtml(footer)}</footer>`,
    '</main>',
    '<script src="data.js"></script><script src="app.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  const readme = [
    input.name,
    '',
    `Version ${input.version}, made ${day}.`,
    live
      ? `Drawn from ${rowsText(input.rows?.length ?? 0)} of your data, as they were when this version was made.`
      : 'This version has no data of its own: the values are invented, to show the layout.',
    '',
    'To open it: unzip the folder and open index.html in a web browser.',
    'It needs no server and no internet connection. The filters recompute',
    'the widgets they filter.',
    '',
    'Files:',
    '  index.html  the page',
    '  styles.css  its styles',
    '  app.js      the script that draws the dashboard',
    '  data.js     the dashboard and its rows',
    ...(live && input.query
      ? ['  query.sql   the query the rows came from']
      : []),
    '',
  ].join('\n');
  const entries: ZipEntry[] = [
    { name: 'index.html', data: html },
    {
      name: 'styles.css',
      data: `${standaloneFrameCss()}${PAGE_CSS}${DASHBOARD_MOCK_CSS}\n`,
    },
    {
      name: 'app.js',
      data: `${DASHBOARD_MOCK_RUNTIME}\nwindow.dashMock.mount(document.getElementById(${JSON.stringify(DASHBOARD_MOCK_ROOT_ID)}), window.DASHBOARD_DATA);\n`,
    },
    {
      name: 'data.js',
      data: `window.DASHBOARD_DATA = ${scriptJson({
        blueprint: input.blueprint,
        mapping: null,
        rows: input.rows,
        live,
      })};\n`,
    },
    ...(live && input.query
      ? [{ name: 'query.sql', data: `${input.query.sql.trim()}\n` }]
      : []),
    { name: 'README.txt', data: readme },
  ];
  return { filename: `${slug}-v${input.version}.zip`, entries };
}
