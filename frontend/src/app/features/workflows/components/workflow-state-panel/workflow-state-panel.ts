import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  Check,
  Circle,
  Clock,
  ListTree,
  LucideAngularModule,
  Minus,
  Square,
  X,
} from 'lucide-angular';
import {
  ProgressState,
  elapsedLabel,
  nodeProgressState,
} from '../../services/workflow-run-progress';
import { DataMode } from '../workflow-data-view/workflow-data-view.util';
import { WorkflowAttemptSwitcher } from '../workflow-attempt-switcher/workflow-attempt-switcher';
import { WorkflowDataView } from '../workflow-data-view/workflow-data-view';
import { WorkflowStepStory } from '../workflow-step-story/workflow-step-story';
import { runStepStatusLabel } from '../../services/workflows.util';
import { NodeInspection } from '../../models/workflow-node.model';
import {
  formatNodeDuration,
  nodeKindLabel,
  nodeStatusChip,
} from '../workflow-node-dialog/workflow-node-format';

const STATE_LABELS: Record<ProgressState, string> = {
  pending: 'Not run',
  done: 'Done',
  current: 'Running',
  waiting: 'Waiting for you',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
};

/** One row of the Logs list: a node with its state in the run shown. */
export interface LogRow {
  node: NodeInspection;
  state: ProgressState;
  /** The screen-reader label of its state. */
  label: string;
  /** How many times it ran; 1 for a node that ran once or not at all. */
  attempts: number;
  /** Its duration, or for the running node the time since it started. */
  time: string;
  /** Why a skipped node did not run, from its story; null otherwise. */
  why: string | null;
  /** Its share of the run's step time, 0..1, for its bar; null when unknown. */
  share: number | null;
}

/** One step of the All nodes timeline (ui.md 4.4b). */
export interface TimelineEntry {
  node: NodeInspection;
  state: ProgressState;
  /** The first line of its story, else what its state says. */
  line: string;
  time: string;
}

