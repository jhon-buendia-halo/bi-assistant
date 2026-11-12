/**
 * The deep-analysis run workflow (agents.md 2.7, 5.15; plan 1.25.3): its step
 * catalogue, the contract between its agent steps and the run code, and the
 * pure code of its steps (the plan's cap, each angle's findings, the report's
 * assembly). Plain data and functions, no framework import, so the catalogue,
 * the run code and Jest can read it without loading Mastra; the workflow
 * itself is built in ./deep-analysis.workflow.ts.
 */
import type { WorkflowStepEntry } from './qti-v2-turn.steps';

/** The workflow's registry key and id. */
export const DEEP_ANALYSIS_WORKFLOW_ID = 'deep-analysis';

/** The agent its three agent steps call (agents.md 2.7). */
export const DEEP_ANALYSIS_AGENT_KEY = 'assistant';

/** The steps, in the order they run: the canvas and the Run tab draw them. */
export const DEEP_ANALYSIS_STEPS = [
  {
    id: 'plan',
    title: 'Plan',
    kind: 'agent',
    summary:
      'The assistant plans a report title and 3 to 5 distinct angles. One structured call, no tools; at most 5 angles are kept.',
    input: ['question', 'datasets'],
    output: ['question', 'title', 'angles'],
    exits: [{ label: 'No usable plan', outcome: 'fails' }],
    agentCall: { tools: false, maxSteps: 1 },
  },
  {
    id: 'investigate',
    title: 'Investigate',
    kind: 'agent',
    summary:
      'The assistant investigates each angle in turn with SQL, one call per angle. An angle that fails is noted in the report, not fatal.',
    input: ['question', 'title', 'angles'],
    output: ['question', 'title', 'findings'],
    exits: [],
    agentCall: { tools: true, maxSteps: 15 },
  },
  {
    id: 'write',
    title: 'Write',
    kind: 'agent',
    summary:
      'The assistant writes the executive summary and the report body from the findings only. One structured call, no tools.',
    input: ['question', 'title', 'findings'],
    output: ['question', 'title', 'executiveSummary', 'body', 'findings'],
    exits: [{ label: 'No usable report', outcome: 'fails' }],
    agentCall: { tools: false, maxSteps: 1 },
  },
  {
    id: 'assemble',
    title: 'Assemble',
    kind: 'code',
    summary:
      'Assembles the report with its data appendix and stores it in the run workspace. No LLM.',
    input: ['question', 'title', 'executiveSummary', 'body', 'findings'],
    output: ['title', 'executiveSummary', 'path', 'angles'],
    exits: [],
  },
] as const satisfies readonly WorkflowStepEntry[];

/** The run's RequestContext key holding the per-run `DeepAnalysisRuntime`. */
export const DEEP_ANALYSIS_RUNTIME_KEY = 'deep-analysis-runtime';

/** Hard ceiling on the plan, whatever the model proposes (R5). */
export const MAX_ANGLES = 5;
/** Findings are prose; this keeps one runaway angle from eating the synthesis (R7). */
export const FINDINGS_CHARS_CAP = 12_000;
/** The longest report title taken from the question (R5). */
export const TITLE_FROM_QUESTION = 80;
/** Directory reports live in, inside the run's (or session's) workspace (R12). */
export const REPORTS_DIR = 'reports';

/** One planned investigation angle. */
export interface AnalysisAngle {
  title: string;
  question: string;
}

/** What one angle's investigation produced. */
export interface AngleFinding extends AnalysisAngle {
  /** The agent's prose findings for this angle. */
  findings: string;
  /** Statements the agent reported running, for the data appendix. */
  sql: string[];
}

/** The planner's structured result, as its schema parses it. */
export interface PlannedAnalysis {
  title: string;
  angles: AnalysisAngle[];
}

/** The writer's structured result, as its schema parses it. */
export interface WrittenAnalysis {
  title: string;
  executiveSummary: string;
  report: string;
}

/** What Assemble returns: the run's output. */
export interface AssembledReport {
  title: string;
  executiveSummary: string;
  /** Workspace-relative path of the stored markdown report. */
  path: string;
  angles: number;
}

/**
 * What the run code hands the run (on its RequestContext): the three
 * assistant calls exactly as the chat's deep analysis makes them, and the
 * run workspace the report is stored in.
 */
export interface DeepAnalysisRuntime {
  /** The run id: the report's closing line and file name fallback. */
  reportId: string;
  plan: (question: string) => Promise<PlannedAnalysis>;
  /** Never throws for one angle's failure: that angle's finding says so (R8). */
  investigate: (input: {
    question: string;
    angle: AnalysisAngle;
    index: number;
    total: number;
  }) => Promise<AngleFinding>;
  write: (input: {
    question: string;
    findings: AngleFinding[];
  }) => Promise<WrittenAnalysis>;
  /** Store the report at `path` in the run workspace. */
  store: (path: string, markdown: string) => Promise<void>;
  /** The time the report says it was generated. */
  now?: () => string;
}

