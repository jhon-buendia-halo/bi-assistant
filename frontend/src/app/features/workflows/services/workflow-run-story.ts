import { NodeInspection, NodeRunView } from '../models/workflow-node.model';
import { StoryStat } from '../models/workflow.model';
import { formatDuration } from './workflow-node-inspection';
import { ProgressState, nodeProgressState } from './workflow-run-progress';

/**
 * A run told from its steps' stories (ui.md 4.4b): a code step's line on the
 * canvas, the run's figures and one line per step (How it ran
 * All nodes). Built only from the run data (api.md 3.6 `step.story`). Pure.
 */

/** How a run line reads: its colour follows the step's state. */
export type RunLineTone = 'success' | 'warning' | 'danger' | 'muted' | 'active';

/** A step's line on the canvas while a run is shown. */
export interface RunLine {
  text: string;
  tone: RunLineTone;
  /** The story's headline, for the line's title (it is cut to one line). */
  title: string;
}

/**
 * A code step's line on the canvas: what its story's `brief` says and how
 * long it took (`9 tables · 2 ms`), else its state (`Done · 0 ms`,
 * `Skipped`, `Failed`); null when no run is shown or it has not started.
 */
export function stepRunLine(run: NodeRunView | null): RunLine | null {
  if (!run) return null;
  const story = run.story;
  const brief = story?.brief;
  const title = story?.headline ?? '';
  switch (run.status) {
    case 'success': {
      const took = formatDuration(run.durationMs);
      const what = brief ?? 'Done';
      return {
        text: run.durationMs !== null ? `${what} · ${took}` : what,
        tone: story?.concern ? 'warning' : 'success',
        title,
      };
    }
    case 'skipped':
      return { text: brief ?? 'Skipped', tone: 'muted', title };
    case 'failed':
      return {
        text: run.error ? `Failed · ${run.error}` : 'Failed',
        tone: 'danger',
        title,
      };
    case 'stopped':
      return { text: 'Stopped', tone: 'muted', title };
    case 'running':
      return { text: 'Running…', tone: 'active', title };
    case 'suspended':
      return { text: 'Waiting for your answer', tone: 'warning', title };
  }
}

/** One step of a run told in one line (How it ran). */
export interface RunTimelineEntry {
  node: NodeInspection;
  state: ProgressState;
  /** Its story's headline, else what its state says. */
  line: string;
  /** Its duration; '' for a skipped or not-run step. */
  time: string;
  /** Its story left something to look at. */
  concern: boolean;
}

const STATE_LINES: Record<ProgressState, string> = {
  pending: 'Not run yet.',
  current: 'Running…',
  waiting: 'Waiting for your answer.',
  done: 'Done.',
  failed: 'Failed.',
  skipped: 'Skipped.',
  stopped: 'Stopped.',
};

/** The steps of the run shown (Start, End and tools aside), each in one line. */
export function runTimeline(
  nodes: readonly NodeInspection[],
): RunTimelineEntry[] {
  return nodes
    .filter((node) => node.kind === 'code' || node.kind === 'agent')
    .map((node) => {
      const state = nodeProgressState(node.run?.status);
      const time =
        state === 'done' || state === 'failed' || state === 'stopped'
          ? formatDuration(node.run?.durationMs ?? null)
          : '';
      return {
        node,
        state,
        line: node.run?.story?.headline ?? STATE_LINES[state],
        time: time === '—' ? '' : time,
        concern: node.run?.story?.concern === true,
      };
    });
}

/**
 * The run's figures: how long it took, from the first step's start to the
 * last step's end, then those its steps' stories give (each step's last
 * attempt), in step order; empty when no step ran.
 */
export function runStats(nodes: readonly NodeInspection[]): StoryStat[] {
  const steps = nodes.filter(
    (node) => node.kind === 'code' || node.kind === 'agent',
  );
  const runs = steps.flatMap(
    (node) => node.attempts ?? (node.run ? [node.run] : []),
  );
  if (!runs.length) return [];
  const starts = runs.flatMap((run) =>
    run.startedAt ? [Date.parse(run.startedAt)] : [],
  );
  const ends = runs.flatMap((run) =>
    run.endedAt ? [Date.parse(run.endedAt)] : [],
  );
  const took =
    starts.length && ends.length
      ? Math.max(...ends) - Math.min(...starts)
      : null;
  return [
    ...(took !== null && took >= 0
      ? [{ value: formatDuration(took), label: 'to run' }]
      : []),
    ...steps.flatMap((node) => node.run?.story?.stats ?? []),
  ];
}
