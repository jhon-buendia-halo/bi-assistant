import {
  gapFixSchema,
  lineageSchema,
  requirementAssessmentSchema,
  requirementSchema,
  referenceDashboardSchema,
} from './consumption-gap-analysis.schemas';
import {
  gapAnswer,
  gapReportTitle,
  renderGapReportBundle,
  type GapReport,
} from './consumption-gap.report';
import { GAP_REPORT_RUNTIME } from './consumption-gap.report-runtime';
import { SAMPLE_GAP_REPORT } from './consumption-gap.sample';

/** The sample with one requirement's title replaced by hostile text. */
function withTitle(title: string): GapReport {
  return {
    ...SAMPLE_GAP_REPORT,
    requirements: SAMPLE_GAP_REPORT.requirements.map((r, i) =>
      i === 0 ? { ...r, title } : r,
    ),
  };
}

describe('the World Cup sample', () => {
  it('is valid against the contract', () => {
    for (const r of SAMPLE_GAP_REPORT.requirements) requirementSchema.parse(r);
    for (const a of SAMPLE_GAP_REPORT.assessments)
      requirementAssessmentSchema.parse(a);
    for (const f of SAMPLE_GAP_REPORT.fixes) gapFixSchema.parse(f);
    for (const d of SAMPLE_GAP_REPORT.dashboards)
      referenceDashboardSchema.parse(d);
    lineageSchema.parse(SAMPLE_GAP_REPORT.lineage);
  });

  it('only names entities, columns and requirements that exist', () => {
    const columns = new Set(
      SAMPLE_GAP_REPORT.tables.flatMap((t) =>
        t.columns.map((c) => `${t.entity}|${c.name}`),
      ),
    );
    for (const e of SAMPLE_GAP_REPORT.lineage.edges) {
      expect(columns).toContain(`${e.from.entity}|${e.from.column}`);
      expect(columns).toContain(`${e.to.entity}|${e.to.column}`);
    }
    const ids = new Set(SAMPLE_GAP_REPORT.requirements.map((r) => r.id));
    for (const f of SAMPLE_GAP_REPORT.fixes)
      for (const id of f.closes) expect(ids).toContain(id);
    expect(SAMPLE_GAP_REPORT.assessments.map((a) => a.requirementId)).toEqual([
      ...ids,
    ]);
  });
});

describe('gapReportTitle', () => {
  it('names the consumption schema', () => {
    expect(gapReportTitle(SAMPLE_GAP_REPORT)).toBe(
      'Consumption gap analysis: world_cup.wc_consumption',
    );
  });
});