/**
 * Plan (R5): at most `MAX_ANGLES` angles, none fails the step; a blank
 * title becomes the question's first 80 characters.
 */
export function receivePlan(
  plan: PlannedAnalysis,
  question: string,
): PlannedAnalysis {
  const angles = plan.angles.slice(0, MAX_ANGLES);
  if (!angles.length) throw new Error('the planner returned no angles');
  return {
    title: plan.title.trim() || question.slice(0, TITLE_FROM_QUESTION),
    angles,
  };
}

/** Every ```sql fenced statement in the agent's findings, de-duplicated (R7). */
export function extractSqlBlocks(text: string): string[] {
  const blocks = [...text.matchAll(/```sql\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  return [...new Set(blocks)];
}

/** One angle's findings from the agent's text: capped, with its SQL (R7). */
export function angleFinding(angle: AnalysisAngle, text: string): AngleFinding {
  const trimmed = (text ?? '').trim();
  return {
    ...angle,
    findings: trimmed.slice(0, FINDINGS_CHARS_CAP) || 'No findings returned.',
    sql: extractSqlBlocks(trimmed),
  };
}

/** An angle that could not be investigated: noted, with no SQL (R8). */
export function failedAngle(
  angle: AnalysisAngle,
  detail: string,
): AngleFinding {
  return {
    ...angle,
    findings: `This angle could not be investigated — ${detail}`,
    sql: [],
  };
}

/** The findings as the report phase's `{{findings}}` block (R9). */
export function findingsBlock(findings: readonly AngleFinding[]): string {
  return findings
    .map((finding, index) =>
      [
        `### Angle ${index + 1}: ${finding.title}`,
        finding.question,
        '',
        finding.findings,
      ].join('\n'),
    )
    .join('\n\n');
}

/** The writer's title replaces the planner's when it is not blank (R9). */
export function reportTitle(written: WrittenAnalysis, planned: string): string {
  return written.title.trim() || planned;
}

/** A file-name-safe slug of a title: at most 64 characters (R19). */
export function reportSlug(title: string | undefined): string {
  return (title ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

/**
 * Where a run stores its report (R12, R19): `reports/<slug of the title>.md`,
 * or `reports/deep-analysis-<first 8 characters of the id>.md` when the title
 * has no letters or digits. The run's workspace is its own, so the name is
 * unique and is also the name the file downloads as.
 */
export function runReportPath(title: string, reportId: string): string {
  const name = reportSlug(title) || `deep-analysis-${reportId.slice(0, 8)}`;
  return `${REPORTS_DIR}/${name}.md`;
}

/**
 * The stored report (R11). Title, question, executive summary, the written
 * body and the data appendix are assembled here rather than by the model,
 * so the document's structure, and the SQL it claims to be based on, cannot
 * drift.
 */
export function reportMarkdown(input: {
  title: string;
  question: string;
  executiveSummary: string;
  body: string;
  findings: readonly AngleFinding[];
  sessionName?: string;
  generatedAt: string;
  jobId: string;
}): string {
  const lines = [
    `# ${input.title}`,
    '',
    `**Question:** ${input.question}`,
    '',
    [
      'Deep analysis',
      input.sessionName ? `session: ${input.sessionName}` : '',
      `${input.findings.length} angle${input.findings.length === 1 ? '' : 's'}`,
      `generated ${input.generatedAt}`,
    ]
      .filter(Boolean)
      .join(' · '),
    '',
    '## Executive summary',
    '',
    input.executiveSummary,
    '',
    input.body,
    '',
    '## Data appendix',
    '',
  ];
  input.findings.forEach((finding, index) => {
    lines.push(`### ${index + 1}. ${finding.title}`, '', finding.question, '');
    if (finding.sql.length) {
      for (const sql of finding.sql) lines.push('```sql', sql, '```', '');
    } else {
      lines.push('_No SQL was recorded for this angle._', '');
    }
  });
  lines.push('---', '', `Report ${input.jobId}`, '');
  return lines.join('\n');
}

/**
 * Assemble (R11, R12): the report's markdown and where it is stored, and the
 * run's output. The executive summary and body are trimmed.
 */
export function assembleReport(input: {
  question: string;
  title: string;
  executiveSummary: string;
  body: string;
  findings: readonly AngleFinding[];
  reportId: string;
  generatedAt: string;
}): { markdown: string; report: AssembledReport } {
  const executiveSummary = input.executiveSummary.trim();
  const markdown = reportMarkdown({
    title: input.title,
    question: input.question,
    executiveSummary,
    body: input.body.trim(),
    findings: input.findings,
    generatedAt: input.generatedAt,
    jobId: input.reportId,
  });
  return {
    markdown,
    report: {
      title: input.title,
      executiveSummary,
      path: runReportPath(input.title, input.reportId),
      angles: input.findings.length,
    },
  };
}
