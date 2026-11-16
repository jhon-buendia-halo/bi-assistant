import {
  LiveToolCall,
  WorkflowDetailStep,
  WorkflowRunStep,
  WorkflowRunToolCall,
} from '../models/workflow.model';

/**
 * What each agent of a run is doing, told as a person would (ui.md 4.4b,
 * *Agents at work*): a short line for the canvas node, a first-person
 * sentence for the Run panel's team, and who works now for Background
 * tasks. Built only from the run's stored or streamed step data (status,
 * tool calls, output), never by a model call. Pure, so the canvas, the Run
 * panel, the task list and their tests share it.
 */

/** The agent an agent step calls: its registry key and persona. */
export interface StepAgent {
  key: string;
  name: string;
  role: string;
}

/**
 * `idle` before any run; `waiting` when a run goes on but the step has not
 * started; `active` while it runs; `asking` while it waits for the user's
 * answer; then `done`, `failed`, `stopped` or `skipped`.
 */
export type AgentStepState =
  | 'idle'
  | 'waiting'
  | 'active'
  | 'asking'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'skipped';

export interface AgentStepStory {
  stepId: string;
  /** The step's title (`Plan`, `Analyse`…). */
  title: string;
  agent: StepAgent;
  state: AgentStepState;
  /** The canvas line: `Running my 3rd query`, `3 queries · 1.2 s`, `Waiting for Michael`; '' when idle. */
  line: string;
  /** Its story left something to look at: the canvas line reads as a warning. */
  concern: boolean;
  /** The Run panel's first-person sentence; null when idle, waiting or skipped. */
  sentence: string | null;
  /** From start to end; null while running or unknown. */
  durationMs: number | null;
  /** While active, what it does, said of it: `running query 3`; '' otherwise. */
  doing: string;
  /** SQL queries it ran (finished or not). */
  queries: number;
  /** Its output field names, in the workflow's order (for the handoff line). */
  passes: string[];
}

/** A step of the run shown; a step that never started has no status. */
export type StoryRunStep = Omit<WorkflowRunStep, 'status'> & {
  status: WorkflowRunStep['status'] | null;
};

/** The run state the stories are told from. */
export interface StorySource {
  steps: readonly WorkflowDetailStep[];
  /** The run shown's steps (each once, its last attempt); empty with no run. */
  runSteps: readonly StoryRunStep[];
  /** A run is going on (streaming or followed). */
  running: boolean;
  /** The running agent step's live tool calls, when the run streams. */
  liveToolCalls?: readonly LiveToolCall[];
}

/** Each agent step's story, by step id, in the workflow's order. */
export function agentStepStories(
  source: StorySource,
): Map<string, AgentStepStory> {
  const runById = new Map(source.runSteps.map((step) => [step.id, step]));
  const hasRun = source.runSteps.length > 0;
  const out = new Map<string, AgentStepStory>();
  for (const step of source.steps) {
    const agent = stepAgent(step);
    if (!agent) continue;
    const run = runById.get(step.id);
    const live =
      run?.status === 'running' && source.liveToolCalls?.length
        ? source.liveToolCalls.map(fromLive)
        : (run?.toolCalls ?? []);
    const state = stepState(run, hasRun, source.running);
    const doing = state === 'active' ? activeDoing(live, step.title) : '';
    out.set(step.id, {
      stepId: step.id,
      title: step.title,
      agent,
      state,
      line: '',
      concern: state === 'done' && run?.story?.concern === true,
      doing,
      sentence: sentenceFor(state, run, live, doing),
      durationMs: durationOf(run),
      queries: live.filter(isQuery).length,
      passes: [...(step.output ?? [])],
    });
  }
  // The lines name who works now, so they come once every state is known.
  const busy = [...out.values()].find(
    (story) => story.state === 'active' || story.state === 'asking',
  );
  for (const story of out.values()) {
    story.line = lineFor(story, runById.get(story.stepId), busy);
  }
  return out;
}

/** The agent an agent step calls; null for a code step or one with no key. */
export function stepAgent(step: WorkflowDetailStep): StepAgent | null {
  if (step.kind !== 'agent' || !step.agent?.key) return null;
  return {
    key: step.agent.key,
    name: step.agent.name,
    role: step.agent.role ?? '',
  };
}

/**
 * Who works now, for a task row: `Michael is querying the data`, `Olivia is
 * waiting for your answer`; null when no agent step is under way.
 */
export function teamActivity(stories: Iterable<AgentStepStory>): string | null {
  for (const story of stories) {
    if (story.state === 'asking') {
      return `${story.agent.name} is waiting for your answer`;
    }
    if (story.state === 'active') {
      return `${story.agent.name} is ${story.doing}`;
    }
  }
  return null;
}

/**
 * The line between two agents of the Run panel's team, once the second one
 * started: `Olivia passed question, plan and catalog to Michael`.
 */
export function handoffLine(
  from: AgentStepStory,
  to: AgentStepStory,
): string | null {
  if (from.state !== 'done') return null;
  if (to.state === 'idle' || to.state === 'waiting' || to.state === 'skipped') {
    return null;
  }
  const passed = listOf(from.passes, 3);
  return passed
    ? `${from.agent.name} passed ${passed} to ${to.agent.name}`
    : `${from.agent.name} handed over to ${to.agent.name}`;
}

function stepState(
  run: StoryRunStep | undefined,
  hasRun: boolean,
  running: boolean,
): AgentStepState {
  switch (run?.status) {
    case 'running':
      return 'active';
    case 'suspended':
      return 'asking';
    case 'success':
      return 'done';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    case 'skipped':
      return 'skipped';
    default:
      return hasRun && running ? 'waiting' : 'idle';
  }
}

