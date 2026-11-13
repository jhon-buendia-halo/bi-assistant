import {
  END_NODE_ID,
  NodeContext,
  NodeInspection,
  NodeRunView,
  NodeToolCallView,
  START_NODE_ID,
  WorkflowNodeStatus,
  WorkflowStateSummary,
  toolNodeId,
} from '../models/workflow-node.model';
import {
  LiveToolCall,
  RunStepView,
  RunView,
  WorkflowDetail,
  WorkflowDetailStep,
  WorkflowInputError,
  WorkflowRunStepStatus,
} from '../models/workflow.model';
import { ancestorIds, workflowEdges } from './workflow-graph';

export interface NodeInspectionSource {
  workflow: WorkflowDetail;
  run: RunView | null;
  liveToolCalls: LiveToolCall[];
  running: boolean;
  /** The errors that refused the last Execute (ui.md 4.4b); none when absent. */
  inputErrors?: WorkflowInputError[];
}

/** Milliseconds between two ISO times; null when either is missing or invalid. */
export function durationMs(startedAt?: string, endedAt?: string): number | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

/** `—`, `2 ms`, `13.9 s`, `1 min 4 s`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

function stepRun(
  rs: RunStepView | undefined,
  s: NodeInspectionSource,
  step: WorkflowDetailStep,
): NodeRunView | null {
  if (!rs || !rs.status) return null;
  let toolCalls: NodeToolCallView[] = [];
  if (rs.toolCalls?.length) {
    toolCalls = rs.toolCalls.map((c) => ({ ...c, finished: true }));
  } else if (step.kind === 'agent' && rs.status === 'running' && s.running) {
    toolCalls = s.liveToolCalls.map((c) => ({
      tool: c.name,
      ...(c.input !== undefined ? { input: c.input } : {}),
      ...(c.rowCount !== undefined ? { rowCount: c.rowCount } : {}),
      ...(c.error !== undefined ? { error: c.error } : {}),
      finished: c.finished,
    }));
  }
  return {
    status: rs.status,
    ...(rs.input !== undefined ? { input: rs.input } : {}),
    ...(rs.inputTruncated ? { inputTruncated: true as const } : {}),
    ...(rs.output !== undefined ? { output: rs.output } : {}),
    ...(rs.outputTruncated ? { outputTruncated: true as const } : {}),
    ...(rs.error !== undefined ? { error: rs.error } : {}),
    ...(rs.startedAt !== undefined ? { startedAt: rs.startedAt } : {}),
    ...(rs.endedAt !== undefined ? { endedAt: rs.endedAt } : {}),
    durationMs: durationMs(rs.startedAt, rs.endedAt),
    toolCalls,
    ...(rs.attempt !== undefined ? { attempt: rs.attempt } : {}),
  };
}

/**
 * A step's run entries in attempt order (a stored run keeps one per
 * attempt); an entry without `attempt` is the first.
 */
function runStepsById(run: RunView | null): Map<string, RunStepView[]> {
  const byId = new Map<string, RunStepView[]>();
  for (const step of run?.steps ?? []) {
    const list = byId.get(step.id) ?? [];
    list.push(step);
    byId.set(step.id, list);
  }
  for (const list of byId.values()) {
    list.sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
  }
  return byId;
}

/** A step's attempts as the dialog shows them: each numbered, the last one shown first. */
function stepAttempts(
  entries: RunStepView[],
  s: NodeInspectionSource,
  step: WorkflowDetailStep,
): { run: NodeRunView | null; attempts?: NodeRunView[] } {
  const last = entries.at(-1);
  if (entries.length < 2) return { run: stepRun(last, s, step) };
  const attempts = entries.flatMap((entry, i) => {
    const view = stepRun(
      { ...entry, attempt: entry.attempt ?? i + 1 },
      // Live tool calls belong to the attempt still running: the last.
      i === entries.length - 1 ? s : { ...s, liveToolCalls: [] },
      step,
    );
    return view ? [view] : [];
  });
  return {
    run: attempts.at(-1) ?? null,
    ...(attempts.length > 1 ? { attempts } : {}),
  };
}