describe('renderGapReportBundle', () => {
  const bundle = renderGapReportBundle(SAMPLE_GAP_REPORT);

  it('has a root div, the css, and the runtime then exactly one mount call', () => {
    expect(bundle.html).toBe('<div id="gap-report-root" class="gap"></div>');
    expect(bundle.css).toContain('.gap-card');
    expect(bundle.javascript.startsWith(GAP_REPORT_RUNTIME)).toBe(true);
    expect(bundle.javascript.match(/window\.gapReport\.mount\(/g)).toHaveLength(
      1,
    );
    expect(bundle.title).toBe(gapReportTitle(SAMPLE_GAP_REPORT));
    expect(bundle.description).toContain('15 requirements');
  });

  it('keeps the runtime free of innerHTML and network calls', () => {
    expect(GAP_REPORT_RUNTIME).not.toMatch(
      /innerHTML|insertAdjacentHTML|document\.write|fetch\(|XMLHttpRequest|eval\(/,
    );
  });

  it('cannot be closed or commented out by the data', () => {
    const hostile = renderGapReportBundle(
      withTitle(
        `</script><script>alert(1)</script><!-- ${'\u2028'}${'\u2029'}`,
      ),
    );
    const embedded = hostile.javascript.slice(GAP_REPORT_RUNTIME.length);
    expect(embedded).not.toContain('</script>');
    expect(embedded).not.toContain('<!--');
    expect(embedded).not.toContain('\u2028');
    expect(embedded).not.toContain('\u2029');
    expect(embedded).toContain('\\u003c/script>');
    expect(embedded).toContain('\\u2028');
  });

  it('carries a title as data, never as markup', () => {
    const hostile = renderGapReportBundle(withTitle('<img src=x onerror=1>'));
    expect(hostile.html).toBe(bundle.html);
    expect(hostile.html).not.toContain('img');
    expect(hostile.javascript).not.toContain('<img');
    expect(hostile.javascript).toContain('\\u003cimg src=x onerror=1>');
  });
});

describe('gapAnswer', () => {
  const answer = gapAnswer(SAMPLE_GAP_REPORT);
  const lines = answer.split('\n');

  it('opens with what was checked, and the count per status', () => {
    expect(lines[0]).toBe(
      'Checked **15 requirements** (6 questions, 7 widgets, 2 filters) against **world_cup.wc_consumption**.',
    );
    expect(answer).toContain(
      '**Result:** 3 Supported, 1 Derivable, 3 Grain / coverage, 5 In Normalized only, 2 In Landing only, 1 No source.',
    );
  });

  it('has a table with one row per requirement', () => {
    expect(answer).toContain(
      '| # | Requirement | Status | Found in | Evidence | Fix |',
    );
    for (const r of SAMPLE_GAP_REPORT.requirements) {
      expect(lines.filter((l) => l.startsWith(`| ${r.id} |`))).toHaveLength(1);
    }
    const q5 = lines.find((l) => l.startsWith('| Q5 |'));
    expect(q5).toContain('In Landing only');
    expect(q5).toContain('wc_landing.raw_matches.attendance_str (Landing)');
    expect(q5).toContain('| X5 |');
    const q6 = lines.find((l) => l.startsWith('| Q6 |'));
    expect(q6).toContain('| No source | — |');
    const q2 = lines.find((l) => l.startsWith('| Q2 |'));
    expect(q2).toContain('wc_consumption.agg_team_tournament.goals_for');
  });

  it('lists the fixes grouped by the layer they start in', () => {
    const at = (text: string) => answer.indexOf(text);
    expect(at('*Starts in Consumption*')).toBeGreaterThan(at('**Fixes**'));
    expect(at('*Starts in Normalized*')).toBeGreaterThan(
      at('*Starts in Consumption*'),
    );
    expect(at('*Starts in a new source*')).toBeGreaterThan(
      at('*Starts in Normalized*'),
    );
    expect(answer).not.toContain('*Starts in Landing*');
    expect(answer).toMatch(
      /- \*\*X2\*\* New Consumption fact at goal grain: fct_goals — closes Q3, W4, W5, W7\. Four requirements/,
    );
  });

  it('never names an entity that is not in the tables', () => {
    const known = new Set(
      SAMPLE_GAP_REPORT.tables.map((t) =>
        t.entity.split('.').slice(-2).join('.'),
      ),
    );
    const named = answer.match(/\bwc_(?:landing|normalized|consumption)\.\w+/g);
    expect(named?.length).toBeGreaterThan(0);
    for (const n of named ?? []) expect(known).toContain(n);

    const foreign: GapReport = {
      ...SAMPLE_GAP_REPORT,
      tables: SAMPLE_GAP_REPORT.tables.filter(
        (t) => !t.entity.endsWith('agg_team_tournament'),
      ),
    };
    expect(gapAnswer(foreign)).not.toContain('agg_team_tournament.');
  });

  it('ends with the lineage line and that nothing was changed or run', () => {
    expect(answer).toContain(
      'Lineage was inferred: 30 column edges, 20 confirmed by matching values, 1 checks failed.',
    );
    expect(lines[lines.length - 1]).toBe(
      'Evidence came from 12 read-only queries: no query changed any data, and the proposed changes were not run.',
    );
  });

  it('keeps a pipe in a title inside its cell', () => {
    const row = gapAnswer(withTitle('a | b'))
      .split('\n')
      .find((l) => l.startsWith('| Q1 |'));
    expect(row).toContain('a \\| b');
  });
});
