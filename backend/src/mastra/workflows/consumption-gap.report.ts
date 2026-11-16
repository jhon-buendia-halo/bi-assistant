/**
 * The report of Consumption Gap Analysis (agents.md 5.20): the interactive
 * visual (a fixed runtime, no model writes markup, as for 5.17) and the
 * run's answer, both built in code from the run's checked data. Pure code,
 * no framework import.
 *
 * CONTRACT STUB: the signatures below are the contract; the bodies are
 * written by the report unit.
 */
import type {
  GapFix,
  LayerSchemaNote,
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';
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

/** The report's title: `Consumption gap analysis: <consumption schema(s)>`. */
export function gapReportTitle(report: GapReport): string {
  void report;
  throw new Error('not implemented');
}

/**
 * The report drawn by the fixed runtime (./consumption-gap.report-runtime.ts):
 * html `<div id="gap-report-root" class="gap"></div>`, the runtime's css,
 * and its javascript followed by one `window.gapReport.mount(<root>, <report>)`
 * call with the report as JSON made safe for a script.
 */
export function renderGapReportBundle(report: GapReport): MockBundle {
  void report;
  throw new Error('not implemented');
}

/** The run's answer, Markdown, built in code (never names a column the catalogs lack). */
export function gapAnswer(report: GapReport): string {
  void report;
  throw new Error('not implemented');
}