/** Start, the steps in order, End. */
export function buildNodeInspections(s: NodeInspectionSource): NodeInspection[] {
  const { workflow, run } = s;
  const runInput = (run?.input ?? null) as Record<string, unknown> | null;
  const runSteps = runStepsById(run);
  const lastOf = (id: string) => runSteps.get(id)?.at(-1);
  const edges = workflowEdges(workflow);
  const inputErrors = s.inputErrors ?? [];

  const start: NodeInspection = {
    nodeId: START_NODE_ID,
    kind: 'trigger',
    title: 'Start',
    number: null,
    summary: workflow.description ?? '',
    step: null,
    agent: null,
    run: run
      ? {
          status: 'success',
          ...(runInput ? { input: runInput, output: runInput } : {}),
          durationMs: null,
          toolCalls: [],
        }
      : null,
    context: null,
    ...(inputErrors.length ? { inputErrors: [...inputErrors] } : {}),
  };

  const steps: NodeInspection[] = workflow.steps.map((step, i) => {
    const entries = runSteps.get(step.id) ?? [];
    const before = ancestorIds(edges, step.id);
    const stepAgent = step.agent;
    const agent = stepAgent
      ? ((stepAgent.key !== undefined
          ? workflow.agents.find((a) => a.key === stepAgent.key)
          : undefined) ??
        workflow.agents.find((a) => a.name === stepAgent.name) ??
        null)
      : null;
    const context: NodeContext = {
      workflowInput: runInput,
      earlierSteps: workflow.steps
        .filter((e) => before.has(e.id))
        .map((e) => ({
          id: e.id,
          title: e.title,
          status: lastOf(e.id)?.status ?? null,
        })),
      agent: stepAgent
        ? {
            key: agent?.key ?? stepAgent.key ?? '',
            name: agent?.name ?? stepAgent.name,
            model: agent?.model ?? null,
            tools: stepAgent.tools,
          }
        : null,
    };
    return {
      nodeId: step.id,
      kind: step.kind === 'agent' ? 'agent' : 'code',
      title: step.title,
      number: i + 1,
      summary: step.summary ?? '',
      step,
      agent,
      ...stepAttempts(entries, s, step),
      context,
    };
  });

  // End receives the output of the step that led into it: of the steps
  // with an edge to End, the one that ran (a branch's other way skipped).
  const intoEnd = edges
    .filter((e) => e.to === END_NODE_ID && e.from !== START_NODE_ID)
    .map((e) => lastOf(e.from));
  const lastRunStep =
    intoEnd.find((r) => r?.status === 'success') ?? intoEnd.at(0);
  const endStatus: WorkflowRunStepStatus | null =
    run?.status === 'success'
      ? 'success'
      : run?.status === 'failed'
        ? 'skipped'
        : run?.status === 'stopped'
          ? 'stopped'
          : null;
  const end: NodeInspection = {
    nodeId: END_NODE_ID,
    kind: 'output',
    title: 'End',
    number: null,
    summary: '',
    step: null,
    agent: null,
    run:
      run && endStatus
        ? {
            status: endStatus,
            ...(lastRunStep?.output ? { input: lastRunStep.output } : {}),
            ...(run.output ? { output: run.output } : {}),
            ...(run.error !== undefined ? { error: run.error } : {}),
            durationMs: null,
            toolCalls: [],
          }
        : null,
    context: null,
  };

  return [start, ...steps, end];
}

/**
 * A tool sub-node's details (ui.md 4.4b): the agent step whose
 * `toolNodeId(step, tool)` is `id`, that tool's description and inputs from
 * its agent's `toolDetails`, and its calls in that step in the run shown,
 * live ones included. Null for any other id.
 */
export function buildToolInspection(
  nodes: NodeInspection[],
  id: string,
): NodeInspection | null {
  for (const node of nodes) {
    const step = node.step;
    const stepAgent = step?.agent;
    if (!step || node.kind !== 'agent' || !stepAgent) continue;
    const name = stepAgent.tools.find(
      (tool) => toolNodeId(step.id, tool) === id,
    );
    if (name === undefined) continue;
    const detail = node.agent?.toolDetails?.find((tool) => tool.name === name);
    // Every attempt's calls, in order, when the step ran more than once.
    const runs = node.attempts ?? (node.run ? [node.run] : []);
    const calls = runs
      .flatMap((run) => run.toolCalls)
      .filter((call) => call.tool === name);
    const durations = calls.flatMap((call) =>
      call.durationMs !== undefined ? [call.durationMs] : [],
    );
    return {
      nodeId: id,
      kind: 'tool',
      title: name,
      number: null,
      summary: detail?.description ?? '',
      step,
      agent: node.agent,
      run: null,
      context: null,
      tool: {
        name,
        description: detail?.description ?? '',
        inputs: [...(detail?.inputs ?? [])],
        stepId: step.id,
        stepTitle: step.title,
        agentKey: node.agent?.key ?? stepAgent.key ?? null,
        agentName: node.agent?.name ?? stepAgent.name,
        ran: node.run !== null,
        calls,
        totalDurationMs: durations.length
          ? durations.reduce((sum, ms) => sum + ms, 0)
          : null,
      },
    };
  }
  return null;
}

const RAN: WorkflowRunStepStatus[] = ['success', 'failed', 'stopped'];

export function workflowStateSummary(
  s: NodeInspectionSource,
  nodes: NodeInspection[],
): WorkflowStateSummary {
  return {
    status: s.run?.status ?? null,
    ran: nodes.filter((n) => n.run && RAN.includes(n.run.status)).length,
    total: s.workflow.steps.length + 2,
    durationMs: durationMs(s.run?.startedAt, s.run?.finishedAt),
    runId: s.run?.runId ?? null,
    invalidFields: s.inputErrors?.length ?? 0,
  };
}

/** Each node's canvas status: its run status, or `invalid` for a refused Start. */
export function nodeStatuses(
  nodes: NodeInspection[],
): Record<string, WorkflowNodeStatus> {
  const out: Record<string, WorkflowNodeStatus> = {};
  for (const n of nodes) {
    if (n.inputErrors?.length) out[n.nodeId] = 'invalid';
    else if (n.run) out[n.nodeId] = n.run.status;
  }
  return out;
}