function lineFor(
  story: AgentStepStory,
  run: StoryRunStep | undefined,
  busy: AgentStepStory | undefined,
): string {
  switch (story.state) {
    case 'active':
      return capitalise(story.doing);
    case 'asking':
      return 'Waiting for your answer';
    case 'done': {
      // What its story says in a few words (`3 queries`), else `Done`.
      const what = run?.story?.brief ?? 'Done';
      return story.durationMs !== null
        ? `${what} · ${seconds(story.durationMs)}`
        : what;
    }
    case 'failed':
      return run?.error ? `Failed · ${clip(run.error, 60)}` : 'Failed';
    case 'stopped':
      return 'Stopped';
    case 'skipped':
      return run?.story?.brief ?? 'Not needed this time';
    case 'waiting':
      return busy && busy !== story
        ? `Waiting for ${busy.agent.name}`
        : 'Waiting for its turn';
    default:
      return '';
  }
}

function sentenceFor(
  state: AgentStepState,
  run: StoryRunStep | undefined,
  calls: readonly WorkflowRunToolCall[],
  doing: string,
): string | null {
  switch (state) {
    case 'active':
      return `I'm ${doing}…`;
    case 'asking':
      return 'I need your answer before I go on.';
    case 'done':
      return doneSentence(run?.output, calls);
    case 'failed':
      return run?.error
        ? `I couldn't finish: ${clip(run.error, 140)}`
        : "I couldn't finish.";
    case 'stopped':
      return 'I stopped here.';
    default:
      return null;
  }
}

/** What an active agent does, said of it: `running query 3`, `planning`. */
function activeDoing(
  calls: readonly WorkflowRunToolCall[],
  title: string,
): string {
  const last = calls[calls.length - 1];
  if (!last) return gerund(title);
  if (isQuery(last)) return `running query ${calls.filter(isQuery).length}`;
  const tool = last.tool;
  if (tool.endsWith('list_entities')) return 'looking at the tables';
  if (tool.endsWith('describe_entity')) return 'reading the columns';
  if (tool.endsWith('sample_rows')) return 'sampling a few rows';
  if (tool.endsWith('ask_clarification')) return 'asking you a question';
  if (/skill/.test(tool)) return 'reading a skill';
  return `using ${tool.replace(/^.*?([a-z_]+)$/, '$1')}`;
}

function doneSentence(
  output: Record<string, unknown> | undefined,
  calls: readonly WorkflowRunToolCall[],
): string {
  const queries = calls.filter(isQuery);
  if (queries.length > 0) {
    const failed = queries.filter((call) => call.error).length;
    const rows = queries.reduce((sum, call) => sum + (call.rowCount ?? 0), 0);
    const noun = queries.length === 1 ? 'query' : 'queries';
    const failNote = failed > 0 ? ` (${failed} failed)` : '';
    return `I ran ${queries.length} ${noun}${failNote} and got ${rows} ${rows === 1 ? 'row' : 'rows'} back.`;
  }
  // Its own words: a headline or an answer.
  const words = firstText(output, [
    'headline',
    'summary',
    'answer',
    'approach',
  ]);
  if (words) return `Done: “${clip(firstSentence(words), 140)}”`;
  // A plan (on its own, or under `plan`, which later steps pass along):
  // the figures it needs and where they come from, tables by their own name
  // (`goals`, not `db.schema.goals`). Last, so a later step that passes the
  // plan along speaks of its own work instead.
  const nested = output?.['plan'];
  const plan =
    nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)
      : output;
  const measures = strings(plan?.['measures']);
  const entities = strings(plan?.['entities']).map(
    (name) => name.split('.').pop() ?? name,
  );
  if (measures.length > 0) {
    const from = entities.length > 0 ? ` from ${listOf(entities, 3)}` : '';
    const ask =
      plan?.['needsClarification'] === true
        ? ' First I need to ask you something.'
        : '';
    return `I'll work out ${listOf(measures, 2)}${from}.${ask}`;
  }
  return "I'm done with my part.";
}

function fromLive(call: LiveToolCall): WorkflowRunToolCall {
  return {
    tool: call.name,
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.rowCount !== undefined ? { rowCount: call.rowCount } : {}),
    ...(call.error !== undefined ? { error: call.error } : {}),
  };
}

function isQuery(call: WorkflowRunToolCall): boolean {
  return call.tool.endsWith('run_readonly_sql');
}

function durationOf(run: StoryRunStep | undefined): number | null {
  if (!run?.startedAt || !run.endedAt) return null;
  const ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function firstText(
  output: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = output?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** `a`, `a and b`, `a, b and c`, `a, b and 2 more`. */
export function listOf(items: readonly string[], max: number): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length <= max) {
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }
  return `${items.slice(0, max - 1).join(', ')} and ${items.length - max + 1} more`;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** `Plan` → `planning`, `Write answer` → `writing the answer`. */
function gerund(title: string): string {
  const [verb, ...rest] = title.trim().toLowerCase().split(/\s+/);
  if (!verb) return 'working';
  const ing = verb.endsWith('e')
    ? `${verb.slice(0, -1)}ing`
    : /^[^aeiou]*[aeiou][^aeiouwy]$/.test(verb)
      ? `${verb}${verb.slice(-1)}ing`
      : `${verb}ing`;
  return rest.length > 0 ? `${ing} the ${rest.join(' ')}` : ing;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function firstSentence(text: string): string {
  const plain = text
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = plain.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1] : plain;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
