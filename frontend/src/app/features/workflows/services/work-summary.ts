import { ChatMessage } from '../../sessions/models/session.model';
import { WorkflowRunStep } from '../models/workflow.model';

/** What a conversational agent's turn did, in one line (ui.md 4.5.12 work summary). */
export interface WorkSummary {
  /** Step start to end, rounded; null while the step has not ended. */
  seconds: number | null;
  durationLabel: string | null;
  skills: string[];
  skillsLabel: string | null;
  tablesLabel: string | null;
  queriesLabel: string | null;
  /** One entry per `run_readonly_sql` record of the answer, in `data` order. */
  queries: { index: number; rationale: string; rows: number | null }[];
  checksLabel: string | null;
  /** A check other than a warning failed. */
  checksWarning: boolean;
}

type SummarySteps = Pick<
  WorkflowRunStep,
  'startedAt' | 'endedAt' | 'toolCalls'
>[];

/** The part of a run the summary reads (a stored run, or an earlier turn's answer). */
export interface WorkSummarySource {
  steps?: SummarySteps;
  answer?: ChatMessage;
}

const WARNING_ONLY = /\(warning only\)\s*$/i;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A skill tool call's input is the skill's name, plain or as `{"name": …}`. */
function skillName(input: string | undefined): string | null {
  const text = input?.trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { name?: unknown };
      return typeof parsed.name === 'string' && parsed.name !== ''
        ? parsed.name
        : null;
    } catch {
      return null;
    }
  }
  return text;
}

function secondsOf(steps: SummarySteps): number | null {
  let start = Infinity;
  let end = -Infinity;
  for (const step of steps) {
    if (step.startedAt === undefined) continue;
    if (step.endedAt === undefined) return null;
    start = Math.min(start, Date.parse(step.startedAt));
    end = Math.max(end, Date.parse(step.endedAt));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function workSummaryOf(source: WorkSummarySource): WorkSummary {
  const steps = source.steps ?? [];
  const answer = source.answer;

  const seconds = secondsOf(steps);

  const skills: string[] = [];
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      if (call.tool !== 'skill') continue;
      const name = skillName(call.input);
      if (name !== null && !skills.includes(name)) skills.push(name);
    }
  }

  const tables = new Set<string>();
  for (const evidence of answer?.evidence ?? []) {
    for (const table of evidence.tables ?? []) tables.add(table.entity);
  }

  const queries: WorkSummary['queries'] = [];
  (answer?.data ?? []).forEach((record, index) => {
    if (record.tool !== 'run_readonly_sql') return;
    queries.push({
      index,
      rationale: record.rationale ?? '',
      rows: record.rowCount ?? null,
    });
  });

  const checks = answer?.checks;
  const passed = checks?.filter((c) => c.passed).length ?? 0;

  return {
    seconds,
    durationLabel: seconds === null ? null : `Worked for ${seconds} s`,
    skills,
    skillsLabel: skills.length > 0 ? `Loaded ${skills.join(', ')}` : null,
    tablesLabel:
      tables.size > 0 ? `Read ${plural(tables.size, 'table', 'tables')}` : null,
    queriesLabel:
      queries.length > 0
        ? `Ran ${plural(queries.length, 'query', 'queries')}`
        : null,
    queries,
    checksLabel:
      checks === undefined || checks.length === 0
        ? null
        : `${passed} of ${checks.length} checks passed`,
    checksWarning:
      checks?.some((c) => !c.passed && !WARNING_ONLY.test(c.check)) ?? false,
  };
}