/** A skipped step's reason as its row's second line: its story's headline, without `Skipped: `. */
function skipReason(headline: string | undefined): string | null {
  if (!headline) return null;
  const reason = headline.replace(/^Skipped:\s*/, '');
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

const NOT_RUN =
  'This node has not run yet. Execute the workflow to see its data.';

/**
 * The Logs and node data of the Run panel under the canvas (ui.md 4.4b): one
 * list of every node with its state in the run shown (live, the running one
 * with its elapsed time), and the selected node's input, output and context,
 * or the All nodes table. The run's summary is in the Run panel's header.
 */
@Component({
  selector: 'app-workflow-state-panel',
  imports: [
    LucideAngularModule,
    WorkflowAttemptSwitcher,
    WorkflowDataView,
    WorkflowStepStory,
  ],
  templateUrl: './workflow-state-panel.html',
})
export class WorkflowStatePanel {
  readonly Check = Check;
  readonly Circle = Circle;
  readonly Clock = Clock;
  readonly ListTree = ListTree;
  readonly Minus = Minus;
  readonly Square = Square;
  readonly X = X;

  readonly nodes = input<NodeInspection[]>([]);
  readonly selectedId = input<string | null>(null);

  readonly selectNode = output<string | null>();
  readonly openNode = output<string>();

  readonly modes: DataMode[] = ['json', 'schema'];
  readonly chip = nodeStatusChip;
  readonly kindLabel = nodeKindLabel;
  readonly duration = formatNodeDuration;

  /** Ticks every second, for the running node's elapsed time. */
  private readonly now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Story (default) or Data: what a selected step's detail shows. */
  readonly view = signal<'story' | 'data'>('story');
  /** A step has a story; Start and End show their data only. */
  readonly isStep = computed(() => {
    const kind = this.selected()?.kind;
    return kind === 'code' || kind === 'agent';
  });

  /** Every node (tool nodes aside) with its state, attempts and time. */
  readonly rows = computed<LogRow[]>(() => {
    const nodes = this.nodes().filter((node) => node.kind !== 'tool');
    const total = nodes.reduce(
      (sum, node) => sum + (node.run?.durationMs ?? 0),
      0,
    );
    return nodes.map((node) => {
      const state = nodeProgressState(node.run?.status);
      const startedAt = node.run?.startedAt;
      const ms = node.run?.durationMs ?? null;
      return {
        node,
        state,
        label: STATE_LABELS[state],
        attempts: node.attempts?.length || 1,
        time:
          state === 'current'
            ? startedAt !== undefined
              ? elapsedLabel(startedAt, this.now())
              : ''
            : state === 'skipped'
              ? 'Skipped'
              : node.run
                ? formatNodeDuration(node.run.durationMs)
                : '',
        why: state === 'skipped' ? skipReason(node.run?.story?.headline) : null,
        // A bar only where it says something: a step with a visible share.
        share:
          state === 'done' && ms !== null && total > 0 && ms / total >= 0.02
            ? ms / total
            : null,
      };
    });
  });

  /** The All nodes timeline: every step, in order, told in one line each. */
  readonly timeline = computed<TimelineEntry[]>(() =>
    this.rows()
      .filter((row) => row.node.kind === 'code' || row.node.kind === 'agent')
      .map((row) => ({
        node: row.node,
        state: row.state,
        line:
          row.node.run?.story?.headline ??
          (row.state === 'pending'
            ? 'Not run yet.'
            : row.state === 'current'
              ? 'Running…'
              : row.state === 'waiting'
                ? 'Waiting for your answer.'
                : row.label + '.'),
        time: row.state === 'skipped' ? '' : row.time,
      })),
  );

  /**
   * The run's figures above the timeline: how long it took, then the
   * figures its steps' stories give (each step's last attempt), in order.
   */
  readonly stats = computed(() => {
    const runs = this.nodes()
      .filter((node) => node.kind === 'code' || node.kind === 'agent')
      .flatMap((node) => node.attempts ?? (node.run ? [node.run] : []));
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
    const fromStories = this.nodes().flatMap(
      (node) => node.run?.story?.stats ?? [],
    );
    return [
      ...(took !== null && took >= 0
        ? [{ value: formatNodeDuration(took), label: 'to run' }]
        : []),
      ...fromStories,
    ];
  });

  readonly selected = computed(
    () => this.nodes().find((n) => n.nodeId === this.selectedId()) ?? null,
  );
  /** The selected step's attempts' numbers when it ran more than once; else empty. */
  readonly attemptNumbers = computed(() =>
    (this.selected()?.attempts ?? []).map((a, i) => a.attempt ?? i + 1),
  );
  /** The attempt the detail shows: the last, until another is picked. */
  readonly selectedAttempt = linkedSignal({
    // A string, so a refresh of the same node's same attempts keeps the pick.
    source: computed(
      () =>
        `${this.selected()?.nodeId ?? ''}:${this.attemptNumbers().join(',')}`,
    ),
    computation: (key) => Number(key.split(':').at(-1)?.split(',').at(-1)) || 1,
  });
  /** The selected node's run as the detail shows it: the attempt picked, or its only run. */
  readonly shown = computed(() => {
    const node = this.selected();
    if (node === null) return null;
    const attempts = node.attempts;
    if (!attempts?.length) return node.run;
    const picked = this.selectedAttempt();
    return attempts.find((a, i) => (a.attempt ?? i + 1) === picked) ?? node.run;
  });
  readonly shownStatusLabel = computed(() => {
    const run = this.shown();
    return run ? runStepStatusLabel(run.status) : 'Not run';
  });

  /** What Story says for a node without a story: not run, running or waiting, or no story kept. */
  storyEmpty(): string {
    const status = this.shown()?.status;
    if (!status) return NOT_RUN;
    if (status === 'running') return 'Running… its story appears when it ends.';
    if (status === 'suspended') return 'Waiting for your answer.';
    return 'No story was kept for this step. Data has what it received and returned.';
  }

  statusLabel(node: NodeInspection): string {
    return node.run ? runStepStatusLabel(node.run.status) : 'Not run';
  }

  inputEmpty(node: NodeInspection): string {
    return node.run ? 'No input recorded for this run.' : NOT_RUN;
  }

  outputEmpty(node: NodeInspection): string {
    return node.run ? 'No output recorded for this run.' : NOT_RUN;
  }

  inputNames(node: NodeInspection): string {
    const input = node.context?.workflowInput;
    return input && Object.keys(input).length
      ? Object.keys(input).join(', ')
      : 'None';
  }
}
