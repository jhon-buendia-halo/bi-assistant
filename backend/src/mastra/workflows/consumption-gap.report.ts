/**
 * The report of Consumption Gap Analysis (agents.md 5.20): the interactive
 * visual (a fixed runtime, no model writes markup, as for 5.17) and the
 * run's answer, both built in code from the run's checked data. Pure code,
 * no framework import.
 */
import type {
  GapFix,
  GapStatus,
  LayerSchemaNote,
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';
import {
  GAP_REPORT_CSS,
  GAP_REPORT_ROOT_ID,
  GAP_REPORT_RUNTIME,
} from './consumption-gap.report-runtime';
import type { MockBundle } from './recreate-dashboard.steps';

/** Everything the report shows. */
export interface GapReport {
  questions: string[];
  datasets: string[];
  layers: LayerSchemaNote[];
  tables: LayerTable[];
  lineage: Lineage;
  dashboards: ReferenceDashboard[];
  requirements: Requirement[];
  assessments: RequirementAssessment[];
  fixes: GapFix[];
  probeCount: number;
}

const STATUS_LABEL: Record<GapStatus, string> = {
  supported: 'Supported',
  derivable: 'Derivable',
  grain: 'Grain / coverage',
  'normalized-only': 'In Normalized only',
  'landing-only': 'In Landing only',
  missing: 'No source',
};

const LAYER_LABEL: Record<string, string> = {
  landing: 'Landing',
  normalized: 'Normalized',
  consumption: 'Consumption',
  source: 'New source',
};

/** The layers a fix can start in, in the order the report lists them. */
const FIX_LAYER_ORDER: GapFix['startsIn'][] = [
  'consumption',
  'normalized',
  'landing',
  'source',
];

function consumptionSchemas(report: GapReport): string[] {
  return report.layers
    .filter((l) => l.layer === 'consumption')
    .map((l) => l.schemaKey);
}

/** The report's title: `Consumption gap analysis: <consumption schema(s)>`. */
export function gapReportTitle(report: GapReport): string {
  const schemas = consumptionSchemas(report);
  return `Consumption gap analysis: ${schemas.length ? schemas.join(', ') : 'Consumption'}`;
}

/** JSON that is safe inside a `<script>`: no `<`, no line separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
}

function statusOf(report: GapReport, requirementId: string): GapStatus {
  return (
    report.assessments.find((a) => a.requirementId === requirementId)?.status ??
    'missing'
  );
}

function statusCounts(report: GapReport): Record<GapStatus, number> {
  const counts: Record<GapStatus, number> = {
    supported: 0,
    derivable: 0,
    grain: 0,
    'normalized-only': 0,
    'landing-only': 0,
    missing: 0,
  };
  for (const r of report.requirements) counts[statusOf(report, r.id)] += 1;
  return counts;
}

/**
 * The report drawn by the fixed runtime (./consumption-gap.report-runtime.ts):
 * html `<div id="gap-report-root" class="gap"></div>`, the runtime's css,
 * and its javascript followed by one `window.gapReport.mount(<root>, <report>)`
 * call with the report as JSON made safe for a script.
 */
export function renderGapReportBundle(report: GapReport): MockBundle {
  const counts = statusCounts(report);
  const total = report.requirements.length;
  const ok = counts.supported + counts.derivable;
  return {
    title: gapReportTitle(report),
    description: `${total} requirements checked against the consumption layer: ${ok} can be answered as is, ${total - ok} have a gap. ${report.fixes.length} fixes are proposed; none was run.`,
    html: `<div id="${GAP_REPORT_ROOT_ID}" class="gap"></div>`,
    css: GAP_REPORT_CSS,
    javascript: [
      GAP_REPORT_RUNTIME,
      `window.gapReport.mount(document.getElementById(${JSON.stringify(GAP_REPORT_ROOT_ID)}), ${scriptJson(report)});`,
    ].join('\n'),
  };
}

/** A value as one Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

/** `schema.table`: the last two segments of an entity. */
function shortEntity(entity: string): string {
  return entity.split('.').slice(-2).join('.');
}

/** Where a requirement's fields are found, one entry per distinct source. */
function foundIn(report: GapReport, requirementId: string): string {
  const known = new Set(report.tables.map((t) => t.entity));
  const parts = new Set<string>();
  const assessment = report.assessments.find(
    (a) => a.requirementId === requirementId,
  );
  for (const f of assessment?.fields ?? []) {
    const src = f.consumption ?? f.upstream;
    if (!src || !known.has(src.entity)) continue;
    const text = `${shortEntity(src.entity)}.${src.column}`;
    parts.add(
      src.layer === 'consumption'
        ? text
        : `${text} (${LAYER_LABEL[src.layer]})`,
    );
  }
  return [...parts].join('; ');
}

/** The run's answer, Markdown, built in code (never names a column the catalogs lack). */
export function gapAnswer(report: GapReport): string {
  const reqs = report.requirements;
  const byKind = (kind: Requirement['kind']) =>
    reqs.filter((r) => r.kind === kind).length;
  const schemas = consumptionSchemas(report);
  const counts = statusCounts(report);
  const lines: string[] = [
    `Checked **${reqs.length} requirements** (${byKind('question')} questions, ${byKind('widget')} widgets, ${byKind('filter')} filters) against **${schemas.length ? schemas.join(', ') : 'the consumption layer'}**.`,
    '',
    `**Result:** ${(Object.keys(STATUS_LABEL) as GapStatus[])
      .map((s) => `${counts[s]} ${STATUS_LABEL[s]}`)
      .join(', ')}.`,
    '',
    '| # | Requirement | Status | Found in | Evidence | Fix |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of reqs) {
    const a = report.assessments.find((x) => x.requirementId === r.id);
    const fixIds = report.fixes
      .filter((f) => f.closes.includes(r.id))
      .map((f) => f.id)
      .join(', ');
    lines.push(
      `| ${r.id} | ${cell(r.title)} | ${STATUS_LABEL[statusOf(report, r.id)]} | ${cell(foundIn(report, r.id))} | ${cell(a?.evidence || a?.reason || '')} | ${fixIds || '—'} |`,
    );
  }
  lines.push('', '**Fixes**');
  if (!report.fixes.length) lines.push('', 'No fix is needed.');
  for (const layer of FIX_LAYER_ORDER) {
    const group = report.fixes.filter((f) => f.startsIn === layer);
    if (!group.length) continue;
    lines.push(
      '',
      `*Starts in ${layer === 'source' ? 'a new source' : LAYER_LABEL[layer]}*`,
    );
    for (const f of group) {
      lines.push(
        `- **${f.id}** ${f.title} — closes ${f.closes.join(', ')}. ${f.why}`,
      );
    }
  }
  const edges = report.lineage.edges;
  const confirmed = edges.filter((e) => e.method === 'values').length;
  lines.push(
    '',
    `Lineage was inferred: ${edges.length} column edges, ${confirmed} confirmed by matching values, ${report.lineage.failedChecks} checks failed.`,
    '',
    `Evidence came from ${report.probeCount} read-only queries: no query changed any data, and the proposed changes were not run.`,
  );
  return lines.join('\n');
}
