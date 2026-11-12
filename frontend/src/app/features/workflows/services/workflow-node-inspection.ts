import {
  END_NODE_ID,
  NodeContext,
  NodeInspection,
  NodeRunView,
  NodeToolCallView,
  START_NODE_ID,
  WorkflowStateSummary,
  toolNodeId,
} from '../models/workflow-node.model';
import {
  LiveToolCall,
  RunStepView,
  RunView,
  WorkflowDetail,
  WorkflowDetailStep,
  WorkflowRunStepStatus,
} from '../models/workflow.model';

export interface NodeInspectionSource {
  workflow: WorkflowDetail;
  run: RunView | null;
  liveToolCalls: LiveToolCall[];
  running: boolean;
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
  };
}

/** Start, the steps in order, End. */
export function buildNodeInspections(s: NodeInspectionSource): NodeInspection[] {
  const { workflow, run } = s;
  const runInput = (run?.input ?? null) as Record<string, unknown> | null;
  const runSteps = new Map((run?.steps ?? []).map((r) => [r.id, r]));

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
  };

  const steps: NodeInspection[] = workflow.steps.map((step, i) => {
    const rs = runSteps.get(step.id);
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
      earlierSteps: workflow.steps.slice(0, i).map((e) => ({
        id: e.id,
        title: e.title,
        status: runSteps.get(e.id)?.status ?? null,
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
      run: stepRun(rs, s, step),
      context,
    };
  });

  const lastRunStep = workflow.steps.length
    ? runSteps.get(workflow.steps[workflow.steps.length - 1].id)
    : undefined;
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
    const calls = (node.run?.toolCalls ?? []).filter(
      (call) => call.tool === name,
    );
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
  };
}

export function nodeStatuses(
  nodes: NodeInspection[],
): Record<string, WorkflowRunStepStatus> {
  const out: Record<string, WorkflowRunStepStatus> = {};
  for (const n of nodes) if (n.run) out[n.nodeId] = n.run.status;
  return out;
}
